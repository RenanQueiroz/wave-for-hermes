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

export class ActiveTurn {
  private cancelled = false;
  private wake: (() => void) | undefined;
  readonly done: Promise<void>;

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
    this.done = this.run();
  }

  interrupt(): void {
    if (this.cancelled) return;
    this.cancelled = true;
    this.wake?.();
  }

  private frames(): HarnessTurnFrame[] {
    const { script, text } = this.options;
    if (script.frames && script.frames.length > 0) return script.frames;
    const reply = script.reply ?? `You said: ${text}`;
    return replyFrames(reply, script.replyDelayMs);
  }

  private async run(): Promise<void> {
    const { journal, session, sink, state } = this.options;
    const deltas: string[] = [];
    let completedText: string | undefined;
    let sawTerminal = false;
    for (const frame of this.frames()) {
      if (frame.delayMs) await this.sleep(frame.delayMs);
      if (this.cancelled || !sink.isOpen()) break;
      const payload = frame.payload ?? {};
      sink.sendEvent(frame.type, session.liveId, payload);
      journal.record('turn.frame', { type: frame.type });
      if (frame.type === 'message.delta' && typeof payload.text === 'string') {
        deltas.push(payload.text);
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
    if (this.cancelled && sink.isOpen()) {
      sink.sendEvent('turn.interrupted', session.liveId, {});
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
