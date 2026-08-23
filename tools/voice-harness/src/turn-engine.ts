/**
 * Plays one scripted turn as gateway event frames over a live socket.
 *
 * Frames go out in script order with optional per-frame delays; an interrupt
 * cancels the remainder and emits `turn.interrupted` the way the real
 * gateway's hard interrupt does. The engine records the assistant's final
 * text into the session's stored rows so timeline reads reconcile the same
 * way they do against a real gateway.
 */
import type { Journal } from './journal.js';
import {
  replyFrames,
  type HarnessTurnFrame,
  type HarnessTurnScript,
} from './scenario.js';
import type { HarnessSession, HarnessState } from './state.js';

export interface FrameSink {
  isOpen(): boolean;
  sendEvent(
    type: string,
    sessionId: string,
    payload: Record<string, unknown>,
  ): void;
}

/** The prompt a turn is blocked on, replayed by `session.resume`. */
export interface PendingTurnPrompt {
  kind: 'approval' | 'clarify';
  payload: Record<string, unknown>;
}

export class ActiveTurn {
  private cancelled = false;
  private wake: (() => void) | undefined;
  /** The socket frames go to; `session.resume` rebinds it like the gateway. */
  private sink: FrameSink;
  /** Assistant text streamed so far — the real gateway's `inflight.assistant`. */
  streamedText = '';
  /** Set while a blocking prompt frame has been emitted and not yet answered. */
  pendingPrompt: PendingTurnPrompt | undefined;
  readonly done: Promise<void>;
  /** The user text this turn is running. */
  readonly text: string;

  constructor(
    private readonly options: {
      journal: Journal;
      script: HarnessTurnScript;
      session: HarnessSession;
      sink: FrameSink;
      state: HarnessState;
      text: string;
    },
  ) {
    this.sink = options.sink;
    this.text = options.text;
    this.done = this.run();
  }

  interrupt(): void {
    if (this.cancelled) return;
    this.cancelled = true;
    this.wake?.();
  }

  /** Continue the turn on a new socket after a client reconnect. */
  rebind(sink: FrameSink): void {
    this.sink = sink;
  }

  private frames(): HarnessTurnFrame[] {
    const { script, text } = this.options;
    if (script.frames && script.frames.length > 0) return script.frames;
    const reply = script.reply ?? `You said: ${text}`;
    return replyFrames(reply, script.replyDelayMs);
  }

  private async run(): Promise<void> {
    const { journal, session, state } = this.options;
    const deltas: string[] = [];
    let completedText: string | undefined;
    let sawTerminal = false;
    for (const frame of this.frames()) {
      if (frame.delayMs) await this.sleep(frame.delayMs);
      // A dropped socket does not end the turn (the real gateway runs it to
      // completion); frames are simply lost until a resume rebinds the sink.
      if (this.cancelled) break;
      const sink = this.sink;
      if (!sink.isOpen()) {
        journal.record('turn.frame.dropped', { type: frame.type });
        continue;
      }
      const payload = frame.payload ?? {};
      sink.sendEvent(frame.type, session.liveId, payload);
      journal.record('turn.frame', { type: frame.type });
      if (frame.type === 'message.delta' && typeof payload.text === 'string') {
        deltas.push(payload.text);
        this.streamedText += payload.text;
      }
      // Mirror the real gateway's pending registry: a blocking prompt stays
      // replayable on resume until a later frame (or its answer) settles it.
      if (frame.type === 'approval.request') {
        this.pendingPrompt = { kind: 'approval', payload };
      } else if (frame.type === 'clarify.request') {
        this.pendingPrompt = { kind: 'clarify', payload };
      } else if (
        frame.type === 'message.delta' ||
        frame.type === 'message.interim' ||
        frame.type === 'tool.complete' ||
        frame.type === 'message.complete'
      ) {
        this.pendingPrompt = undefined;
      }
      if (frame.type === 'message.complete') {
        sawTerminal = true;
        if (typeof payload.text === 'string') completedText = payload.text;
      }
      if (
        frame.type === 'message.end' ||
        frame.type === 'turn.end' ||
        frame.type === 'turn.interrupted' ||
        frame.type === 'turn.error'
      ) {
        sawTerminal = true;
      }
    }
    this.pendingPrompt = undefined;
    if (this.cancelled && this.sink.isOpen()) {
      this.sink.sendEvent('turn.interrupted', session.liveId, {});
      journal.record('turn.frame', { type: 'turn.interrupted' });
    }
    const finalText = completedText ?? deltas.join('');
    if (finalText && (sawTerminal || this.cancelled)) {
      state.appendMessage(session, 'assistant', finalText);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.wake = undefined;
        resolve();
      }, ms);
      this.wake = () => {
        clearTimeout(timer);
        this.wake = undefined;
        resolve();
      };
    });
  }
}
