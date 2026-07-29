import WebSocket, { type RawData } from 'ws';

import type { MobileAgentConfig } from './config.js';
import { discoverMetro } from './discovery/metro.js';
import type { InspectorTarget } from './types.js';

const MAX_LOGS = 1_000;
const MAX_REQUESTS = 1_000;
const MAX_BODY_BYTES = 64 * 1024;
const COMMAND_TIMEOUT_MS = 5_000;
const RECONNECT_DELAY_MS = 2_000;
const STATE_BRIDGE_KEY = '__WAVE_MOBILE_AGENT_STATE__';

export type ObservabilityState = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface MobileLogEntry {
  sequence: number;
  timestamp: string;
  level: string;
  source: 'console' | 'runtime' | 'log';
  text: string;
  stack?: string | undefined;
}

export interface MobileNetworkRequest {
  sequence: number;
  requestId: string;
  startedAt: string;
  finishedAt?: string;
  method: string;
  url: string;
  type?: string;
  status?: number;
  statusText?: string;
  mimeType?: string;
  encodedDataLength?: number;
  requestHeaders: Record<string, string>;
  responseHeaders?: Record<string, string>;
  failed: boolean;
  errorText?: string;
}

interface CdpMessage {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: { code?: number; message?: string };
}

interface PendingCommand {
  resolve: (result: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

export class ObservabilityCollector {
  private socket: WebSocket | undefined;
  private target?: InspectorTarget;
  private state: ObservabilityState = 'disconnected';
  private error: string | undefined;
  private reconnectTimer: NodeJS.Timeout | undefined;
  private stopped = false;
  private nextCommandId = 1;
  private sequence = 0;
  private connectPromise: Promise<void> | undefined;
  private readonly pending = new Map<number, PendingCommand>();
  private readonly logs: MobileLogEntry[] = [];
  private readonly requests = new Map<string, MobileNetworkRequest>();

  constructor(private readonly config: MobileAgentConfig) {}

  async start(): Promise<void> {
    this.stopped = false;
    await this.ensureConnected().catch(() => undefined);
  }

  async ensureConnected(): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) return;
    if (this.connectPromise) return await this.connectPromise;
    this.connectPromise = this.connect().finally(() => {
      this.connectPromise = undefined;
    });
    return await this.connectPromise;
  }

  status(): {
    state: ObservabilityState;
    error?: string;
    target?: InspectorTarget;
    logCount: number;
    requestCount: number;
    lastSequence: number;
  } {
    return {
      state: this.state,
      ...(this.error ? { error: this.error } : {}),
      ...(this.target ? { target: this.target } : {}),
      logCount: this.logs.length,
      requestCount: this.requests.size,
      lastSequence: this.sequence,
    };
  }

  getLogs(options: {
    sinceSequence?: number;
    levels?: string[] | undefined;
    limit?: number;
  }): { entries: MobileLogEntry[]; lastSequence: number; truncated: boolean } {
    const since = options.sinceSequence ?? 0;
    const levels = options.levels?.map((level) => level.toLocaleLowerCase());
    const matching = this.logs.filter(
      (entry) =>
        entry.sequence > since &&
        (!levels || levels.length === 0 || levels.includes(entry.level.toLocaleLowerCase())),
    );
    const limit = options.limit ?? 200;
    return {
      entries: matching.slice(-limit),
      lastSequence: this.sequence,
      truncated: matching.length > limit,
    };
  }

  getRequests(options: {
    sinceSequence?: number;
    urlContains?: string | undefined;
    method?: string | undefined;
    limit?: number;
  }): { requests: MobileNetworkRequest[]; lastSequence: number; truncated: boolean } {
    const since = options.sinceSequence ?? 0;
    const matching = [...this.requests.values()].filter((request) => {
      if (request.sequence <= since) return false;
      if (
        options.urlContains &&
        !request.url.toLocaleLowerCase().includes(options.urlContains.toLocaleLowerCase())
      ) {
        return false;
      }
      if (options.method && request.method.toUpperCase() !== options.method.toUpperCase()) {
        return false;
      }
      return true;
    });
    const limit = options.limit ?? 200;
    return {
      requests: matching.slice(-limit),
      lastSequence: this.sequence,
      truncated: matching.length > limit,
    };
  }

