import { parseHermesCapabilities, reportHermesCapabilities } from './hermes-capabilities.ts';
import { HermesClientError, redactHermesErrorText } from './hermes-errors.ts';
import { HermesSseParser, type HermesSseFrame } from './hermes-sse.ts';
import type {
  HermesCapabilityReport,
  HermesClient,
  HermesConnectionConfig,
  HermesConversationMessage,
  HermesCreateSessionInput,
  HermesListSessionsOptions,
  HermesMessageRole,
  HermesRequestOptions,
  HermesSessionSummary,
  HermesStreamChatInput,
  HermesStreamEvent,
  HermesToolCall,
} from './hermes-types.ts';

type HermesFetch = (input: string, init?: RequestInit) => Promise<Response>;

interface HttpHermesClientOptions {
  fetch?: HermesFetch;
  requestTimeoutMs?: number;
}

interface RequestContext {
  cleanup: () => void;
  clearTimeout: () => void;
  externalSignal?: AbortSignal;
  signal: AbortSignal;
  timedOut: () => boolean;
}

interface JsonRequestOptions {
  body?: unknown;
  method?: 'GET' | 'POST';
  signal?: AbortSignal;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const MAX_IDENTIFIER_LENGTH = 256;
const MAX_LIST_LIMIT = 200;
const STREAM_EVENT_NAMES = new Set([
  'assistant.completed',
  'assistant.delta',
  'done',
  'error',
  'message.started',
  'run.completed',
  'run.started',
  'tool.completed',
  'tool.failed',
  'tool.progress',
  'tool.started',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function optionalString(value: unknown) {
  return typeof value === 'string' && value ? value : undefined;
}

function optionalText(value: unknown) {
  if (typeof value === 'string') {
    return value;
  }
  if (value === undefined) {
    return undefined;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

function requiredString(value: unknown, field: string) {
  if (typeof value !== 'string' || !value) {
    throw new HermesClientError(`Hermes stream event is missing ${field}.`, {
      code: 'invalid_stream_event',
      kind: 'protocol',
    });
  }
  return value;
}

function requiredNumber(value: unknown, field: string) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new HermesClientError(`Hermes stream event is missing ${field}.`, {
      code: 'invalid_stream_event',
      kind: 'protocol',
    });
  }
  return value;
}

function normalizeMessageRole(value: unknown): HermesMessageRole {
  switch (value) {
    case 'assistant':
    case 'system':
    case 'tool':
    case 'user':
      return value;
    default:
      return 'unknown';
  }
}

function normalizeMessageContent(value: unknown) {
  if (typeof value === 'string') {
    return value;
  }
  if (!Array.isArray(value)) {
    return '';
  }

  return value
    .map((part) => {
      if (typeof part === 'string') {
        return part;
      }
      if (isRecord(part) && typeof part.text === 'string') {
        return part.text;
      }
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function parseToolCalls(value: unknown): HermesToolCall[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const toolCalls = value.flatMap((toolCall) => {
    if (!isRecord(toolCall)) {
      return [];
    }
    const id =
      optionalString(toolCall.id) ?? optionalString(toolCall.call_id);
    if (!id) {
      return [];
    }
    const fn = isRecord(toolCall.function) ? toolCall.function : {};
    const argumentsText = optionalText(fn.arguments);
    const name = optionalString(fn.name);
    return [
      {
        ...(argumentsText === undefined
          ? {}
          : { arguments: argumentsText }),
        id,
        ...(name ? { name } : {}),
      },
    ];
  });
  return toolCalls.length > 0 ? toolCalls : undefined;
}

function parseSession(value: unknown): HermesSessionSummary {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id) {
    throw new HermesClientError('Hermes returned an invalid session.', {
      code: 'invalid_session',
      kind: 'protocol',
    });
  }

  return {
    endReason: optionalString(value.end_reason),
    endedAt: optionalNumber(value.ended_at),
    id: value.id,
    lastActive: optionalNumber(value.last_active),
    messageCount: optionalNumber(value.message_count),
    model: optionalString(value.model),
    parentSessionId: optionalString(value.parent_session_id),
    preview: optionalString(value.preview),
    source: optionalString(value.source),
    startedAt: optionalNumber(value.started_at),
    title: optionalString(value.title),
    toolCallCount: optionalNumber(value.tool_call_count),
  };
}

function parseMessage(value: unknown, fallbackSessionId: string): HermesConversationMessage {
  if (!isRecord(value)) {
    throw new HermesClientError('Hermes returned an invalid conversation message.', {
      code: 'invalid_message',
      kind: 'protocol',
    });
  }

  return {
    content: normalizeMessageContent(value.content),
    id: optionalString(value.id),
    role: normalizeMessageRole(value.role),
    sessionId: optionalString(value.session_id) ?? fallbackSessionId,
    timestamp: optionalNumber(value.timestamp),
    toolCallId:
      optionalString(value.tool_call_id) ??
      optionalString(value.call_id),
    toolCalls: parseToolCalls(value.tool_calls),
    toolName: optionalString(value.tool_name),
  };
}

function validateIdentifier(value: string, label: string) {
  if (
    !value ||
    value.length > MAX_IDENTIFIER_LENGTH ||
    /[\u0000-\u001f\u007f/?#\\]/.test(value)
  ) {
    throw new HermesClientError(`${label} is invalid.`, {
      code: 'invalid_identifier',
      kind: 'configuration',
    });
  }
}

export function normalizeHermesBaseUrl(
  baseUrl: string,
  options: Pick<HermesConnectionConfig, 'allowInsecureHttp'> = {},
) {
  let url: URL;
  try {
    url = new URL(baseUrl.trim());
  } catch {
    throw new HermesClientError('Enter a valid Hermes API Server URL.', {
      code: 'invalid_base_url',
      kind: 'configuration',
    });
  }

  if (url.protocol !== 'https:' && !(options.allowInsecureHttp && url.protocol === 'http:')) {
    throw new HermesClientError('Hermes must use HTTPS outside explicit local development.', {
      code: 'insecure_base_url',
      kind: 'configuration',
    });
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new HermesClientError(
      'The Hermes API Server URL cannot include credentials, a query, or a fragment.',
      {
        code: 'invalid_base_url',
        kind: 'configuration',
      },
    );
  }

  url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString().replace(/\/$/, '');
}

function createRequestContext(externalSignal: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  let didTimeOut = false;

  const onExternalAbort = () => controller.abort();
  if (externalSignal?.aborted) {
    controller.abort();
  } else {
    externalSignal?.addEventListener('abort', onExternalAbort, { once: true });
  }

  const timeout = setTimeout(() => {
    didTimeOut = true;
    controller.abort();
  }, timeoutMs);

  let timeoutCleared = false;
  const clearRequestTimeout = () => {
    if (!timeoutCleared) {
      clearTimeout(timeout);
      timeoutCleared = true;
    }
  };

  const context: RequestContext = {
    cleanup: () => {
      clearRequestTimeout();
      externalSignal?.removeEventListener('abort', onExternalAbort);
    },
    clearTimeout: clearRequestTimeout,
    externalSignal,
    signal: controller.signal,
    timedOut: () => didTimeOut,
  };
  return context;
}

function errorKindForStatus(status: number) {
  if (status === 401 || status === 403) {
    return 'authentication' as const;
  }
  if (status === 404) {
    return 'not_found' as const;
  }
  if (status === 429) {
    return 'rate_limited' as const;
  }
  if (status >= 500) {
    return 'server' as const;
  }
  return 'protocol' as const;
}

async function parseErrorResponse(response: Response, bearerToken: string) {
  let code: string | undefined;
  let message = `Hermes request failed with HTTP ${response.status}.`;

  try {
    const text = (await response.text()).slice(0, 16_384);
    const body: unknown = JSON.parse(text);
    if (isRecord(body) && isRecord(body.error)) {
      code = optionalString(body.error.code);
      message = redactHermesErrorText(body.error.message, [bearerToken]);
    }
  } catch {
    // The stable status-based message is safer than including an unknown body.
  }

  const kind = errorKindForStatus(response.status);
  return new HermesClientError(message, {
    code,
    kind,
    retryable: kind === 'rate_limited' || kind === 'server',
    status: response.status,
  });
}

function normalizeRequestFailure(error: unknown, context: RequestContext) {
  if (error instanceof HermesClientError) {
    return error;
  }
  if (context.externalSignal?.aborted) {
    return new HermesClientError('Hermes request was cancelled.', {
      cause: error,
      code: 'request_cancelled',
      kind: 'cancelled',
    });
  }
  if (context.timedOut()) {
    return new HermesClientError('Hermes did not respond before the request timed out.', {
      cause: error,
      code: 'request_timeout',
      kind: 'timeout',
      retryable: true,
    });
  }
  return new HermesClientError('Could not reach the Hermes API Server.', {
    cause: error,
    code: 'network_error',
    kind: 'network',
    retryable: true,
  });
}

function parseStreamFrame(frame: HermesSseFrame, bearerToken: string): HermesStreamEvent {
  if (!STREAM_EVENT_NAMES.has(frame.event)) {
    throw new HermesClientError(`Hermes sent an unsupported stream event: ${frame.event}.`, {
      code: 'unknown_stream_event',
      kind: 'protocol',
    });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(frame.data);
  } catch {
    throw new HermesClientError('Hermes sent malformed stream data.', {
      code: 'invalid_stream_json',
      kind: 'protocol',
    });
  }
  if (!isRecord(payload)) {
    throw new HermesClientError('Hermes sent an invalid stream event.', {
      code: 'invalid_stream_event',
      kind: 'protocol',
    });
  }

  const base = {
    runId: requiredString(payload.run_id, 'run_id'),
    sequence: requiredNumber(payload.seq, 'seq'),
    sessionId: requiredString(payload.session_id, 'session_id'),
    timestamp: requiredNumber(payload.ts, 'ts'),
  };

  switch (frame.event) {
    case 'run.started':
      return { ...base, type: frame.event };
    case 'message.started': {
      const message = isRecord(payload.message) ? payload.message : {};
      return {
        ...base,
        messageId: requiredString(message.id, 'message.id'),
        type: frame.event,
      };
    }
    case 'assistant.delta':
      return {
        ...base,
        delta: requiredString(payload.delta, 'delta'),
        messageId: requiredString(payload.message_id, 'message_id'),
        type: frame.event,
      };
    case 'tool.progress':
    case 'tool.started':
    case 'tool.completed':
    case 'tool.failed': {
      const toolInput = optionalText(payload.args);
      const toolOutput = optionalText(payload.preview);
      return {
        ...base,
        messageId: optionalString(payload.message_id),
        status: frame.event.slice('tool.'.length) as
          | 'completed'
          | 'failed'
          | 'progress'
          | 'started',
        ...(toolInput === undefined
          ? {}
          : { toolInput }),
        toolName: optionalString(payload.tool_name),
        ...(toolOutput === undefined
          ? {}
          : {
              toolOutput,
              toolOutputIsPreview: true,
            }),
        type: 'tool',
      };
    }
    case 'assistant.completed':
      return {
        ...base,
        content: typeof payload.content === 'string' ? payload.content : '',
        interrupted: payload.interrupted === true,
        messageId: requiredString(payload.message_id, 'message_id'),
        partial: payload.partial === true,
        type: frame.event,
      };
    case 'run.completed':
      return {
        ...base,
        completed: payload.completed === true,
        messageId: optionalString(payload.message_id),
        type: frame.event,
      };
    case 'error':
      return {
        ...base,
        message: redactHermesErrorText(payload.message, [bearerToken]),
        type: frame.event,
      };
    case 'done':
      return { ...base, type: frame.event };
    default:
      throw new HermesClientError('Hermes sent an unsupported stream event.', {
        code: 'unknown_stream_event',
        kind: 'protocol',
      });
  }
}

export class HttpHermesClient implements HermesClient {
  private readonly baseUrl: string;
  private readonly bearerToken: string;
  private readonly fetch: HermesFetch;
  private readonly requestTimeoutMs: number;

  constructor(config: HermesConnectionConfig, options: HttpHermesClientOptions = {}) {
    const bearerToken = config.bearerToken.trim();
    if (!bearerToken) {
      throw new HermesClientError('Enter a Hermes API Server bearer key.', {
        code: 'missing_bearer_token',
        kind: 'configuration',
      });
    }

    this.baseUrl = normalizeHermesBaseUrl(config.baseUrl, config);
    this.bearerToken = bearerToken;
    // Node.js 24 provides the standard fetch implementation used by the companion.
    this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  async createSession(input: HermesCreateSessionInput = {}) {
    if (input.id) {
      validateIdentifier(input.id, 'Session ID');
    }
    const body: Record<string, string> = {};
    if (input.id) body.id = input.id;
    if (input.model) body.model = input.model;
    if (input.title) body.title = input.title;

    const payload = await this.requestJson('/api/sessions', {
      body,
      method: 'POST',
      signal: input.signal,
    });
    if (!isRecord(payload) || !isRecord(payload.session)) {
      throw new HermesClientError('Hermes returned an invalid created session.', {
        code: 'invalid_session',
        kind: 'protocol',
      });
    }
    return parseSession(payload.session);
  }

  async getSessionMessages(sessionId: string, options: HermesRequestOptions = {}) {
    validateIdentifier(sessionId, 'Session ID');
    const payload = await this.requestJson(
      `/api/sessions/${encodeURIComponent(sessionId)}/messages`,
      { signal: options.signal },
    );
    if (!isRecord(payload) || !Array.isArray(payload.data)) {
      throw new HermesClientError('Hermes returned invalid session history.', {
        code: 'invalid_message_list',
        kind: 'protocol',
      });
    }
    const resolvedSessionId = optionalString(payload.session_id) ?? sessionId;
    return payload.data.map((message) => parseMessage(message, resolvedSessionId));
  }

  async listSessions(options: HermesListSessionsOptions = {}) {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), MAX_LIST_LIMIT);
    const offset = Math.max(options.offset ?? 0, 0);
    const query = new URLSearchParams({
      include_children: String(options.includeChildren ?? false),
      limit: String(limit),
      offset: String(offset),
    });
    if (options.source) {
      query.set('source', options.source);
    }

    const payload = await this.requestJson(`/api/sessions?${query.toString()}`, {
      signal: options.signal,
    });
    if (!isRecord(payload) || !Array.isArray(payload.data)) {
      throw new HermesClientError('Hermes returned an invalid session list.', {
        code: 'invalid_session_list',
        kind: 'protocol',
      });
    }
    return payload.data.map(parseSession);
  }

  async probeCapabilities(options: HermesRequestOptions = {}): Promise<HermesCapabilityReport> {
    const payload = await this.requestJson('/v1/capabilities', {
      signal: options.signal,
    });
    return reportHermesCapabilities(parseHermesCapabilities(payload));
  }

  async stopRun(runId: string, options: HermesRequestOptions = {}) {
    validateIdentifier(runId, 'Run ID');
    await this.requestJson(`/v1/runs/${encodeURIComponent(runId)}/stop`, {
      body: {},
      method: 'POST',
      signal: options.signal,
    });
  }

  async *streamChat(
    sessionId: string,
    input: HermesStreamChatInput,
  ): AsyncGenerator<HermesStreamEvent> {
    validateIdentifier(sessionId, 'Session ID');
    if (!input.input.trim()) {
      throw new HermesClientError('A Hermes chat message cannot be empty.', {
        code: 'missing_message',
        kind: 'configuration',
      });
    }

    const context = createRequestContext(input.signal, this.requestTimeoutMs);
    let response: Response;
    try {
      response = await this.fetch(
        this.buildUrl(`/api/sessions/${encodeURIComponent(sessionId)}/chat/stream`),
        {
          body: JSON.stringify({
            input: input.input,
            ...(input.instructions ? { instructions: input.instructions } : {}),
          }),
          headers: this.headers({
            Accept: 'text/event-stream',
            'Content-Type': 'application/json',
          }),
          method: 'POST',
          signal: context.signal,
        },
      );
      context.clearTimeout();
    } catch (error) {
      context.cleanup();
      throw normalizeRequestFailure(error, context);
    }

    if (!response.ok) {
      context.cleanup();
      throw await parseErrorResponse(response, this.bearerToken);
    }
    if (!response.body) {
      context.cleanup();
      throw new HermesClientError('Hermes returned a stream without a response body.', {
        code: 'missing_stream_body',
        kind: 'protocol',
      });
    }

    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
    if (!contentType.startsWith('text/event-stream')) {
      context.cleanup();
      throw new HermesClientError('Hermes returned an unexpected stream content type.', {
        code: 'invalid_stream_content_type',
        kind: 'protocol',
      });
    }

    const reader = response.body.getReader();
    const parser = new HermesSseParser();
    let sawDone = false;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        for (const frame of parser.push(value)) {
          if (sawDone) {
            throw new HermesClientError('Hermes sent data after the stream completed.', {
              code: 'data_after_done',
              kind: 'protocol',
            });
          }
          const event = parseStreamFrame(frame, this.bearerToken);
          sawDone = event.type === 'done';
          yield event;
        }
      }

      for (const frame of parser.finish()) {
        if (sawDone) {
          throw new HermesClientError('Hermes sent data after the stream completed.', {
            code: 'data_after_done',
            kind: 'protocol',
          });
        }
        const event = parseStreamFrame(frame, this.bearerToken);
        sawDone = event.type === 'done';
        yield event;
      }

      if (!sawDone) {
        throw new HermesClientError('Hermes closed the event stream before completion.', {
          code: 'truncated_sse_stream',
          kind: 'protocol',
        });
      }
    } catch (error) {
      throw normalizeRequestFailure(error, context);
    } finally {
      context.cleanup();
      if (!sawDone) {
        try {
          await reader.cancel();
        } catch {
          // Preserve the original stream outcome if the transport rejects cancellation.
        }
      }
      reader.releaseLock();
    }
  }

  private buildUrl(path: string) {
    const url = new URL(this.baseUrl);
    const basePath = url.pathname.replace(/\/+$/, '');
    const [pathWithoutQuery, query = ''] = path.split('?', 2);
    url.pathname = `${basePath}${pathWithoutQuery}`;
    url.search = query;
    return url.toString();
  }

  private headers(extra: Record<string, string> = {}) {
    return {
      Authorization: `Bearer ${this.bearerToken}`,
      ...extra,
    };
  }

  private async requestJson(path: string, options: JsonRequestOptions = {}) {
    const context = createRequestContext(options.signal, this.requestTimeoutMs);
    let response: Response;

    try {
      response = await this.fetch(this.buildUrl(path), {
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        headers: this.headers(
          options.body === undefined
            ? { Accept: 'application/json' }
            : { 'Content-Type': 'application/json' },
        ),
        method: options.method ?? 'GET',
        signal: context.signal,
      });
      context.clearTimeout();

      if (!response.ok) {
        throw await parseErrorResponse(response, this.bearerToken);
      }

      const text = await response.text();
      try {
        return JSON.parse(text) as unknown;
      } catch (error) {
        throw new HermesClientError('Hermes returned malformed JSON.', {
          cause: error,
          code: 'invalid_json',
          kind: 'protocol',
        });
      }
    } catch (error) {
      throw normalizeRequestFailure(error, context);
    } finally {
      context.cleanup();
    }
  }
}
