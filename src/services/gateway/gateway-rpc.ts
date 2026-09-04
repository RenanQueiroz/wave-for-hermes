/**
 * JSON-RPC 2.0 framing for the Hermes gateway WebSocket (`/api/ws`).
 *
 * Pure protocol logic so node tests can exercise it without a socket: the
 * socket itself is injected. Frames are text JSON; the gateway answers
 * requests by `id` and pushes `{"method":"event","params":{type,payload}}`
 * notifications for turn streaming.
 */

export interface GatewayRpcSocket {
  close(code?: number, reason?: string): void;
  send(data: string): void;
}

export interface GatewayEventFrame {
  payload: Record<string, unknown>;
  /**
   * The gateway session the event belongs to, when the frame names one.
   * Session-less globals (skin changes and the like) omit it and carry no
   * replay contract.
   */
  sessionId?: string;
  /**
   * Hermes v0.21 stamps a per-session monotonic sequence on every event frame
   * that names a session. Wave records the high-water mark so a reattach can
   * ask `session.events.since` for exactly the frames it missed. Absent on
   * older gateways, which simply get no replay.
   */
  seq?: number;
  type: string;
}

export type GatewayRpcResult = Record<string, unknown>;

export class GatewayRpcError extends Error {
  readonly code: number;
  /** Structured `error.data` from the gateway (v0.20.5 truncation refusals). */
  readonly data?: Record<string, unknown>;

  constructor(message: string, code: number, data?: Record<string, unknown>) {
    super(message);
    this.name = 'GatewayRpcError';
    this.code = code;
    if (data) this.data = data;
  }
}

interface PendingCall {
  reject(error: Error): void;
  resolve(result: GatewayRpcResult): void;
  timer: ReturnType<typeof setTimeout>;
}

export interface GatewayRpcOptions {
  /** How long inbound silence may last before the socket is declared dead. */
  heartbeatDeadlineMs?: number;
  /** How often `gateway.ping` is sent once the gateway advertises support. */
  heartbeatIntervalMs?: number;
  onEvent(event: GatewayEventFrame): void;
  /**
   * Invoked once when the heartbeat deadline passes with no inbound frame.
   * The owner closes the socket; this layer only reports the diagnosis.
   */
  onHeartbeatTimeout?(error: Error): void;
  requestTimeoutMs?: number;
  socket: GatewayRpcSocket;
}

const DEFAULT_RPC_TIMEOUT_MS = 30_000;
// Matches Hermes Desktop. A phone that loses its network mid-turn leaves a
// half-open TCP leg: no close event, no further frames, and no terminal frame
// either, so the per-request timeout never fires for a stream that has simply
// gone quiet. `gateway.ping` is answered on the gateway's WS reader thread
// ahead of its dispatcher, so a busy turn cannot delay the reply.
const DEFAULT_HEARTBEAT_INTERVAL_MS = 15_000;
const DEFAULT_HEARTBEAT_DEADLINE_MS = 45_000;

/**
 * Correlates requests to responses and routes event notifications. One
 * instance per open socket; `fail()` settles everything in flight when the
 * socket drops so no caller hangs.
 */
export class GatewayRpc {
  private nextId = 1;
  private readonly pending = new Map<number, PendingCall>();
  private readonly onEvent: (event: GatewayEventFrame) => void;
  private readonly requestTimeoutMs: number;
  private readonly socket: GatewayRpcSocket;
  private readonly heartbeatDeadlineMs: number;
  private readonly heartbeatIntervalMs: number;
  private readonly onHeartbeatTimeout?: (error: Error) => void;
  private heartbeatTimer?: ReturnType<typeof setInterval>;
  private heartbeatSequence = 0;
  private lastInboundAt = Date.now();

  constructor(options: GatewayRpcOptions) {
    this.onEvent = options.onEvent;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_RPC_TIMEOUT_MS;
    this.socket = options.socket;
    this.heartbeatDeadlineMs =
      options.heartbeatDeadlineMs ?? DEFAULT_HEARTBEAT_DEADLINE_MS;
    this.heartbeatIntervalMs =
      options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
    this.onHeartbeatTimeout = options.onHeartbeatTimeout;
  }

