import {
  WaveCancelTurnResponseSchema,
  WaveCompatibilityResponseSchema,
  WaveCreateSessionRequestSchema,
  WaveDeleteSessionResponseSchema,
  WaveDiagnosticsResponseSchema,
  WaveErrorResponseSchema,
  WaveEndRealtimeCallResponseSchema,
  WaveIdentifierSchema,
  WaveListSessionsRequestSchema,
  WaveRedeemPairingRequestSchema,
  WaveRedeemPairingResponseSchema,
  WaveRevokeCurrentDeviceResponseSchema,
  WaveSessionHistoryResponseSchema,
  WaveSessionListResponseSchema,
  WaveSessionResponseSchema,
  WaveScheduledJobListResponseSchema,
  WaveRealtimeVoiceListResponseSchema,
  WaveStartRealtimeCallRequestSchema,
  WaveStartRealtimeCallResponseSchema,
  WaveStartTurnRequestSchema,
  WaveStatusResponseSchema,
  WaveTimelineRequestSchema,
  WaveTimelineResponseSchema,
  WaveUpdateSessionRequestSchema,
  type WaveTurnEvent,
  type WaveCancelTurnResponse,
  type WaveCompatibilityResponse,
  type WaveCreateSessionRequest,
  type WaveDeleteSessionResponse,
  type WaveDiagnosticsResponse,
  type WaveErrorCode,
  type WaveEndRealtimeCallResponse,
  type WaveRedeemPairingRequest,
  type WaveRedeemPairingResponse,
  type WaveRevokeCurrentDeviceResponse,
  type WaveScheduledJobListResponse,
  type WaveRealtimeVoiceId,
  type WaveRealtimeVoiceListResponse,
  type WaveSessionHistoryResponse,
  type WaveSessionListResponse,
  type WaveSessionResponse,
  type WaveListSessionsRequest,
  type WaveStatusResponse,
  type WaveStartRealtimeCallResponse,
  type WaveTimelineRequest,
  type WaveTimelineResponse,
  type WaveTurnInput,
  type WaveUpdateSessionRequest,
} from '@wave/contracts';
import { fetch as expoFetch } from 'expo/fetch';

import { parseWaveSseStream, WaveSseProtocolError } from './wave-sse.ts';

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_REALTIME_SETUP_TIMEOUT_MS = 35_000;
const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 75_000;
const DEFAULT_STREAM_TOTAL_TIMEOUT_MS = 11 * 60_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export type WaveFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

interface RuntimeSchema<T> {
  safeParse(value: unknown): { data: T; success: true } | { success: false };
}

export interface WaveBackendClientOptions {
  allowInsecureHttp?: boolean;
  baseUrl: string;
  credential?: string;
  fetch?: WaveFetch;
  requestTimeoutMs?: number;
  realtimeSetupTimeoutMs?: number;
  streamIdleTimeoutMs?: number;
  streamTotalTimeoutMs?: number;
}