  async getRequest(
    requestId: string,
    includeBody: boolean,
  ): Promise<
    | { request: MobileNetworkRequest; body?: string; bodyRedacted?: boolean }
    | { request: MobileNetworkRequest; bodyUnavailable: string }
  > {
    const request = this.requests.get(requestId);
    if (!request) {
      throw new Error(`Network request ${requestId} is not in the retained buffer.`);
    }
    if (!includeBody) return { request };
    if (!request.mimeType || !isAllowedBodyMimeType(request.mimeType)) {
      return {
        request,
        bodyUnavailable: `Response body capture is limited to text and JSON content; received ${request.mimeType ?? 'an unknown MIME type'}.`,
      };
    }
    if ((request.encodedDataLength ?? 0) > MAX_BODY_BYTES) {
      return {
        request,
        bodyUnavailable: `Response body exceeds the ${MAX_BODY_BYTES}-byte safety limit.`,
      };
    }

    await this.ensureConnected();
    try {
      const result = await this.send('Network.getResponseBody', { requestId });
      const rawBody = typeof result.body === 'string' ? result.body : '';
      const decoded =
        result.base64Encoded === true
          ? Buffer.from(rawBody, 'base64').toString('utf8')
          : rawBody;
      if (Buffer.byteLength(decoded, 'utf8') > MAX_BODY_BYTES) {
        return {
          request,
          bodyUnavailable: `Response body exceeds the ${MAX_BODY_BYTES}-byte safety limit.`,
        };
      }
      const redacted = redactBody(decoded, request.mimeType);
      return {
        request,
        body: redacted.value,
        bodyRedacted: redacted.redacted,
      };
    } catch (error: unknown) {
      return {
        request,
        bodyUnavailable: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async listStateProviders(): Promise<string[]> {
    const value = await this.evaluateBridge(
      `(() => {
        const bridge = globalThis[${JSON.stringify(STATE_BRIDGE_KEY)}];
        return bridge ? { kind: "providers", value: bridge.list() } : { kind: "bridge-unavailable" };
      })()`,
    );
    const result = asRecord(value);
    if (result?.kind === 'bridge-unavailable') {
      throw new Error(
        'The development-only mobile-agent state bridge is unavailable. Confirm Wave is running a development bundle.',
      );
    }
    if (result?.kind !== 'providers' || !Array.isArray(result.value)) {
      throw new Error('The mobile-agent state bridge returned an invalid provider list.');
    }
    return result.value.filter((name): name is string => typeof name === 'string');
  }

  async readStateProvider(name: string): Promise<unknown> {
    const value = await this.evaluateBridge(
      `(() => {
        const bridge = globalThis[${JSON.stringify(STATE_BRIDGE_KEY)}];
        return bridge
          ? { kind: "value", value: bridge.read(${JSON.stringify(name)}) }
          : { kind: "bridge-unavailable" };
      })()`,
    );
    const result = asRecord(value);
    if (result?.kind === 'bridge-unavailable') {
      throw new Error(
        'The development-only mobile-agent state bridge is unavailable. Confirm Wave is running a development bundle.',
      );
    }
    if (result?.kind !== 'value' || !('value' in result)) {
      throw new Error(`The mobile-agent state provider "${name}" returned an invalid result.`);
    }
    return result.value;
  }

  async runDiagnosticProbe(marker: string): Promise<void> {
    if (!/^wave-mobile-agent-probe-\d+$/.test(marker)) {
      throw new Error('The observability probe marker is invalid.');
    }
    await this.ensureConnected();
    const debuggerUrl = this.target?.webSocketDebuggerUrl;
    if (!debuggerUrl) throw new Error('The Hermes inspector target URL is unavailable.');
    const parsedUrl = new URL(debuggerUrl);
    const probeUrl = `${parsedUrl.protocol === 'wss:' ? 'https:' : 'http:'}//${parsedUrl.host}/status?mobile_agent_probe=${encodeURIComponent(marker)}`;
    const expression = `(async () => {
      console.log(${JSON.stringify(marker)});
      const response = await fetch(${JSON.stringify(probeUrl)});
      return response.status;
    })()`;
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    const exception = asRecord(result.exceptionDetails);
    if (exception) {
      const exceptionObject = asRecord(exception.exception);
      throw new Error(
        stringValue(exceptionObject?.description) ??
          stringValue(exception.text) ??
          'The fixed observability probe threw an exception.',
      );
    }
  }

  async reloadApplication(): Promise<{
    ok: true;
    applicationId: string;
    targetId: string;
    durationMs: number;
    reconnecting: true;
  }> {
    await this.ensureConnected();
    const targetId = this.target?.id;
    if (!targetId) throw new Error('The Hermes inspector target ID is unavailable.');
    const startedAt = Date.now();
    await this.send('Page.reload');
    return {
      ok: true,
      applicationId: 'com.renanqueiroz.wave',
      targetId,
      durationMs: Date.now() - startedAt,
      reconnecting: true,
    };
  }

  clear(): void {
    this.logs.length = 0;
    this.requests.clear();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.rejectPending(new Error('Observability collector stopped.'));
    const socket = this.socket;
    this.socket = undefined;
    if (socket && socket.readyState !== WebSocket.CLOSED) {
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(resolve, 1_000);
        socket.once('close', () => {
          clearTimeout(timeout);
          resolve();
        });
        socket.close();
      });
    }
    this.state = 'disconnected';
  }

  private async connect(): Promise<void> {
    this.state = 'connecting';
    this.error = undefined;
    const metro = await discoverMetro(this.config);
    const candidates =
      metro.selected?.targets.filter(
        (candidate) =>
          candidate.appId === 'com.renanqueiroz.wave' && candidate.webSocketDebuggerUrl,
      ) ?? [];
    const target = this.config.observabilityTargetId
      ? candidates.find((candidate) => candidate.id === this.config.observabilityTargetId)
      : candidates.length === 1
        ? candidates[0]
        : undefined;
    if (!target?.webSocketDebuggerUrl) {
      const message =
        this.config.observabilityTargetId && candidates.length > 0
          ? `Wave Hermes target ${this.config.observabilityTargetId} is not available.`
          : candidates.length > 1
            ? `Found ${candidates.length} Wave Hermes targets. Set MOBILE_AGENT_OBSERVABILITY_TARGET_ID to one target ID from mobile_doctor.`
            : (metro.diagnostics.find((diagnostic) => diagnostic.status === 'error')?.message ??
              'No Wave Hermes inspector target is available.');
      this.failConnection(message);
      throw new Error(message);
    }

    const debuggerUrl = new URL(target.webSocketDebuggerUrl);
    const originProtocol = debuggerUrl.protocol === 'wss:' ? 'https:' : 'http:';
    const origin = `${originProtocol}//${debuggerUrl.host}`;
    const socket = new WebSocket(target.webSocketDebuggerUrl, { origin });
    this.socket = socket;
    this.target = target;

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        socket.terminate();
        reject(new Error('Timed out connecting to the Metro Hermes inspector.'));
      }, COMMAND_TIMEOUT_MS);
      socket.once('open', () => {
        clearTimeout(timeout);
        resolve();
      });
      socket.once('unexpected-response', (_request, response) => {
        clearTimeout(timeout);
        response.resume();
        reject(
          new Error(
            `Metro rejected the Hermes inspector connection with HTTP ${response.statusCode}.`,
          ),
        );
      });
      socket.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    }).catch((error: unknown) => {
      this.failConnection(error instanceof Error ? error.message : String(error));
      throw error;
    });

    socket.on('message', (data) => this.handleMessage(data));
    socket.on('close', () =>
      this.handleDisconnect(socket, 'Hermes inspector connection closed.'),
    );
    socket.on('error', (error) => this.handleDisconnect(socket, error.message));

    try {
      await Promise.all([
        this.send('Runtime.enable'),
        this.send('Log.enable'),
        this.send('Network.enable'),
      ]);
      this.state = 'connected';
      this.error = undefined;
    } catch (error: unknown) {
      socket.terminate();
      const message = error instanceof Error ? error.message : String(error);
      this.failConnection(message);
      throw error;
    }
  }

  private send(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('The Hermes inspector is not connected.'));
    }
    const id = this.nextCommandId;
    this.nextCommandId += 1;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        const error = new Error(`Hermes inspector command ${method} timed out.`);
        reject(error);
        if (this.socket === socket) {
          this.socket = undefined;
          socket.terminate();
          this.failConnection(
            `${error.message} The inspector target may be stale after an app restart; reconnecting.`,
          );
        }
      }, COMMAND_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timeout });
      socket.send(JSON.stringify({ id, method, params }), (error) => {
        if (!error) return;
        clearTimeout(timeout);
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  private async evaluateBridge(expression: string): Promise<unknown> {
    await this.ensureConnected();
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: false,
    });
    const exception = asRecord(result.exceptionDetails);
    if (exception) {
      const exceptionObject = asRecord(exception.exception);
      throw new Error(
        stringValue(exceptionObject?.description) ??
          stringValue(exception.text) ??
          'The mobile-agent state bridge threw an exception.',
      );
    }
    const remoteObject = asRecord(result.result);
    if (!remoteObject || !('value' in remoteObject)) {
      throw new Error('Hermes did not return the state bridge result by value.');
    }
    return remoteObject.value;
  }

  private handleMessage(data: RawData): void {
    let message: CdpMessage;
    try {
      message = JSON.parse(data.toString()) as CdpMessage;
    } catch {
      return;
    }
    if (message.id !== undefined) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timeout);
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(
          new Error(
            `Hermes inspector error ${message.error.code ?? 'unknown'}: ${message.error.message ?? 'Unknown error'}`,
          ),
        );
      } else {
        pending.resolve(message.result ?? {});
      }
      return;
    }
    if (message.method && message.params) {
      this.handleEvent(message.method, message.params);
    }
  }

  private handleEvent(method: string, params: Record<string, unknown>): void {
    if (method === 'Runtime.consoleAPICalled') {
      const args = Array.isArray(params.args) ? params.args : [];
      this.appendLog({
        level: typeof params.type === 'string' ? params.type : 'log',
        source: 'console',
        text: args.map(formatRemoteObject).join(' '),
        timestamp: cdpTimestamp(params.timestamp),
        stack: formatStack(params.stackTrace),
      });
      return;
    }
    if (method === 'Runtime.exceptionThrown') {
      const details = asRecord(params.exceptionDetails);
      this.appendLog({
        level: 'error',
        source: 'runtime',
        text:
          stringValue(details?.text) ??
          stringValue(asRecord(details?.exception)?.description) ??
          'Uncaught runtime exception',
        timestamp: cdpTimestamp(params.timestamp),
        stack: formatStack(details?.stackTrace),
      });
      return;
    }
    if (method === 'Log.entryAdded') {
      const entry = asRecord(params.entry);
      if (!entry) return;
      this.appendLog({
        level: stringValue(entry.level) ?? 'log',
        source: 'log',
        text: stringValue(entry.text) ?? '',
        timestamp: cdpTimestamp(entry.timestamp),
        stack: formatStack(entry.stackTrace),
      });
      return;
    }
    if (method === 'Network.requestWillBeSent') {
      this.handleRequestStarted(params);
      return;
    }
    if (method === 'Network.responseReceived') {
      this.handleResponse(params);
      return;
    }
    if (method === 'Network.loadingFinished') {
      this.handleRequestFinished(params);
      return;
    }
    if (method === 'Network.loadingFailed') {
      this.handleRequestFailed(params);
    }
  }

  private appendLog(entry: Omit<MobileLogEntry, 'sequence'>): void {
    this.logs.push({
      ...entry,
      sequence: this.nextSequence(),
      text: redactText(entry.text).slice(0, 4_000),
      ...(entry.stack ? { stack: redactText(entry.stack).slice(0, 8_000) } : {}),
    });
    while (this.logs.length > MAX_LOGS) this.logs.shift();
  }

  private handleRequestStarted(params: Record<string, unknown>): void {
    const requestId = stringValue(params.requestId);
    const request = asRecord(params.request);
    if (!requestId || !request) return;
    const type = stringValue(params.type);
    const record: MobileNetworkRequest = {
      sequence: this.nextSequence(),
      requestId,
      startedAt: cdpTimestamp(params.wallTime ?? params.timestamp),
      method: stringValue(request.method) ?? 'GET',
      url: redactUrl(stringValue(request.url) ?? ''),
      ...(type ? { type } : {}),
      requestHeaders: redactHeaders(asRecord(request.headers)),
      failed: false,
    };
    this.requests.set(requestId, record);
    this.trimRequests();
  }

  private handleResponse(params: Record<string, unknown>): void {
    const requestId = stringValue(params.requestId);
    const response = asRecord(params.response);
    if (!requestId || !response) return;
    const request = this.requests.get(requestId);
    if (!request) return;
    request.sequence = this.nextSequence();
    const status = numberValue(response.status);
    if (status !== undefined) request.status = status;
    const statusText = stringValue(response.statusText);
    if (statusText) request.statusText = statusText;
    const mimeType = stringValue(response.mimeType);
    if (mimeType) request.mimeType = mimeType;
    request.responseHeaders = redactHeaders(asRecord(response.headers));
  }

  private handleRequestFinished(params: Record<string, unknown>): void {
    const request = this.requests.get(stringValue(params.requestId) ?? '');
    if (!request) return;
    request.sequence = this.nextSequence();
    request.finishedAt = new Date().toISOString();
    const encodedDataLength = numberValue(params.encodedDataLength);
    if (encodedDataLength !== undefined) request.encodedDataLength = encodedDataLength;
  }

  private handleRequestFailed(params: Record<string, unknown>): void {
    const request = this.requests.get(stringValue(params.requestId) ?? '');
    if (!request) return;
    request.sequence = this.nextSequence();
    request.finishedAt = new Date().toISOString();
    request.failed = true;
    const errorText = stringValue(params.errorText);
    if (errorText) request.errorText = redactText(errorText);
  }

  private nextSequence(): number {
    this.sequence += 1;
    return this.sequence;
  }

  private trimRequests(): void {
    while (this.requests.size > MAX_REQUESTS) {
      const firstKey = this.requests.keys().next().value as string | undefined;
      if (!firstKey) break;
      this.requests.delete(firstKey);
    }
  }

  private handleDisconnect(socket: WebSocket, message: string): void {
    if (this.stopped) return;
    if (this.socket !== socket) return;
    this.socket = undefined;
    this.failConnection(message);
  }

  private failConnection(message: string): void {
    this.state = 'error';
    this.error = message;
    this.rejectPending(new Error(message));
    if (this.stopped || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.ensureConnected().catch(() => undefined);
    }, RECONNECT_DELAY_MS);
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

