import {
  WaveCancelTurnResponseSchema,
  WaveCompatibilityResponseSchema,
  WaveCreateSessionRequestSchema,
  WaveErrorResponseSchema,
  WaveIdentifierSchema,
  WaveRedeemPairingRequestSchema,
  WaveRedeemPairingResponseSchema,
  WaveSessionHistoryResponseSchema,
  WaveSessionListResponseSchema,
  WaveSessionResponseSchema,
  WaveStatusResponseSchema,
  type WaveCancelTurnResponse,
  type WaveCompatibilityResponse,
  type WaveCreateSessionRequest,
  type WaveErrorCode,
  type WaveRedeemPairingRequest,
  type WaveRedeemPairingResponse,
  type WaveSessionHistoryResponse,
  type WaveSessionListResponse,
  type WaveSessionResponse,
  type WaveStatusResponse,
} from '@wave/contracts';

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

type WaveFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

interface RuntimeSchema<T> {
  safeParse(value: unknown):
    | { data: T; success: true }
    | { success: false };
}

export interface WaveBackendClientOptions {
  allowInsecureHttp?: boolean;
  baseUrl: string;
  credential?: string;
  fetch?: WaveFetch;
  requestTimeoutMs?: number;
}

export type WaveBackendFailureKind =
  | WaveErrorCode
  | 'invalid_base_url'
  | 'invalid_response'
  | 'network';

interface WaveBackendErrorOptions {
  correlationId?: string;
  kind: WaveBackendFailureKind;
  retryable?: boolean;
  statusCode?: number;
}

export class WaveBackendError extends Error {
  readonly correlationId?: string;
  readonly kind: WaveBackendFailureKind;
  readonly retryable: boolean;
  readonly statusCode?: number;

  constructor(message: string, options: WaveBackendErrorOptions) {
    super(message);
    this.name = 'WaveBackendError';
    this.correlationId = options.correlationId;
    this.kind = options.kind;
    this.retryable = options.retryable ?? false;
    this.statusCode = options.statusCode;
  }
}

export class WaveBackendClient {
  readonly baseUrl: string;
  private readonly credential?: string;
  private readonly fetch: WaveFetch;
  private readonly requestTimeoutMs: number;

  constructor(options: WaveBackendClientOptions) {
    this.baseUrl = normalizeWaveBaseUrl(options.baseUrl, {
      allowInsecureHttp: options.allowInsecureHttp,
    });
    this.credential = options.credential;
    this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.requestTimeoutMs =
      options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  cancelTurn(
    sessionId: string,
    turnId: string,
    signal?: AbortSignal,
  ): Promise<WaveCancelTurnResponse> {
    const validSessionId = parseClientInput(
      WaveIdentifierSchema,
      sessionId,
      'Enter a valid Wave session identifier.',
    );
    const validTurnId = parseClientInput(
      WaveIdentifierSchema,
      turnId,
      'Enter a valid Wave turn identifier.',
    );
    return this.request(
      WaveCancelTurnResponseSchema,
      `/v1/sessions/${encodeURIComponent(validSessionId)}/turns/${encodeURIComponent(validTurnId)}/cancel`,
      {
        authenticated: true,
        method: 'POST',
        signal,
      },
    );
  }

  createSession(
    input: WaveCreateSessionRequest = {},
    signal?: AbortSignal,
  ): Promise<WaveSessionResponse> {
    const body = parseClientInput(
      WaveCreateSessionRequestSchema,
      input,
      'Enter valid Wave session details.',
    );
    return this.request(WaveSessionResponseSchema, '/v1/sessions', {
      authenticated: true,
      body,
      method: 'POST',
      signal,
    });
  }

  getCompatibility(signal?: AbortSignal): Promise<WaveCompatibilityResponse> {
    return this.request(
      WaveCompatibilityResponseSchema,
      '/v1/compatibility',
      {
        authenticated: true,
        signal,
      },
    );
  }

  getSessionHistory(
    sessionId: string,
    signal?: AbortSignal,
  ): Promise<WaveSessionHistoryResponse> {
    const validSessionId = parseClientInput(
      WaveIdentifierSchema,
      sessionId,
      'Enter a valid Wave session identifier.',
    );
    return this.request(
      WaveSessionHistoryResponseSchema,
      `/v1/sessions/${encodeURIComponent(validSessionId)}/messages`,
      {
        authenticated: true,
        signal,
      },
    );
  }

  getStatus(signal?: AbortSignal): Promise<WaveStatusResponse> {
    return this.request(WaveStatusResponseSchema, '/v1/status', { signal });
  }

  importSessions(signal?: AbortSignal): Promise<WaveSessionListResponse> {
    return this.request(
      WaveSessionListResponseSchema,
      '/v1/sessions/import',
      {
        authenticated: true,
        method: 'POST',
        signal,
      },
    );
  }

  listSessions(signal?: AbortSignal): Promise<WaveSessionListResponse> {
    return this.request(WaveSessionListResponseSchema, '/v1/sessions', {
      authenticated: true,
      signal,
    });
  }

  redeemPairing(
    input: WaveRedeemPairingRequest,
    signal?: AbortSignal,
  ): Promise<WaveRedeemPairingResponse> {
    const body = parseClientInput(
      WaveRedeemPairingRequestSchema,
      input,
      'Enter a valid pairing code and device name.',
    );
    return this.request(
      WaveRedeemPairingResponseSchema,
      '/v1/pairings/redeem',
      {
        body,
        method: 'POST',
        signal,
      },
    );
  }

  private async request<T>(
    schema: RuntimeSchema<T>,
    path: string,
    options: {
      authenticated?: boolean;
      body?: unknown;
      method?: 'GET' | 'POST';
      signal?: AbortSignal;
    },
  ): Promise<T> {
    const controller = new AbortController();
    let timedOut = false;
    const onAbort = () => controller.abort();
    if (options.signal?.aborted) {
      controller.abort();
    } else {
      options.signal?.addEventListener('abort', onAbort, { once: true });
    }
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.requestTimeoutMs);

    try {
      const headers: Record<string, string> = {
        accept: 'application/json',
      };
      if (options.body !== undefined) {
        headers['content-type'] = 'application/json';
      }
      if (options.authenticated) {
        if (!this.credential) {
          throw new WaveBackendError(
            'This Wave connection does not have a device credential.',
            {
              kind: 'unauthorized',
            },
          );
        }
        headers.authorization = `Bearer ${this.credential}`;
      }

      const response = await this.fetch(this.buildUrl(path), {
        body:
          options.body === undefined
            ? undefined
            : JSON.stringify(options.body),
        headers,
        method: options.method ?? 'GET',
        redirect: 'error',
        signal: controller.signal,
      });
      const payload = await readResponseJson(response);
      if (!response.ok) {
        throw parseWaveResponseError(response.status, payload);
      }
      const parsed = schema.safeParse(payload);
      if (!parsed.success) {
        throw new WaveBackendError(
          'Wave Companion returned an incompatible response.',
          {
            kind: 'invalid_response',
          },
        );
      }
      return parsed.data;
    } catch (error) {
      if (error instanceof WaveBackendError) {
        throw error;
      }
      if (controller.signal.aborted) {
        if (options.signal?.aborted) {
          throw new WaveBackendError('The Wave request was cancelled.', {
            kind: 'cancelled',
          });
        }
        if (timedOut) {
          throw new WaveBackendError(
            'Wave Companion did not respond before the timeout.',
            {
              kind: 'timeout',
              retryable: true,
            },
          );
        }
      }
      throw new WaveBackendError('Wave Companion is unavailable.', {
        kind: 'network',
        retryable: true,
      });
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', onAbort);
    }
  }

