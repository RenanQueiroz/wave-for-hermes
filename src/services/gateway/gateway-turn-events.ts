/**
 * Gateway turn events → Wave turn events.
 *
 * The chat reducer consumes `WaveTurnEvent`s (sequence-numbered, with
 * `turn.started` first). The gateway pushes untyped `{type,payload}` frames
 * with no sequence numbers and no turn identity, so this translator supplies
 * both: it owns a monotonic counter per turn and stamps the Wave-side turn id
 * it was constructed with.
 *
 * Frame types observed on 0.19.0 (see `plans/gateway-protocol-notes.md`):
 * `session.info`, `message.start`, `thinking.delta`, `message.delta`,
 * `message.end`/`message.complete`, `turn.error`, plus tool frames. Unknown
 * frames are ignored rather than surfaced — a new gateway frame type must
 * never break a turn in progress.
 */
import type { WaveTurnEvent } from '@wave/contracts';

const MAX_DELTA_CHARS = 32_000;
const MAX_CONTENT_CHARS = 1_000_000;
const MAX_TOOL_NAME_CHARS = 100;
const MAX_ERROR_CHARS = 300;

export interface GatewayTurnFrame {
  payload: Record<string, unknown>;
  type: string;
}

export interface GatewayTurnTranslatorOptions {
  messageId: string;
  now?: () => Date;
  sessionId: string;
  turnId: string;
}

function stringField(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Stateful per turn: `translate` returns zero or more Wave events for each
 * gateway frame, assigning sequence numbers in arrival order.
 */
export class GatewayTurnTranslator {
  private sequence = -1;
  private assistantStarted = false;
  private completed = false;
  private content = '';
  private readonly messageId: string;
  private readonly now: () => Date;
  private readonly sessionId: string;
  private readonly turnId: string;

  constructor(options: GatewayTurnTranslatorOptions) {
    this.messageId = options.messageId;
    this.now = options.now ?? (() => new Date());
    this.sessionId = options.sessionId;
    this.turnId = options.turnId;
  }

  /** The `turn.started` event Wave expects before anything else. */
  start(): WaveTurnEvent {
    return this.base('turn.started') as WaveTurnEvent;
  }

  translate(frame: GatewayTurnFrame): WaveTurnEvent[] {
    if (this.completed) return [];
    switch (frame.type) {
      case 'message.start':
        return this.ensureAssistantStarted();
      case 'message.delta': {
        const text = stringField(frame.payload, 'text');
        if (!text) return [];
        const events = this.ensureAssistantStarted();
        this.content += text;
        events.push({
          ...this.base('assistant.delta'),
          delta: text.slice(0, MAX_DELTA_CHARS),
          messageId: this.messageId,
        } as WaveTurnEvent);
        return events;
      }
      case 'tool.start':
      case 'tool.call': {
        const toolName = stringField(frame.payload, 'name');
        return [
          {
            ...this.base('tool.status'),
            messageId: this.messageId,
            status: 'started',
            ...(toolName
              ? { toolName: toolName.slice(0, MAX_TOOL_NAME_CHARS) }
              : {}),
          } as WaveTurnEvent,
        ];
      }
      case 'tool.end':
      case 'tool.result': {
        const toolName = stringField(frame.payload, 'name');
        const failed = frame.payload.ok === false;
        return [
          {
            ...this.base('tool.status'),
            messageId: this.messageId,
            status: failed ? 'failed' : 'completed',
            ...(toolName
              ? { toolName: toolName.slice(0, MAX_TOOL_NAME_CHARS) }
              : {}),
          } as WaveTurnEvent,
        ];
      }
      case 'message.end':
      case 'message.complete':
      case 'turn.end':
        return this.finish({ interrupted: false });
      case 'turn.interrupted':
        return this.finish({ interrupted: true });
      case 'turn.error': {
        this.completed = true;
        const message =
          stringField(frame.payload, 'message') ??
          stringField(frame.payload, 'error') ??
          'Hermes could not complete this turn.';
        return [
          {
            ...this.base('turn.error'),
            error: {
              code: 'upstream_unavailable',
              message: message.slice(0, MAX_ERROR_CHARS),
              retryable: true,
            },
          } as WaveTurnEvent,
        ];
      }
      default:
        // session.info, thinking.delta, and any future frame: not part of the
        // rendered transcript.
        return [];
    }
  }

  /** Terminal events for a turn that ended without an explicit end frame. */
  finish(options: { interrupted: boolean }): WaveTurnEvent[] {
    if (this.completed) return [];
    this.completed = true;
    const events = this.assistantStarted ? [] : this.ensureAssistantStarted();
    events.push(
      {
        ...this.base('assistant.completed'),
        content: this.content.slice(0, MAX_CONTENT_CHARS),
        interrupted: options.interrupted,
        messageId: this.messageId,
        partial: options.interrupted,
      } as WaveTurnEvent,
      {
        ...this.base('turn.completed'),
        completed: !options.interrupted,
      } as WaveTurnEvent,
    );
    return events;
  }

  private ensureAssistantStarted(): WaveTurnEvent[] {
    if (this.assistantStarted) return [];
    this.assistantStarted = true;
    return [
      {
        ...this.base('assistant.started'),
        messageId: this.messageId,
      } as WaveTurnEvent,
    ];
  }

  private base(type: WaveTurnEvent['type']) {
    this.sequence += 1;
    return {
      apiVersion: 'v1' as const,
      eventId: `${this.turnId}-${this.sequence}`,
      sequence: this.sequence,
      sessionId: this.sessionId,
      timestamp: this.now().toISOString(),
      turnId: this.turnId,
      type,
    };
  }
}
