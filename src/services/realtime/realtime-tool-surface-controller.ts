/**
 * Serializes the complete ask-only ↔ ask-and-correct Realtime tool surface.
 * A state becomes acknowledged only after a matching full `session.updated`
 * snapshot. Failed or timed-out updates are never retried until a later real
 * active/idle transition changes the desired revision.
 */
import {
  createRealtimeToolSurfaceSessionUpdate,
  type RealtimeToolSurface,
} from './realtime-prompt.ts';

const DEFAULT_SESSION_UPDATE_TIMEOUT_MS = 8_000;

export interface RealtimeToolSurfaceSnapshot {
  acknowledged: RealtimeToolSurface | 'unknown';
  desired: RealtimeToolSurface;
  updatePending: boolean;
}

interface PendingUpdate {
  revision: number;
  state: RealtimeToolSurface;
  timer: ReturnType<typeof setTimeout>;
}

export class RealtimeToolSurfaceController {
  private acknowledged: RealtimeToolSurface | 'unknown' = 'idle';
  private closed = false;
  private desired: RealtimeToolSurface = 'idle';
  private desiredRevision = 0;
  private failedRevision = -1;
  private inFlight?: PendingUpdate;
  private readonly send: (serializedEvent: string) => void;
  private readonly timeoutMs: number;

  constructor(options: {
    send(serializedEvent: string): void;
    timeoutMs?: number;
  }) {
    this.send = options.send;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_SESSION_UPDATE_TIMEOUT_MS;
  }

  close() {
    this.closed = true;
    if (this.inFlight) clearTimeout(this.inFlight.timer);
    this.inFlight = undefined;
  }

  getSnapshot(): RealtimeToolSurfaceSnapshot {
    return {
      acknowledged: this.acknowledged,
      desired: this.desired,
      updatePending: this.inFlight !== undefined,
    };
  }

  request(active: boolean) {
    if (this.closed) return;
    const next: RealtimeToolSurface = active ? 'active' : 'idle';
    if (next === this.desired) return;
    this.desired = next;
    this.desiredRevision += 1;
    this.pump();
  }

  handleSessionUpdated(session: unknown) {
    if (this.closed || !this.inFlight) return;
    const pending = this.inFlight;
    if (!matchesToolSurface(session, pending.state)) {
      this.fail(pending);
      return;
    }
    clearTimeout(pending.timer);
    this.inFlight = undefined;
    this.acknowledged = pending.state;
    this.failedRevision = -1;
    this.pump();
  }

  private pump() {
    if (
      this.closed ||
      this.inFlight ||
      this.acknowledged === this.desired ||
      this.desiredRevision <= this.failedRevision
    ) {
      return;
    }
    const state = this.desired;
    const revision = this.desiredRevision;
    const timer = setTimeout(() => {
      const pending = this.inFlight;
      if (pending?.revision === revision) this.fail(pending);
    }, this.timeoutMs);
    const pending: PendingUpdate = { revision, state, timer };
    this.inFlight = pending;
    try {
      this.send(
        JSON.stringify({
          session: createRealtimeToolSurfaceSessionUpdate(state),
          type: 'session.update',
        }),
      );
    } catch {
      this.fail(pending);
    }
  }

  private fail(pending: PendingUpdate) {
    if (this.inFlight !== pending) return;
    clearTimeout(pending.timer);
    this.inFlight = undefined;
    this.acknowledged = 'unknown';
    this.failedRevision = pending.revision;
    // A state change that happened while this update was in flight is a later
    // real transition, so it may send one fresh complete snapshot. Otherwise
    // the failed update remains deliberately non-retrying.
    this.pump();
  }
}

export function matchesToolSurface(
  session: unknown,
  expectedState: RealtimeToolSurface,
): boolean {
  if (!isRecord(session)) return false;
  const expected = createRealtimeToolSurfaceSessionUpdate(expectedState);
  if (
    session.type !== expected.type ||
    session.instructions !== expected.instructions ||
    session.tool_choice !== expected.tool_choice ||
    !Array.isArray(session.tools) ||
    session.tools.length !== expected.tools.length
  ) {
    return false;
  }
  return session.tools.every((tool, index) =>
    deepEqual(tool, expected.tools[index]),
  );
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => deepEqual(value, right[index]))
    );
  }
  if (!isRecord(left) || !isRecord(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) =>
        key === rightKeys[index] && deepEqual(left[key], right[key]),
    )
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
