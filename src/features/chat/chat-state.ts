import type {
  WaveErrorLayer,
  WavePromptQuestion,
  WaveTimelineEntry,
  WaveTimelineHandoffEntry,
  WaveTodo,
  WaveTurnEvent,
  WaveToolDetail,
} from '@wave/contracts';
import { WAVE_TOOL_DETAIL_MAX_CHARS } from '@wave/contracts';

export type WaveChatTaskStatus = 'complete' | 'error' | 'pending' | 'running';

export type WaveChatPart =
  | {
      sealed?: boolean;
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
  /** When the message was created; feeds the turn action row's "time ago". */
  createdAt?: string;
  id: string;
  parts: WaveChatPart[];
  /** Bounded inert reasoning trace; absent when the server emits none. */
  reasoning?: WaveToolDetail;
  /**
   * True while reasoning deltas are arriving, false once sealed. Undefined
   * for history rows that never streamed in this app session.
   */
  reasoningStreaming?: boolean;
  role: 'assistant' | 'system' | 'user';
}

export type WaveChatStatus =
  'cancelling' | 'error' | 'idle' | 'streaming' | 'submitting';

export type WaveChatLiveStatus = 'idle' | 'starting' | 'waiting' | 'working';
export const WAVE_CHAT_ACTIVITY_STALE_MS = 8 * 60_000;

/** A mid-turn prompt from the agent, blocking the active turn until answered. */
export interface WaveChatPrompt {
  allowsFreeText: boolean;
  choices: string[];
  command?: WaveToolDetail;
  description?: string;
  kind: 'approval' | 'clarify' | 'mcp-setup' | 'secret' | 'sudo';
  /** Several `choices` may be selected together (single-question clarify). */
  multiSelect?: boolean;
  promptId: string;
  question?: string;
  /** Batched clarify: answered together, each keyed by its question id. */
  questions?: WavePromptQuestion[];
  server?: string;
  turnId: string;
}

export interface WaveChatState {
  /** The prompt currently awaiting the user, if any. */
  activePrompt?: WaveChatPrompt;
  activeTurnId?: string;
  correction?: {
    messageId: string;
    text: string;
  };
  correctionError?: {
    message: string;
    retryable: boolean;
  };
  error?: {
    /**
     * Which part of the stack failed, when Hermes said (v0.21). Selects
     * wording only; it never drives a retry.
     */
    layer?: WaveErrorLayer;
    message: string;
    retryable: boolean;
  };
  /**
   * The active turn's latest task-list snapshot, when Hermes is running one.
   * Replaced wholesale by `revision` and cleared when the turn settles, so a
   * finished turn never leaves a stale plan on screen.
   */
  todos?: {
    items: WaveTodo[];
    revision: number;
  };
  activity?: Extract<WaveTurnEvent, { type: 'activity.status' }>['status'];
  lastActivityAt?: string;
  liveStatus: WaveChatLiveStatus;
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
      lastActivityAt?: string;
      liveStatus: WaveChatLiveStatus;
      turnId: string;
      type: 'resume';
    }
  | {
      delta: string;
      timestamp: string;
      type: 'assistant.delta';
    }
  | {
      event: Exclude<WaveTurnEvent, { type: 'assistant.delta' }>;
      type: 'event';
    }
  | { type: 'cancel.requested' }
  | { type: 'cancelled' }
  | {
      messageId: string;
      text: string;
      type: 'correction.requested';
    }
  | {
      messageId: string;
      status: 'queued' | 'redirected' | 'rejected';
      type: 'correction.resolved';
    }
  | {
      message: string;
      messageId: string;
      retryable: boolean;
      type: 'correction.failed';
    }
  | {
      message: string;
      retryable: boolean;
      type: 'transport.error';
    }
  | { type: 'timeline.reconciled' }
  | { type: 'settled' };