export type WaveBackendFailureKind =
  WaveErrorCode | 'invalid_base_url' | 'invalid_response' | 'network';

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
  private readonly realtimeSetupTimeoutMs: number;
  private readonly streamIdleTimeoutMs: number;
  private readonly streamTotalTimeoutMs: number;

  constructor(options: WaveBackendClientOptions) {
    this.baseUrl = normalizeWaveBaseUrl(options.baseUrl, {
      allowInsecureHttp: options.allowInsecureHttp,
    });
    this.credential = options.credential;
    this.fetch =
      options.fetch ??
      (expoFetch as unknown as typeof globalThis.fetch).bind(globalThis);
    this.requestTimeoutMs =
      options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.realtimeSetupTimeoutMs =
      options.realtimeSetupTimeoutMs ?? DEFAULT_REALTIME_SETUP_TIMEOUT_MS;
    this.streamIdleTimeoutMs =
      options.streamIdleTimeoutMs ?? DEFAULT_STREAM_IDLE_TIMEOUT_MS;
    this.streamTotalTimeoutMs =
      options.streamTotalTimeoutMs ?? DEFAULT_STREAM_TOTAL_TIMEOUT_MS;
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

  deleteSession(
    sessionId: string,
    signal?: AbortSignal,
  ): Promise<WaveDeleteSessionResponse> {
    const validSessionId = parseClientInput(
      WaveIdentifierSchema,
      sessionId,
      'Enter a valid Wave session identifier.',
    );
    return this.request(
      WaveDeleteSessionResponseSchema,
      `/v1/sessions/${encodeURIComponent(validSessionId)}`,
      {
        authenticated: true,
        method: 'DELETE',
        signal,
      },
    );
  }

  getCompatibility(signal?: AbortSignal): Promise<WaveCompatibilityResponse> {
    return this.request(WaveCompatibilityResponseSchema, '/v1/compatibility', {
      authenticated: true,
      signal,
    });
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

  getSessionTimeline(
    sessionId: string,
    input: Partial<WaveTimelineRequest> = {},
    signal?: AbortSignal,
  ): Promise<WaveTimelineResponse> {
    const validSessionId = parseClientInput(
      WaveIdentifierSchema,
      sessionId,
      'Enter a valid Wave session identifier.',
    );
    const page = parseClientInput(
      WaveTimelineRequestSchema,
      input,
      'Enter valid Wave timeline pagination.',
    );
    const search = new URLSearchParams({
      limit: String(page.limit),
    });
    if (page.before) {
      search.set('before', page.before);
    }
    return this.request(
      WaveTimelineResponseSchema,
      `/v1/sessions/${encodeURIComponent(validSessionId)}/timeline?${search}`,
      {
        authenticated: true,
        signal,
      },
    );
  }

  getStatus(signal?: AbortSignal): Promise<WaveStatusResponse> {
    return this.request(WaveStatusResponseSchema, '/v1/status', { signal });
  }

  getDiagnostics(signal?: AbortSignal): Promise<WaveDiagnosticsResponse> {
    return this.request(WaveDiagnosticsResponseSchema, '/v1/diagnostics', {
      authenticated: true,
      signal,
    });
  }

  listScheduledJobs(
    signal?: AbortSignal,
  ): Promise<WaveScheduledJobListResponse> {
    return this.request(
      WaveScheduledJobListResponseSchema,
      '/v1/operations/jobs',
      {
        authenticated: true,
        signal,
      },
    );
  }

  endRealtimeCall(
    callId: string,
    signal?: AbortSignal,
  ): Promise<WaveEndRealtimeCallResponse> {
    const validCallId = parseClientInput(
      WaveIdentifierSchema,
      callId,
      'Enter a valid Wave Realtime call identifier.',
    );
    return this.request(
      WaveEndRealtimeCallResponseSchema,
      `/v1/realtime/calls/${encodeURIComponent(validCallId)}/end`,
      {
        authenticated: true,
        method: 'POST',
        signal,
      },
    );
  }

  listSessions(
    input: Partial<WaveListSessionsRequest> = {},
    signal?: AbortSignal,
  ): Promise<WaveSessionListResponse> {
    const query = parseClientInput(
      WaveListSessionsRequestSchema,
      input,
      'Enter valid conversation pagination.',
    );
    const search = new URLSearchParams({
      limit: String(query.limit),
      offset: String(query.offset),
    });
    return this.request(
      WaveSessionListResponseSchema,
      `/v1/sessions?${search.toString()}`,
      {
        authenticated: true,
        signal,
      },
    );
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

  revokeCurrentDevice(
    signal?: AbortSignal,
  ): Promise<WaveRevokeCurrentDeviceResponse> {
    return this.request(WaveRevokeCurrentDeviceResponseSchema, '/v1/device', {
      authenticated: true,
      method: 'DELETE',
      signal,
    });
  }

  startRealtimeCall(
    sessionId: string,
    sdpOffer: string,
    voiceId?: WaveRealtimeVoiceId,
    signal?: AbortSignal,
  ): Promise<WaveStartRealtimeCallResponse> {
    const validSessionId = parseClientInput(
      WaveIdentifierSchema,
      sessionId,
      'Enter a valid Wave session identifier.',
    );
    const body = parseClientInput(
      WaveStartRealtimeCallRequestSchema,
      { sdpOffer, ...(voiceId ? { voiceId } : {}) },
      'Wave could not create a valid WebRTC offer.',
    );
    return this.request(
      WaveStartRealtimeCallResponseSchema,
      `/v1/sessions/${encodeURIComponent(validSessionId)}/realtime/calls`,
      {
        authenticated: true,
        body,
        method: 'POST',
        signal,
        timeoutMs: this.realtimeSetupTimeoutMs,
      },
    );
  }

  getRealtimeVoices(
    signal?: AbortSignal,
  ): Promise<WaveRealtimeVoiceListResponse> {
    return this.request(
      WaveRealtimeVoiceListResponseSchema,
      '/v1/realtime/voices',
      {
        authenticated: true,
        signal,
      },
    );
  }

  async *streamTurn(
    sessionId: string,
    input: WaveTurnInput,
    signal?: AbortSignal,
  ): AsyncGenerator<WaveTurnEvent> {
    const validSessionId = parseClientInput(
      WaveIdentifierSchema,
      sessionId,
      'Enter a valid Wave session identifier.',
    );
    const body = parseClientInput(
      WaveStartTurnRequestSchema,
      { input },
      'Enter a valid message.',
    );
    if (!this.credential) {
      throw new WaveBackendError(
        'This Wave connection does not have a device credential.',
        { kind: 'unauthorized' },
      );
    }

    const controller = new AbortController();
    let timeout: 'connect' | 'idle' | 'total' | undefined;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const abortForTimeout = (kind: 'connect' | 'idle' | 'total') => {
      timeout = kind;
      controller.abort();
    };
    const connectTimer = setTimeout(
      () => abortForTimeout('connect'),
      this.requestTimeoutMs,
    );
    const totalTimer = setTimeout(
      () => abortForTimeout('total'),
      this.streamTotalTimeoutMs,
    );
    const resetIdleTimer = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(
        () => abortForTimeout('idle'),
        this.streamIdleTimeoutMs,
      );
    };
    const onAbort = () => controller.abort();
    if (signal?.aborted) {
      controller.abort();
    } else {
      signal?.addEventListener('abort', onAbort, { once: true });
    }

    try {
      const response = await this.fetch(
        this.buildUrl(
          `/v1/sessions/${encodeURIComponent(validSessionId)}/turns`,
        ),
        {
          body: JSON.stringify(body),
          headers: {
            accept: 'text/event-stream',
            authorization: `Bearer ${this.credential}`,
            'content-type': 'application/json',
          },
          method: 'POST',
          redirect: 'error',
          signal: controller.signal,
        },
      );
      clearTimeout(connectTimer);
      if (!response.ok) {
        const payload = await readResponseJson(response);
        throw parseWaveResponseError(response.status, payload);
      }
      if (
        !response.headers
          .get('content-type')
          ?.toLowerCase()
          .startsWith('text/event-stream')
      ) {
        throw new WaveBackendError(
          'Wave Companion returned an incompatible event stream.',
          { kind: 'invalid_response' },
        );
      }
      if (!response.body) {
        throw new WaveBackendError(
          'Wave Companion returned an incompatible event stream.',
          { kind: 'invalid_response' },
        );
      }

      let expectedSequence = 0;
      let turnId: string | undefined;
      let terminal = false;
      resetIdleTimer();
      for await (const event of parseWaveSseStream(response.body, {
        onActivity: resetIdleTimer,
      })) {
        if (
          terminal ||
          event.sessionId !== validSessionId ||
          event.sequence !== expectedSequence ||
          (expectedSequence === 0 && event.type !== 'turn.started') ||
          (turnId !== undefined && event.turnId !== turnId)
        ) {
          throw new WaveBackendError(
            'Wave Companion returned an out-of-order event stream.',
            { kind: 'invalid_response' },
          );
        }
        turnId ??= event.turnId;
        expectedSequence += 1;
        terminal =
          event.type === 'turn.completed' || event.type === 'turn.error';
        yield event;
      }
      if (!terminal) {
        throw new WaveBackendError(
          'Wave Companion ended the event stream unexpectedly.',
          { kind: 'invalid_response' },
        );
      }
    } catch (error) {
      if (error instanceof WaveBackendError) throw error;
      if (error instanceof WaveSseProtocolError) {
        throw new WaveBackendError(
          'Wave Companion returned an incompatible event stream.',
          { kind: 'invalid_response' },
        );
      }
      if (controller.signal.aborted) {
        if (signal?.aborted) {
          throw new WaveBackendError('The Wave turn was cancelled.', {
            kind: 'cancelled',
          });
        }
        if (timeout) {
          throw new WaveBackendError(
            'The Wave turn did not respond before the timeout.',
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
      controller.abort();
      clearTimeout(connectTimer);
      clearTimeout(totalTimer);
      if (idleTimer) clearTimeout(idleTimer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  updateSession(
    sessionId: string,
    input: WaveUpdateSessionRequest,
    signal?: AbortSignal,
  ): Promise<WaveSessionResponse> {
    const validSessionId = parseClientInput(
      WaveIdentifierSchema,
      sessionId,
      'Enter a valid Wave session identifier.',
    );
    const body = parseClientInput(
      WaveUpdateSessionRequestSchema,
      input,
      'Enter a valid conversation title.',
    );
    return this.request(
      WaveSessionResponseSchema,
      `/v1/sessions/${encodeURIComponent(validSessionId)}`,
      {
        authenticated: true,
        body,
        method: 'PATCH',
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
      method?: 'DELETE' | 'GET' | 'PATCH' | 'POST';
      signal?: AbortSignal;
      timeoutMs?: number;
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
    }, options.timeoutMs ?? this.requestTimeoutMs);

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
          options.body === undefined ? undefined : JSON.stringify(options.body),
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
    const [pathWithoutQuery, query = ''] = path.split('?', 2);
    url.pathname = `${url.pathname.replace(/\/+$/, '')}${pathWithoutQuery}`;
    url.search = query;
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
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
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
  return new WaveBackendError(
    'Wave Companion could not complete the request.',
    {
      kind: statusCode === 401 ? 'unauthorized' : 'invalid_response',
      retryable: statusCode >= 500,
      statusCode,
    },
  );
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
