import type {
  WaveConversationMessage,
  WaveTurnEvent,
} from '@wave/contracts';

export type WaveChatTaskStatus =
  | 'complete'
  | 'error'
  | 'pending'
  | 'running';

export type WaveChatPart =
  | {
      text: string;
      type: 'text';
    }
  | {
      id: string;
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
  | 'cancelling'
  | 'error'
  | 'idle'
  | 'streaming'
  | 'submitting';

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
  | { type: 'history.reconciled' }
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
    case 'history.reconciled':
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

export function historyToWaveChatMessages(
  history: WaveConversationMessage[],
): WaveChatMessage[] {
  const messages: WaveChatMessage[] = [];
  let assistantTurn: WaveChatMessage | undefined;
  const flushAssistantTurn = () => {
    if (!assistantTurn) return;
    messages.push(assistantTurn);
    assistantTurn = undefined;
  };

  history.forEach((message, index) => {
    const id =
      message.id ??
      `history-${index}-${message.createdAt ?? 'undated'}`;
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
        status: 'complete',
        title: message.toolName ?? 'Hermes tool',
        type: 'task',
      };
    } else if (message.content) {
      part = { text: message.content, type: 'text' };
    }

    if (!part) return;
    assistantTurn ??= {
      id,
      parts: [],
      role: 'assistant',
    };
    assistantTurn.parts.push(part);
  });
  flushAssistantTurn();
  return messages;
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
      if (
        event.error.code === 'cancelled' &&
        state.status === 'cancelling'
      ) {
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
    return [
      ...parts.slice(0, -1),
      { ...last, text: `${last.text}${delta}` },
    ];
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
      (parts[index].status === 'complete' ||
        parts[index].status === 'error')
    )
  ) {
    return parts.map((part, partIndex) =>
      partIndex === index && part.type === 'task'
        ? { ...part, status }
        : part,
    );
  }
  return [
    ...parts,
    {
      id: `${baseId}:${event.sequence}`,
      status,
      title,
      type: 'task' as const,
    },
  ];
}

function taskStatus(
  status: Extract<
    WaveTurnEvent,
    { type: 'tool.status' }
  >['status'],
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