export const initialWaveChatState: WaveChatState = {
  liveStatus: 'idle',
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
        liveStatus: 'starting',
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
        ...(action.lastActivityAt
          ? { lastActivityAt: action.lastActivityAt }
          : {}),
        liveStatus: action.liveStatus,
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
        activity: undefined,
        lastActivityAt: action.timestamp,
        liveStatus: 'working',
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
        activePrompt: undefined,
        activeTurnId: undefined,
        activity: undefined,
        liveStatus: 'idle',
        status: 'cancelling',
      };
    case 'correction.requested':
      return {
        ...state,
        correction: { messageId: action.messageId, text: action.text },
        correctionError: undefined,
        messages: insertCorrection(
          state.messages,
          action.messageId,
          action.text,
        ),
      };
    case 'correction.resolved':
      if (state.correction?.messageId !== action.messageId) return state;
      if (action.status === 'rejected') {
        return {
          ...state,
          correction: undefined,
          correctionError: {
            message: 'That response was no longer accepting corrections.',
            retryable: false,
          },
          messages: removeMessage(state.messages, action.messageId),
        };
      }
      return {
        ...state,
        correction: undefined,
        correctionError: undefined,
        messages:
          action.status === 'queued'
            ? moveMessageToTail(state.messages, action.messageId)
            : state.messages,
      };
    case 'correction.failed':
      if (state.correction?.messageId !== action.messageId) return state;
      return {
        ...state,
        correction: undefined,
        correctionError: {
          message: action.message,
          retryable: action.retryable,
        },
        messages: removeMessage(state.messages, action.messageId),
      };
    case 'transport.error':
      return {
        ...state,
        activePrompt: undefined,
        activeTurnId: undefined,
        activity: undefined,
        error: {
          message: action.message,
          retryable: action.retryable,
        },
        liveStatus: 'idle',
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
            activePrompt: undefined,
            activeTurnId: undefined,
            activity: undefined,
            error: undefined,
            liveStatus: 'idle',
            status: 'idle',
          };
    case 'event':
      return applyEvent(state, action.event);
  }
}

export function isWaveChatActivityStale(
  state: Pick<WaveChatState, 'lastActivityAt' | 'liveStatus'>,
  now = Date.now(),
) {
  if (state.liveStatus !== 'working' || !state.lastActivityAt) return false;
  const lastActivityAt = Date.parse(state.lastActivityAt);
  return (
    Number.isFinite(lastActivityAt) &&
    now - lastActivityAt >= WAVE_CHAT_ACTIVITY_STALE_MS
  );
}

export function waveChatActivityLabel(state: WaveChatState) {
  switch (state.activity) {
    case 'compacting':
      return 'Summarizing conversation…';
    case 'goal-complete':
      return 'Goal complete';
    case 'goal-continuing':
      return 'Goal continuing…';
    case 'goal-paused':
      return 'Goal paused';
    case 'loop-running':
      return 'Running a scheduled loop…';
    case 'process-updated':
      return 'Background work updated';
    case 'ready':
    case undefined:
      return undefined;
  }
}