export function redactHeaders(headers: Record<string, unknown> | undefined): Record<string, string> {
  if (!headers) return {};
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [
      name,
      isSensitiveName(name) ? '[REDACTED]' : redactText(String(value)),
    ]),
  );
}

export function redactUrl(value: string): string {
  try {
    const url = new URL(value);
    for (const name of url.searchParams.keys()) {
      if (isSensitiveName(name)) url.searchParams.set(name, '[REDACTED]');
    }
    return url.toString();
  } catch {
    return redactText(value);
  }
}

export function redactText(value: string): string {
  return value
    .replace(
      /\bauthorization\s*[:=]\s*(?:(?:Bearer|Basic)\s+)?[^\s,;]+/gi,
      'Authorization=[REDACTED]',
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(
      /\b(access[_-]?token|refresh[_-]?token|token|secret|password|passwd|api[_-]?key|cookie|set-cookie)\s*[:=]\s*([^\s,;]+)/gi,
      '$1=[REDACTED]',
    );
}

function redactBody(value: string, mimeType: string): { value: string; redacted: boolean } {
  if (/json/i.test(mimeType)) {
    try {
      const parsed = JSON.parse(value) as unknown;
      let redacted = false;
      const sanitized = redactJson(parsed, () => {
        redacted = true;
      });
      return { value: JSON.stringify(sanitized, null, 2), redacted };
    } catch {
      // Invalid JSON is handled as text below.
    }
  }
  const redactedValue = redactText(value);
  return { value: redactedValue, redacted: redactedValue !== value };
}

function redactJson(value: unknown, onRedacted: () => void): unknown {
  if (Array.isArray(value)) return value.map((item) => redactJson(item, onRedacted));
  if (!value || typeof value !== 'object') {
    if (typeof value !== 'string') return value;
    const redacted = redactText(value);
    if (redacted !== value) onRedacted();
    return redacted;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => {
      if (isSensitiveName(key)) {
        onRedacted();
        return [key, '[REDACTED]'];
      }
      return [key, redactJson(nested, onRedacted)];
    }),
  );
}

