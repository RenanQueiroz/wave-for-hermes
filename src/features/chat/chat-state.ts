import type {
  WaveTimelineEntry,
  WaveTimelineHandoffEntry,
  WaveTurnEvent,
  WaveToolDetail,
} from '@wave/contracts';
import { WAVE_TOOL_DETAIL_MAX_CHARS } from '@wave/contracts';

export type WaveChatTaskStatus = 'complete' | 'error' | 'pending' | 'running';

export type WaveChatPart =
  | {
      text: string;
      type: 'text';
    }
  | {
      id: string;
      input?: WaveToolDetail;
      output?: WaveToolDetail;
      outputIsPreview?: boolean;
      status: WaveChatTaskStatus;
      title: string;
      type: 'task';
    };

export interface WaveChatMessage {
  id: string;
  parts: WaveChatPart[];
  role: 'assistant' | 'system' | 'user';
}

export type WaveChatStatus =
  'cancelling' | 'error' | 'idle' | 'streaming' | 'submitting';

export interface WaveChatState {
  activeTurnId?: string;
  error?: {
    message: string;
    retryable: boolean;
  };
  messages: WaveChatMessage[];
  status: WaveChatStatus;
}

export type WaveChatAction =
  | {
      assistantId: string;
      input: string;
      type: 'send';
      userId: string;
    }
  | {
      assistantId: string;
      turnId: string;
      type: 'resume';
    }
  | {
      delta: string;
      type: 'assistant.delta';
    }
  | {
      event: Exclude<WaveTurnEvent, { type: 'assistant.delta' }>;
      type: 'event';
    }
  | { type: 'cancel.requested' }
  | { type: 'cancelled' }
  | {
      message: string;
      retryable: boolean;
      type: 'transport.error';
    }
  | { type: 'timeline.reconciled' }
  | { type: 'settled' };

export const initialWaveChatState: WaveChatState = {
  messages: [],
  status: 'idle',
};

export function waveChatReducer(
  state: WaveChatState,
  action: WaveChatAction,
): WaveChatState {
  switch (action.type) {
    case 'send':
      return {
        messages: [
          {
            id: action.userId,
            parts: [{ text: action.input, type: 'text' }],
            role: 'user',
          },
          {
            id: action.assistantId,
            parts: [],
            role: 'assistant',
          },
        ],
        status: 'submitting',
      };
    case 'resume':
      // Reattaching to a turn the server reports as still active. The user's
      // message already lives in the refreshed timeline, so only the
      // assistant placeholder is seeded locally.
      return {
        activeTurnId: action.turnId,
        messages: [
          {
            id: action.assistantId,
            parts: [],
            role: 'assistant',
          },
        ],
        status: 'submitting',
      };
    case 'assistant.delta':
      return {
        ...state,
        messages: updateAssistant(state.messages, (message) => ({
          ...message,
          parts: appendAssistantText(message.parts, action.delta),
        })),
        status: 'streaming',
      };
    case 'cancel.requested':
      return {
        ...state,
        status: 'cancelling',
      };
    case 'cancelled':
      return {
        ...state,
        activeTurnId: undefined,
        status: 'cancelling',
      };
    case 'transport.error':
      return {
        ...state,
        activeTurnId: undefined,
        error: {
          message: action.message,
          retryable: action.retryable,
        },
        status: 'error',
      };
    case 'timeline.reconciled':
      return {
        ...state,
        messages: [],
      };
    case 'settled':
      return state.status === 'error'
        ? state
        : {
            ...state,
            activeTurnId: undefined,
            error: undefined,
            status: 'idle',
          };
    case 'event':
      return applyEvent(state, action.event);
  }
}

export function timelineToWaveChatMessages(
  timeline: WaveTimelineEntry[],
): WaveChatMessage[] {
  const messages: WaveChatMessage[] = [];
  let assistantTurn: WaveChatMessage | undefined;
  let assistantTurnId: string | undefined;
  const flushAssistantTurn = () => {
    if (!assistantTurn) return;
    messages.push(assistantTurn);
    assistantTurn = undefined;
    assistantTurnId = undefined;
  };
  const ensureAssistantTurn = (id: string, turnId: string) => {
    if (assistantTurn && assistantTurnId !== turnId) {
      flushAssistantTurn();
    }
    assistantTurn ??= {
      id,
      parts: [],
      role: 'assistant',
    };
    assistantTurnId = turnId;
    return assistantTurn;
  };

  timeline.forEach((entry) => {
    if (entry.type === 'handoff') {
      ensureAssistantTurn(entry.id, entry.turnId).parts.push(
        handoffToTaskPart(entry),
      );
      return;
    }
    const { message } = entry;
    const id = entry.id;
    if (message.role === 'user' || message.role === 'system') {
      flushAssistantTurn();
      if (message.content) {
        messages.push({
          id,
          parts: [{ text: message.content, type: 'text' }],
          role: message.role,
        });
      }
      return;
    }

    let part: WaveChatPart | undefined;
    if (message.role === 'tool') {
      part = {
        id: `${id}-tool`,
        ...(message.toolInput ? { input: message.toolInput } : {}),
        ...(message.toolOutput || message.content
          ? {
              output:
                message.toolOutput ?? boundedLegacyToolOutput(message.content),
            }
          : {}),
        status: 'complete',
        title: message.toolName ?? 'Hermes tool',
        type: 'task',
      };
    } else if (message.content) {
      part = { text: message.content, type: 'text' };
    }

    if (!part) return;
    ensureAssistantTurn(id, entry.turnId).parts.push(part);
  });
  flushAssistantTurn();
  return messages;
}