export function timelineToWaveChatMessages(
  timeline: WaveTimelineEntry[],
): WaveChatMessage[] {
  const messages: WaveChatMessage[] = [];
  let assistantTurn: WaveChatMessage | undefined;
  const flushAssistantTurn = () => {
    if (!assistantTurn) return;
    messages.push(assistantTurn);
    assistantTurn = undefined;
  };
  // Grouping is role-based, not turn-id-based: stored gateway rows carry one
  // synthetic turn id each, so consecutive assistant, tool, and handoff
  // records form one turn until a user or system row closes it.
  const ensureAssistantTurn = (id: string) => {
    assistantTurn ??= {
      id,
      parts: [],
      role: 'assistant',
    };
    return assistantTurn;
  };

  timeline.forEach((entry) => {
    if (entry.type === 'handoff') {
      ensureAssistantTurn(entry.id).parts.push(handoffToTaskPart(entry));
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

    const reasoning =
      message.role === 'assistant' ? message.reasoning : undefined;
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

    if (!part && !reasoning) return;
    const turn = ensureAssistantTurn(id);
    // The turn's age is its newest row: later rows overwrite so the action
    // row shows when the final reply landed.
    if (message.createdAt) turn.createdAt = message.createdAt;
    if (reasoning) {
      turn.reasoning = turn.reasoning
        ? appendReasoning(turn.reasoning, `\n\n${reasoning.text}`)
        : reasoning;
    }
    if (part) turn.parts.push(part);
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
        lastActivityAt: event.timestamp,
        liveStatus: 'working',
        status: 'streaming',
      };
    case 'assistant.started':
      return {
        ...state,
        lastActivityAt: event.timestamp,
        liveStatus: 'working',
        status: 'streaming',
      };
    case 'reasoning.delta':
      return {
        ...state,
        activity: undefined,
        lastActivityAt: event.timestamp,
        liveStatus: 'working',
        messages: updateAssistant(state.messages, (message) => ({
          ...message,
          reasoning: appendReasoning(message.reasoning, event.delta),
          reasoningStreaming: true,
        })),
        status: 'streaming',
      };
    case 'assistant.interim':
      return {
        ...state,
        activity: undefined,
        lastActivityAt: event.timestamp,
        liveStatus: 'working',
        messages: updateAssistant(state.messages, (message) => ({
          ...message,
          parts: sealAssistantText(message.parts, event.content),
        })),
        status: 'streaming',
      };
    case 'assistant.completed':
      return {
        ...state,
        activity: undefined,
        lastActivityAt: event.timestamp,
        liveStatus: 'working',
        messages: updateAssistant(state.messages, (message) => ({
          ...message,
          createdAt: event.timestamp,
          parts: event.replacesLastInterim
            ? replaceLastInterimText(message.parts, event.content)
            : replaceAssistantText(message.parts, event.content),
          ...(message.reasoningStreaming ? { reasoningStreaming: false } : {}),
        })),
        status: 'streaming',
      };
    case 'tool.status':
      return {
        ...state,
        activity: undefined,
        lastActivityAt: event.timestamp,
        liveStatus: 'working',
        messages: updateAssistant(state.messages, (message) => ({
          ...message,
          parts: updateTaskPart(message.parts, event),
        })),
        status: 'streaming',
      };
    case 'prompt.request':
      return {
        ...state,
        activePrompt: {
          allowsFreeText: event.allowsFreeText,
          choices: event.choices,
          ...(event.command ? { command: event.command } : {}),
          ...(event.description ? { description: event.description } : {}),
          kind: event.kind,
          ...(event.multiSelect ? { multiSelect: true } : {}),
          promptId: event.promptId,
          ...(event.question ? { question: event.question } : {}),
          ...(event.questions ? { questions: event.questions } : {}),
          ...(event.server ? { server: event.server } : {}),
          turnId: event.turnId,
        },
        lastActivityAt: event.timestamp,
        liveStatus: 'waiting',
        status: 'streaming',
      };
    case 'prompt.resolved':
      return state.activePrompt?.promptId === event.promptId
        ? {
            ...state,
            activePrompt: undefined,
            lastActivityAt: event.timestamp,
            liveStatus: 'working',
          }
        : state;
    case 'activity.status':
      return {
        ...state,
        activity: event.status === 'ready' ? undefined : event.status,
        lastActivityAt: event.timestamp,
        liveStatus: state.activePrompt ? 'waiting' : 'working',
        status: 'streaming',
      };
    case 'session.title.updated':
      // Metadata is consumed by `useWaveChat` before transcript dispatch.
      return state;
    case 'todo.snapshot':
      // Revision guard: a snapshot older than the one on screen is a late
      // frame from a race (or a replayed one) and must not roll the plan back.
      if (state.todos && event.revision < state.todos.revision) return state;
      return {
        ...state,
        lastActivityAt: event.timestamp,
        todos: { items: event.todos, revision: event.revision },
      };
    case 'turn.completed':
      return {
        ...state,
        activePrompt: undefined,
        activeTurnId: undefined,
        activity: undefined,
        lastActivityAt: event.timestamp,
        liveStatus: 'idle',
        messages: sealStreamingReasoning(state.messages),
        status: 'streaming',
        todos: undefined,
      };
    case 'turn.error':
      if (event.error.code === 'cancelled' && state.status === 'cancelling') {
        return {
          ...state,
          activePrompt: undefined,
          activeTurnId: undefined,
          activity: undefined,
          error: undefined,
          lastActivityAt: event.timestamp,
          liveStatus: 'idle',
          status: 'cancelling',
          todos: undefined,
        };
      }
      return {
        ...state,
        activePrompt: undefined,
        activeTurnId: undefined,
        activity: undefined,
        error: {
          ...(event.surface ? { layer: event.surface.layer } : {}),
          message: event.error.message,
          retryable: event.error.retryable,
        },
        lastActivityAt: event.timestamp,
        liveStatus: 'idle',
        status: 'error',
        todos: undefined,
      };
  }
}

function appendReasoning(
  current: WaveToolDetail | undefined,
  delta: string,
): WaveToolDetail {
  if (current?.truncated) return current;
  const text = `${current?.text ?? ''}${delta}`;
  const truncated = text.length > WAVE_TOOL_DETAIL_MAX_CHARS;
  return {
    text: truncated ? text.slice(0, WAVE_TOOL_DETAIL_MAX_CHARS) : text,
    truncated,
  };
}

/** An interrupted or completed turn must never leave a trace shimmering. */
function sealStreamingReasoning(messages: WaveChatMessage[]) {
  if (!messages.some((message) => message.reasoningStreaming)) return messages;
  return messages.map((message) =>
    message.reasoningStreaming
      ? { ...message, reasoningStreaming: false }
      : message,
  );
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

function insertCorrection(
  messages: WaveChatMessage[],
  messageId: string,
  text: string,
) {
  const correction: WaveChatMessage = {
    id: messageId,
    parts: [{ text, type: 'text' }],
    role: 'user',
  };
  const assistantIndex = messages.findLastIndex(
    (message) => message.role === 'assistant',
  );
  if (assistantIndex < 0) return [...messages, correction];
  return [
    ...messages.slice(0, assistantIndex),
    correction,
    ...messages.slice(assistantIndex),
  ];
}

function moveMessageToTail(messages: WaveChatMessage[], messageId: string) {
  const message = messages.find((entry) => entry.id === messageId);
  return message ? [...removeMessage(messages, messageId), message] : messages;
}

function removeMessage(messages: WaveChatMessage[], messageId: string) {
  return messages.filter((message) => message.id !== messageId);
}

function appendAssistantText(parts: WaveChatPart[], delta: string) {
  const last = parts.at(-1);
  if (last?.type === 'text' && !last.sealed) {
    return [...parts.slice(0, -1), { ...last, text: `${last.text}${delta}` }];
  }
  return [...parts, { text: delta, type: 'text' as const }];
}

function sealAssistantText(parts: WaveChatPart[], content: string) {
  const textIndex = parts.findLastIndex(
    (part) => part.type === 'text' && !part.sealed,
  );
  if (textIndex < 0) {
    return [...parts, { sealed: true, text: content, type: 'text' as const }];
  }
  return parts.map((part, index) =>
    index === textIndex && part.type === 'text'
      ? {
          ...part,
          sealed: true,
          text: reconcileSegmentText(part.text, content),
        }
      : part,
  );
}

function replaceAssistantText(parts: WaveChatPart[], content: string) {
  const textIndex = parts.findLastIndex(
    (part) => part.type === 'text' && !part.sealed,
  );
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

function replaceLastInterimText(parts: WaveChatPart[], content: string) {
  const textIndex = parts.findLastIndex(
    (part) => part.type === 'text' && part.sealed,
  );
  if (textIndex < 0) return replaceAssistantText(parts, content);
  return parts.map((part, index) =>
    index === textIndex && part.type === 'text'
      ? { text: content, type: 'text' as const }
      : part,
  );
}

function reconcileSegmentText(streamed: string, completed: string) {
  if (streamed === completed) return streamed;
  if (completed.startsWith(streamed)) return completed;
  if (streamed.startsWith(completed)) return streamed;
  return completed;
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
        ? mergeTaskPart(part, event, status)
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

function mergeTaskPart(
  part: Extract<WaveChatPart, { type: 'task' }>,
  event: Extract<WaveTurnEvent, { type: 'tool.status' }>,
  status: WaveChatTaskStatus,
) {
  const next = {
    ...part,
    ...(event.toolInput ? { input: event.toolInput } : {}),
    ...(event.toolOutput ? { output: event.toolOutput } : {}),
    ...(event.toolOutputIsPreview === undefined
      ? {}
      : { outputIsPreview: event.toolOutputIsPreview }),
    status,
  };
  if (
    event.toolOutputIsPreview === undefined &&
    (event.status === 'completed' || event.status === 'failed')
  ) {
    delete next.outputIsPreview;
  }
  return next;
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
