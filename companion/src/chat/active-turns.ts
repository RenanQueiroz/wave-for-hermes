import { randomUUID } from 'node:crypto';

import { WaveHttpError } from '../http/errors.ts';

export type TurnAbortReason =
  | 'cancelled'
  | 'client_disconnected'
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

export class ActiveTurnRegistry {
  private readonly deletingSessionIds = new Set<string>();
  private readonly maxActiveTurns: number;
  private readonly turns = new Map<string, ActiveTurn>();

  constructor(maxActiveTurns: number) {
    this.maxActiveTurns = maxActiveTurns;
  }

  cancel(deviceId: string, sessionId: string, turnId: string) {
    const turn = this.turns.get(turnId);
    if (
      !turn ||
      turn.deviceId !== deviceId ||
      turn.sessionId !== sessionId
    ) {
      return false;
    }
    turn.abort('cancelled');
    return true;
  }

  abortAll(reason: TurnAbortReason) {
    for (const turn of this.turns.values()) {
      turn.abort(reason);
    }
  }

  finish(turnId: string) {
    this.turns.delete(turnId);
  }

  hasSession(sessionId: string) {
    for (const turn of this.turns.values()) {
      if (turn.sessionId === sessionId) return true;
    }
    return false;
  }

  releaseSessionDeletion(sessionId: string) {
    this.deletingSessionIds.delete(sessionId);
  }

  reserveSessionDeletion(sessionId: string) {
    if (
      this.deletingSessionIds.has(sessionId) ||
      this.hasSession(sessionId)
    ) {
      return false;
    }
    this.deletingSessionIds.add(sessionId);
    return true;
  }

  start(deviceId: string, sessionId: string): ActiveTurn {
    if (this.deletingSessionIds.has(sessionId)) {
      throw new WaveHttpError(
        'This Hermes session is being deleted.',
        {
          code: 'conflict',
          statusCode: 409,
        },
      );
    }
    if (this.turns.size >= this.maxActiveTurns) {
      throw new WaveHttpError(
        'Wave Companion is already handling its maximum number of active turns.',
        {
          code: 'rate_limited',
          retryable: true,
          statusCode: 429,
        },
      );
    }
    for (const turn of this.turns.values()) {
      if (turn.sessionId === sessionId) {
        throw new WaveHttpError(
          'This Hermes session already has an active turn.',
          {
            code: 'conflict',
            statusCode: 409,
          },
        );
      }
      if (turn.deviceId === deviceId) {
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
    this.turns.set(turn.turnId, turn);
    return turn;
  }
}