  private buildUrl(path: string) {
    const url = new URL(this.baseUrl);
    url.pathname = `${url.pathname.replace(/\/+$/, '')}${path}`;
    return url.toString();
  }
}

export function normalizeWaveBaseUrl(
  value: string,
  options: { allowInsecureHttp?: boolean } = {},
) {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new WaveBackendError('Enter a valid Wave Companion URL.', {
      kind: 'invalid_base_url',
    });
  }
  if (
    url.protocol !== 'https:' &&
    !(options.allowInsecureHttp && url.protocol === 'http:')
  ) {
    throw new WaveBackendError(
      'Wave Companion must use HTTPS outside local development.',
      {
        kind: 'invalid_base_url',
      },
    );
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new WaveBackendError(
      'The Wave Companion URL cannot include credentials, a query, or a fragment.',
      {
        kind: 'invalid_base_url',
      },
    );
  }
  url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString().replace(/\/$/, '');
}

async function readResponseJson(response: Response) {
  const contentLength = Number(response.headers.get('content-length'));
  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_RESPONSE_BYTES
  ) {
    throw new WaveBackendError('Wave Companion returned too much data.', {
      kind: 'invalid_response',
    });
  }
  const text = await readBoundedResponseText(response);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new WaveBackendError(
      'Wave Companion returned an incompatible response.',
      {
        kind: 'invalid_response',
      },
    );
  }
}

async function readBoundedResponseText(response: Response) {
  if (!response.body?.getReader) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength <= MAX_RESPONSE_BYTES) {
      return text;
    }
    throw new WaveBackendError('Wave Companion returned too much data.', {
      kind: 'invalid_response',
    });
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let byteLength = 0;
  let text = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      byteLength += chunk.value.byteLength;
      if (byteLength > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new WaveBackendError('Wave Companion returned too much data.', {
          kind: 'invalid_response',
        });
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

function parseWaveResponseError(statusCode: number, payload: unknown) {
  const parsed = WaveErrorResponseSchema.safeParse(payload);
  if (parsed.success) {
    return new WaveBackendError(parsed.data.error.message, {
      ...(parsed.data.error.correlationId
        ? { correlationId: parsed.data.error.correlationId }
        : {}),
      kind: parsed.data.error.code,
      retryable: parsed.data.error.retryable,
      statusCode,
    });
  }
  return new WaveBackendError('Wave Companion could not complete the request.', {
    kind: statusCode === 401 ? 'unauthorized' : 'invalid_response',
    retryable: statusCode >= 500,
    statusCode,
  });
}

function parseClientInput<T>(
  schema: RuntimeSchema<T>,
  value: unknown,
  message: string,
) {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new WaveBackendError(message, {
      kind: 'bad_request',
    });
  }
  return parsed.data;
}