function handoffToTaskPart(handoff: WaveTimelineHandoffEntry): WaveChatPart {
  const input = boundedLegacyToolOutput(handoff.instruction);
  const output = handoff.result
    ? boundedLegacyToolOutput(JSON.stringify(handoff.result, null, 2))
    : undefined;
  return {
    id: `${handoff.id}-handoff`,
    input,
    ...(output ? { output } : {}),
    status:
      handoff.status === 'pending'
        ? 'pending'
        : handoff.status === 'completed'
          ? 'complete'
          : 'error',
    title: handoffTitle(handoff.instruction),
    type: 'task',
  };
}

function handoffTitle(instruction: string) {
  const line = instruction.split(/\r?\n/, 1)[0]?.trim() ?? '';
  const summary = line.length > 64 ? `${line.slice(0, 61).trim()}…` : line;
  return summary ? `Hermes · ${summary}` : 'Hermes task';
}

function applyEvent(
  state: WaveChatState,
  event: Exclude<WaveTurnEvent, { type: 'assistant.delta' }>,
): WaveChatState {
  switch (event.type) {
    case 'turn.started':
      return {
        ...state,
        activeTurnId: event.turnId,
        status: 'streaming',
      };
    case 'assistant.started':
      return {
        ...state,
        status: 'streaming',
      };
    case 'assistant.completed':
      return {
        ...state,
        messages: updateAssistant(state.messages, (message) => ({
          ...message,
          parts: replaceAssistantText(message.parts, event.content),
        })),
        status: 'streaming',
      };
    case 'tool.status':
      return {
        ...state,
        messages: updateAssistant(state.messages, (message) => ({
          ...message,
          parts: updateTaskPart(message.parts, event),
        })),
        status: 'streaming',
      };
    case 'turn.completed':
      return {
        ...state,
        activeTurnId: undefined,
        status: 'streaming',
      };
    case 'turn.error':
      if (event.error.code === 'cancelled' && state.status === 'cancelling') {
        return {
          ...state,
          activeTurnId: undefined,
          error: undefined,
          status: 'cancelling',
        };
      }
      return {
        ...state,
        activeTurnId: undefined,
        error: {
          message: event.error.message,
          retryable: event.error.retryable,
        },
        status: 'error',
      };
  }
}

function updateAssistant(
  messages: WaveChatMessage[],
  update: (message: WaveChatMessage) => WaveChatMessage,
) {
  const index = messages.findLastIndex(
    (message) => message.role === 'assistant',
  );
  if (index < 0) return messages;
  return messages.map((message, messageIndex) =>
    messageIndex === index ? update(message) : message,
  );
}

function appendAssistantText(parts: WaveChatPart[], delta: string) {
  const last = parts.at(-1);
  if (last?.type === 'text') {
    return [...parts.slice(0, -1), { ...last, text: `${last.text}${delta}` }];
  }
  return [...parts, { text: delta, type: 'text' as const }];
}

function replaceAssistantText(parts: WaveChatPart[], content: string) {
  const textIndex = parts.findLastIndex((part) => part.type === 'text');
  if (textIndex < 0) {
    return content
      ? [...parts, { text: content, type: 'text' as const }]
      : parts;
  }
  return parts.map((part, index) =>
    index === textIndex && part.type === 'text'
      ? { ...part, text: content }
      : part,
  );
}

function updateTaskPart(
  parts: WaveChatPart[],
  event: Extract<WaveTurnEvent, { type: 'tool.status' }>,
) {
  const title = event.toolName ?? 'Hermes tool';
  const baseId = `${event.messageId ?? 'turn'}:${title}`;
  const index = parts.findLastIndex(
    (part) => part.type === 'task' && part.id.startsWith(baseId),
  );
  const status = taskStatus(event.status);
  if (
    index >= 0 &&
    parts[index]?.type === 'task' &&
    !(
      event.status === 'started' &&
      (parts[index].status === 'complete' || parts[index].status === 'error')
    )
  ) {
    return parts.map((part, partIndex) =>
      partIndex === index && part.type === 'task'
        ? {
            ...part,
            ...(event.toolInput ? { input: event.toolInput } : {}),
            ...(event.toolOutput ? { output: event.toolOutput } : {}),
            ...(event.toolOutputIsPreview === undefined
              ? {}
              : {
                  outputIsPreview: event.toolOutputIsPreview,
                }),
            status,
          }
        : part,
    );
  }
  return [
    ...parts,
    {
      id: `${baseId}:${event.sequence}`,
      ...(event.toolInput ? { input: event.toolInput } : {}),
      ...(event.toolOutput ? { output: event.toolOutput } : {}),
      ...(event.toolOutputIsPreview === undefined
        ? {}
        : { outputIsPreview: event.toolOutputIsPreview }),
      status,
      title,
      type: 'task' as const,
    },
  ];
}

function boundedLegacyToolOutput(content: string): WaveToolDetail {
  const text = content.slice(0, WAVE_TOOL_DETAIL_MAX_CHARS);
  return {
    text,
    truncated: text.length < content.length,
  };
}

function taskStatus(
  status: Extract<WaveTurnEvent, { type: 'tool.status' }>['status'],
): WaveChatTaskStatus {
  switch (status) {
    case 'started':
    case 'progress':
      return 'running';
    case 'completed':
      return 'complete';
    case 'failed':
      return 'error';
  }
}