function isSensitiveName(name: string): boolean {
  return /(^|[-_])(authorization|proxy-authorization|cookie|set-cookie|token|secret|password|passwd|api[-_]?key|signature|access[-_]?key|refresh[-_]?token)($|[-_])/i.test(
    name,
  );
}

function isAllowedBodyMimeType(mimeType: string): boolean {
  return /(^text\/)|json|javascript|xml|x-www-form-urlencoded/i.test(mimeType);
}

function formatRemoteObject(value: unknown): string {
  const object = asRecord(value);
  if (!object) return String(value);
  if ('value' in object) {
    const nested = object.value;
    return typeof nested === 'string' ? nested : JSON.stringify(nested);
  }
  return (
    stringValue(object.unserializableValue) ??
    stringValue(object.description) ??
    stringValue(object.className) ??
    stringValue(object.type) ??
    ''
  );
}

function formatStack(value: unknown): string | undefined {
  const stack = asRecord(value);
  const frames = Array.isArray(stack?.callFrames) ? stack.callFrames : [];
  const lines = frames
    .map(asRecord)
    .filter((frame): frame is Record<string, unknown> => Boolean(frame))
    .map((frame) => {
      const functionName = stringValue(frame.functionName) || '<anonymous>';
      const url = stringValue(frame.url) || '<unknown>';
      const line = (numberValue(frame.lineNumber) ?? 0) + 1;
      const column = (numberValue(frame.columnNumber) ?? 0) + 1;
      return `at ${functionName} (${url}:${line}:${column})`;
    });
  return lines.length > 0 ? lines.join('\n') : undefined;
}

function cdpTimestamp(value: unknown): string {
  const numeric = numberValue(value);
  if (numeric === undefined) return new Date().toISOString();
  const millis = numeric > 10_000_000_000 ? numeric : numeric * 1_000;
  const date = new Date(millis);
  return Number.isNaN(date.valueOf()) ? new Date().toISOString() : date.toISOString();
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
