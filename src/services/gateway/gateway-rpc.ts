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
  onEvent(event: GatewayEventFrame): void;
  requestTimeoutMs?: number;
  socket: GatewayRpcSocket;
}

const DEFAULT_RPC_TIMEOUT_MS = 30_000;

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

  constructor(options: GatewayRpcOptions) {
    this.onEvent = options.onEvent;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_RPC_TIMEOUT_MS;
    this.socket = options.socket;
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
        const { payload, type } = params as Record<string, unknown>;
        if (typeof type === 'string') {
          this.onEvent({
            payload:
              typeof payload === 'object' && payload !== null
                ? (payload as Record<string, unknown>)
                : {},
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