  /**
   * Begin pinging. Call only once the gateway has advertised
   * `heartbeat: true` on its `gateway.ready` frame — an older gateway has no
   * `gateway.ping` handler and would answer every ping with a JSON-RPC error.
   * Idempotent: a second call restarts the interval rather than stacking one.
   */
  startHeartbeat(): void {
    this.stopHeartbeat();
    if (this.heartbeatIntervalMs <= 0 || this.heartbeatDeadlineMs <= 0) return;
    this.lastInboundAt = Date.now();
    this.heartbeatTimer = setInterval(() => {
      if (Date.now() - this.lastInboundAt >= this.heartbeatDeadlineMs) {
        this.stopHeartbeat();
        this.onHeartbeatTimeout?.(
          new Error('Gateway heartbeat acknowledgement timed out.'),
        );
        return;
      }
      try {
        // A string id deliberately: `handleMessage` only settles numeric ids,
        // so the pong can never resolve or reject a caller's pending request,
        // and a heartbeat can never surface as a user-visible RPC failure.
        this.socket.send(
          JSON.stringify({
            id: `heartbeat-${++this.heartbeatSequence}`,
            jsonrpc: '2.0',
            method: 'gateway.ping',
            params: {},
          }),
        );
      } catch (error) {
        this.stopHeartbeat();
        this.onHeartbeatTimeout?.(
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    }, this.heartbeatIntervalMs);
  }

  stopHeartbeat(): void {
    if (this.heartbeatTimer === undefined) return;
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = undefined;
  }

  call(
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs?: number,
  ): Promise<GatewayRpcResult> {
    const id = this.nextId++;
    return new Promise<GatewayRpcResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new GatewayRpcError(`Gateway did not answer ${method}.`, -32000),
        );
      }, timeoutMs ?? this.requestTimeoutMs);
      this.pending.set(id, { reject, resolve, timer });
      try {
        this.socket.send(
          JSON.stringify({ id, jsonrpc: '2.0', method, params }),
        );
      } catch (error) {
        this.settle(id);
        reject(
          error instanceof Error
            ? error
            : new GatewayRpcError('Gateway request failed to send.', -32001),
        );
      }
    });
  }

  /** Feed one inbound text frame. Malformed frames are ignored, not fatal. */
  handleMessage(raw: string): void {
    // Any inbound byte proves the socket is alive — including a frame we go
    // on to discard, and including the pong itself.
    this.lastInboundAt = Date.now();
    let frame: unknown;
    try {
      frame = JSON.parse(raw);
    } catch {
      return;
    }
    if (typeof frame !== 'object' || frame === null) return;
    const message = frame as Record<string, unknown>;

    if (message.method === 'event') {
      const params = message.params;
      if (typeof params === 'object' && params !== null) {
        const {
          payload,
          seq,
          session_id: sessionId,
          type,
        } = params as Record<string, unknown>;
        if (typeof type === 'string') {
          this.onEvent({
            payload:
              typeof payload === 'object' && payload !== null
                ? (payload as Record<string, unknown>)
                : {},
            ...(typeof sessionId === 'string' && sessionId
              ? { sessionId }
              : {}),
            ...(typeof seq === 'number' && Number.isInteger(seq) && seq > 0
              ? { seq }
              : {}),
            type,
          });
        }
      }
      return;
    }

    const id = message.id;
    if (typeof id !== 'number') return;
    const call = this.pending.get(id);
    if (!call) return;
    this.settle(id);
    const error = message.error;
    if (typeof error === 'object' && error !== null) {
      const { code, data, message: text } = error as Record<string, unknown>;
      call.reject(
        new GatewayRpcError(
          typeof text === 'string' ? text : 'Gateway rejected the request.',
          typeof code === 'number' ? code : -32603,
          typeof data === 'object' && data !== null && !Array.isArray(data)
            ? (data as Record<string, unknown>)
            : undefined,
        ),
      );
      return;
    }
    const result = message.result;
    call.resolve(
      typeof result === 'object' && result !== null
        ? (result as GatewayRpcResult)
        : {},
    );
  }

  /** Settle every in-flight call with `error` — the socket is gone. */
  fail(error: Error): void {
    this.stopHeartbeat();
    for (const [id, call] of [...this.pending]) {
      this.settle(id);
      call.reject(error);
    }
  }

  private settle(id: number): void {
    const call = this.pending.get(id);
    if (!call) return;
    clearTimeout(call.timer);
    this.pending.delete(id);
  }
}
