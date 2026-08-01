import { randomUUID } from 'node:crypto';

import { WaveHttpError } from '../http/errors.ts';
import { TurnStreamBuffer } from './turn-stream-buffer.ts';

export type TurnAbortReason =
  | 'cancelled'
  | 'first_event_timeout'
  | 'idle_timeout'
  | 'server_shutdown'
  | 'total_timeout';

export interface ActiveTurn {
  readonly controller: AbortController;
  readonly deviceId: string;
  readonly sessionId: string;
  readonly turnId: string;
  abort(reason: TurnAbortReason): void;
  abortReason(): TurnAbortReason | undefined;
}

/** One SSE response currently observing a turn. The newest attachment wins. */
export interface TurnAttachment {
  end(): void;
  write(frame: string): void;
}

export type TurnRecordState = 'active' | 'completed';

interface TurnRecord {
  attachment?: TurnAttachment;
  readonly buffer: TurnStreamBuffer;
  purgeTimer?: NodeJS.Timeout;
  state: TurnRecordState;
  readonly turn: ActiveTurn;
}

const DEFAULT_RESUME_WINDOW_MS = 120_000;

export class ActiveTurnRegistry {
  private readonly deletingSessionIds = new Set<string>();
  private readonly maxActiveTurns: number;
  private readonly records = new Map<string, TurnRecord>();
  private readonly resumeWindowMs: number;

  constructor(
    maxActiveTurns: number,
    options: { resumeWindowMs?: number } = {},
  ) {
    this.maxActiveTurns = maxActiveTurns;
    this.resumeWindowMs = options.resumeWindowMs ?? DEFAULT_RESUME_WINDOW_MS;
  }

  cancel(deviceId: string, sessionId: string, turnId: string) {
    const record = this.records.get(turnId);
    if (
      !record ||
      record.state !== 'active' ||
      record.turn.deviceId !== deviceId ||
      record.turn.sessionId !== sessionId
    ) {
      return false;
    }
    record.turn.abort('cancelled');
    return true;
  }

  abortAll(reason: TurnAbortReason) {
    for (const record of this.records.values()) {
      if (record.state === 'active') {
        record.turn.abort(reason);
      } else {
        this.purge(record.turn.turnId);
      }
    }
  }

  abortDevice(deviceId: string, reason: TurnAbortReason) {
    let aborted = 0;
    for (const record of this.records.values()) {
      if (record.turn.deviceId !== deviceId) continue;
      if (record.state === 'active') {
        record.turn.abort(reason);
        aborted += 1;
      } else {
        this.purge(record.turn.turnId);
      }
    }
    return aborted;
  }

  /**
   * Marks the turn terminal. Its replay buffer is retained for the resume
   * window so a briefly disconnected client can still collect the tail, then
   * purged.
   */
  finish(turnId: string) {
    const record = this.records.get(turnId);
    if (!record || record.state !== 'active') return;
    record.state = 'completed';
    const attachment = record.attachment;
    record.attachment = undefined;
    attachment?.end();
    if (this.resumeWindowMs <= 0) {
      this.purge(turnId);
      return;
    }
    record.purgeTimer = setTimeout(
      () => this.purge(turnId),
      this.resumeWindowMs,
    );
    record.purgeTimer.unref?.();
  }

  hasSession(sessionId: string) {
    for (const record of this.records.values()) {
      if (record.state === 'active' && record.turn.sessionId === sessionId) {
        return true;
      }
    }
    return false;
  }

  activeTurnFor(deviceId: string, sessionId: string) {
    for (const record of this.records.values()) {
      if (
        record.state === 'active' &&
        record.turn.deviceId === deviceId &&
        record.turn.sessionId === sessionId
      ) {
        return {
          latestSequence: record.buffer.latestSequence,
          turnId: record.turn.turnId,
        };
      }
    }
    return undefined;
  }

  /** The turn's replay state, only for the device that started it. */
  lookup(
    deviceId: string,
    sessionId: string,
    turnId: string,
  ): { buffer: TurnStreamBuffer; state: TurnRecordState } | undefined {
    const record = this.records.get(turnId);
    if (
      !record ||
      record.turn.deviceId !== deviceId ||
      record.turn.sessionId !== sessionId
    ) {
      return undefined;
    }
    return { buffer: record.buffer, state: record.state };
  }

  /** Buffers an emitted frame and forwards it to the current attachment. */
  record(turnId: string, sequence: number, frame: string) {
    const record = this.records.get(turnId);
    if (!record || record.state !== 'active') return;
    record.buffer.append(sequence, frame);
    record.attachment?.write(frame);
  }

  setAttachment(turnId: string, attachment: TurnAttachment) {
    const record = this.records.get(turnId);
    if (!record || record.state !== 'active') {
      attachment.end();
      return;
    }
    const previous = record.attachment;
    record.attachment = attachment;
    previous?.end();
  }

  clearAttachment(turnId: string, attachment: TurnAttachment) {
    const record = this.records.get(turnId);
    if (record?.attachment === attachment) {
      record.attachment = undefined;
    }
  }

  releaseSessionDeletion(sessionId: string) {
    this.deletingSessionIds.delete(sessionId);
  }

  reserveSessionDeletion(sessionId: string) {
    if (this.deletingSessionIds.has(sessionId) || this.hasSession(sessionId)) {
      return false;
    }
    for (const record of this.records.values()) {
      if (record.turn.sessionId === sessionId) {
        this.purge(record.turn.turnId);
      }
    }
    this.deletingSessionIds.add(sessionId);
    return true;
  }

  start(deviceId: string, sessionId: string): ActiveTurn {
    if (this.deletingSessionIds.has(sessionId)) {
      throw new WaveHttpError('This Hermes session is being deleted.', {
        code: 'conflict',
        statusCode: 409,
      });
    }
    const active = [...this.records.values()].filter(
      (record) => record.state === 'active',
    );
    if (active.length >= this.maxActiveTurns) {
      throw new WaveHttpError(
        'Wave Companion is already handling its maximum number of active turns.',
        {
          code: 'rate_limited',
          retryable: true,
          statusCode: 429,
        },
      );
    }
    for (const record of active) {
      if (record.turn.sessionId === sessionId) {
        throw new WaveHttpError(
          'This Hermes session already has an active turn.',
          {
            code: 'conflict',
            statusCode: 409,
          },
        );
      }
      if (record.turn.deviceId === deviceId) {
        throw new WaveHttpError(
          'This Wave device already has an active turn.',
          {
            code: 'conflict',
            statusCode: 409,
          },
        );
      }
    }

    const controller = new AbortController();
    let reason: TurnAbortReason | undefined;
    const turn: ActiveTurn = {
      abort: (nextReason) => {
        if (!controller.signal.aborted) {
          reason = nextReason;
          controller.abort();
        }
      },
      abortReason: () => reason,
      controller,
      deviceId,
      sessionId,
      turnId: randomUUID(),
    };
    this.records.set(turn.turnId, {
      buffer: new TurnStreamBuffer(),
      state: 'active',
      turn,
    });
    return turn;
  }

  private purge(turnId: string) {
    const record = this.records.get(turnId);
    if (!record) return;
    if (record.purgeTimer) clearTimeout(record.purgeTimer);
    const attachment = record.attachment;
    record.attachment = undefined;
    attachment?.end();
    this.records.delete(turnId);
  }
}
