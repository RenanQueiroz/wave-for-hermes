/**
 * Direct Hermes gateway client.
 *
 * Implements the same surface the mobile screens already consume from
 * `WaveBackendClient` (sessions, timeline, turn streaming, cancel) but speaks
 * the gateway's own protocol: REST + cookie tokens for finite reads and
 * lifecycle, JSON-RPC over `/api/ws` for live turns.
 *
 * Boundaries kept from the companion era: gateway protocol shapes never leave
 * this module (see `gateway-normalize.ts`), tokens are opaque values held by
 * the caller's store, and errors are normalized to `WaveBackendError` so the
 * offline/retry classification keeps working unchanged.
 *
 * Protocol reference: `plans/gateway-protocol-notes.md`.
 */
import type {
  WaveConversationMessage,
  WaveSessionSummary,
  WaveTimelineResponse,
  WaveTurnEvent,
  WaveTurnInput,
} from '@wave/contracts';
import { fetch as expoFetch } from 'expo/fetch';

import {
  normalizeSessionRows,
  normalizeTimelineEntries,
} from './gateway-normalize.ts';
import { GatewayRpc, GatewayRpcError } from './gateway-rpc.ts';
import {
  GatewayTurnTranslator,
  type GatewayTurnFrame,
} from './gateway-turn-events.ts';
import {
  isCompleteTokenSet,
  mergeRotatedTokens,
  parseGatewaySetCookies,
  toCookieHeader,
  type GatewayTokens,
} from './gateway-tokens.ts';
import {
  applyDefaultScheme,
  isPrivateLanPlainHttpHost,
  isTrustedPlainHttpHost,
} from '../wave/companion-url-policy.ts';
import { WaveBackendError } from '../wave/wave-backend-client.ts';

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const TURN_IDLE_TIMEOUT_MS = 120_000;
const WS_CONNECT_TIMEOUT_MS = 20_000;
const TIMELINE_PAGE_LIMIT = 200;
// The gateway caps transcription uploads at 25 MiB; base64 inflates by 4/3, so
// refuse locally rather than spending the upload to earn a 413.
const MAX_AUDIO_DATA_URL_CHARS = Math.floor((25 * 1024 * 1024 * 4) / 3);
const MAX_TRANSCRIPT_CHARS = 32_000;
const MAX_SPEAK_CHARS = 4_000;

export interface GatewayTokenSink {
  (tokens: GatewayTokens): void;
}

export interface GatewayClientOptions {
  allowInsecureHttp?: boolean;
  baseUrl: string;
  fetch?: typeof globalThis.fetch;
  onTokensRotated?: GatewayTokenSink;
  requestTimeoutMs?: number;
  socketFactory?: (url: string) => WebSocket;
  tokens: GatewayTokens;
}

interface GatewayRequestOptions {
  body?: unknown;
  method?: 'DELETE' | 'GET' | 'PATCH' | 'POST';
  signal?: AbortSignal;
}

/** Normalize a gateway base URL under the same scheme policy as pairing. */
export function normalizeGatewayBaseUrl(
  value: string,
  options: { allowInsecureHttp?: boolean } = {},
): string {
  let url: URL;
  try {
    url = new URL(applyDefaultScheme(value));
  } catch {
    throw new WaveBackendError('Enter a valid Hermes gateway URL.', {
      kind: 'invalid_base_url',
    });
  }
  const insecureAllowed =
    options.allowInsecureHttp ||
    isTrustedPlainHttpHost(url.hostname) ||
    isPrivateLanPlainHttpHost(url.hostname);
  if (
    url.protocol !== 'https:' &&
    !(insecureAllowed && url.protocol === 'http:')
  ) {
    throw new WaveBackendError(
      'The Hermes gateway must use HTTPS unless it is reached over localhost, a Tailscale (100.64.0.0/10) address, or a private LAN (RFC 1918 or .local) address.',
      { kind: 'invalid_base_url' },
    );
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new WaveBackendError(
      'The Hermes gateway URL cannot include credentials, a query, or a fragment.',
      { kind: 'invalid_base_url' },
    );
  }
  url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString().replace(/\/$/, '');
}

export class GatewayClient {
  readonly baseUrl: string;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly onTokensRotated?: GatewayTokenSink;
  private readonly requestTimeoutMs: number;
  private readonly socketFactory: (url: string) => WebSocket;
  private tokens: GatewayTokens;
  /**
   * Pending placeholder id → the real gateway session created for it.
   *
   * A new conversation has no gateway session until its first turn, but the
   * screen already navigated to a route keyed by the placeholder. Remembering
   * the mapping keeps that route stable while every later call (timeline,
   * rename, delete, cancel) reaches the real session.
   */
  private readonly resolvedSessions = new Map<string, string>();

  constructor(options: GatewayClientOptions) {
    this.baseUrl = normalizeGatewayBaseUrl(options.baseUrl, {
      allowInsecureHttp: options.allowInsecureHttp,
    });
    this.fetchImpl =
      options.fetch ??
      (expoFetch as unknown as typeof globalThis.fetch).bind(globalThis);
    this.onTokensRotated = options.onTokensRotated;
    this.requestTimeoutMs =
      options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.socketFactory =
      options.socketFactory ?? ((url: string) => new WebSocket(url));
    this.tokens = options.tokens;
  }

  /** Cheap authenticated probe used as the connection's liveness check. */
  async getIdentity(signal?: AbortSignal): Promise<{ userId: string }> {
    const body = await this.request('/api/auth/me', { signal });
    const userId =
      typeof (body as { user_id?: unknown }).user_id === 'string'
        ? (body as { user_id: string }).user_id
        : '';
    return { userId };
  }

  async listSessions(
    input: { limit?: number; offset?: number } = {},
    signal?: AbortSignal,
  ): Promise<{
    hasMore: boolean;
    limit: number;
    offset: number;
    sessions: WaveSessionSummary[];
  }> {
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
    const offset = Math.max(input.offset ?? 0, 0);
    const body = await this.request(
      `/api/sessions?limit=${limit}&offset=${offset}`,
      { signal },
    );
    const sessions = normalizeSessionRows(body);
    return { hasMore: sessions.length >= limit, limit, offset, sessions };
  }

  async getSessionTimeline(
    sessionId: string,
    input: { before?: string; limit?: number } = {},
    signal?: AbortSignal,
  ): Promise<WaveTimelineResponse> {
    sessionId = this.resolveSessionId(sessionId);
    // A conversation the user just started has no gateway session yet (one is
    // created on first send), so its timeline is empty by definition. Asking
    // the gateway would 404 and the chat screen would bounce back to the
    // new-conversation screen in a loop.
    if (isPendingSessionId(sessionId)) {
      return {
        apiVersion: 'v1',
        entries: [],
        hasMore: false,
        limit: Math.min(Math.max(input.limit ?? 100, 1), TIMELINE_PAGE_LIMIT),
        sessionId,
      };
    }
    // The gateway pages by numeric offset from the oldest message, while Wave
    // pages backwards from the newest with an opaque cursor. `before` carries
    // the offset of the oldest entry already held.
    const limit = Math.min(
      Math.max(input.limit ?? 100, 1),
      TIMELINE_PAGE_LIMIT,
    );
    const before = Number.parseInt(input.before ?? '', 10);
    const end = Number.isFinite(before) ? before : undefined;
    const all = await this.request(
      `/api/sessions/${encodeURIComponent(sessionId)}/messages?limit=500`,
      { signal },
    );
    const entries = normalizeTimelineEntries(all);
    const upper = end ?? entries.length;
    const lower = Math.max(upper - limit, 0);
    const page = entries.slice(lower, upper);
    return {
      apiVersion: 'v1',
      entries: page,
      hasMore: lower > 0,
      limit,
      ...(lower > 0 ? { nextCursor: String(lower) } : {}),
      sessionId,
    };
  }

  async createSession(
    _input: unknown = {},
    signal?: AbortSignal,
  ): Promise<{ apiVersion: 'v1'; session: WaveSessionSummary }> {
    // A gateway session only exists in storage once it holds a turn, so a
    // "new conversation" is a local placeholder until the first send. The
    // caller treats this id as opaque; `streamTurn` resolves it.
    void _input;
    void signal;
    return {
      apiVersion: 'v1',
      session: { id: `${PENDING_SESSION_PREFIX}${Date.now()}` },
    };
  }

  async updateSession(
    sessionId: string,
    input: { title: string },
    signal?: AbortSignal,
  ): Promise<{ apiVersion: 'v1'; session: WaveSessionSummary }> {
    sessionId = this.resolveSessionId(sessionId);
    await this.request(`/api/sessions/${encodeURIComponent(sessionId)}`, {
      body: { title: input.title },
      method: 'PATCH',
      signal,
    });
    return {
      apiVersion: 'v1',
      session: { id: sessionId, title: input.title },
    };
  }

  async deleteSession(
    sessionId: string,
    signal?: AbortSignal,
  ): Promise<{ apiVersion: 'v1'; deleted: true; sessionId: string }> {
    sessionId = this.resolveSessionId(sessionId);
    if (isPendingSessionId(sessionId)) {
      return { apiVersion: 'v1', deleted: true, sessionId };
    }
    await this.request(`/api/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'DELETE',
      signal,
    });
    return { apiVersion: 'v1', deleted: true, sessionId };
  }

  async getSessionHistory(
    sessionId: string,
    signal?: AbortSignal,
  ): Promise<{
    apiVersion: 'v1';
    messages: WaveConversationMessage[];
    sessionId: string;
  }> {
    const timeline = await this.getSessionTimeline(
      sessionId,
      { limit: TIMELINE_PAGE_LIMIT },
      signal,
    );
    return {
      apiVersion: 'v1',
      messages: timeline.entries.flatMap((entry) =>
        entry.type === 'message' ? [entry.message] : [],
      ),
      sessionId,
    };
  }

  /**
   * Run a turn over a dedicated WebSocket and yield Wave turn events.
   *
   * One socket per turn keeps failure handling simple: the socket's lifetime
   * is exactly the turn's, and dropping it never disturbs another turn. The
   * gateway keeps a running turn alive across the disconnect (verified in the
   * stage 1 spike), so an interrupted stream reconciles from history rather
   * than replaying frames.
   */
  async *streamTurn(
    sessionId: string,
    input: WaveTurnInput,
    signal?: AbortSignal,
  ): AsyncGenerator<WaveTurnEvent> {
    const text = turnInputToText(input);
    const attachments = turnInputAttachments(input);
    sessionId = this.resolveSessionId(sessionId);
    const connection = await this.openSocket(signal);
    const { events, rpc, close } = connection;
    try {
      const liveSessionId = await this.resolveLiveSession(rpc, sessionId);
      for (const attachment of attachments) {
        await rpc.call('image.attach_bytes', {
          content_base64: attachment.base64,
          filename: attachment.name,
          session_id: liveSessionId,
        });
      }
      const turnId = `gw-turn-${Date.now()}`;
      const translator = new GatewayTurnTranslator({
        messageId: `${turnId}-assistant`,
        sessionId,
        turnId,
      });
      yield translator.start();
      void rpc
        .call('prompt.submit', { session_id: liveSessionId, text })
        .catch(() => events.fail());
      yield* this.pump(events, translator, signal);
    } finally {
      close();
    }
  }

  /**
   * Reattach to a turn that was running when the socket dropped. The gateway
   * has no frame replay, so this resumes the session and returns nothing —
   * the caller reconciles from the refreshed timeline.
   */
  async *resumeTurnStream(
    sessionId: string,
    _turnId: string,
    _after: number,
    signal?: AbortSignal,
  ): AsyncGenerator<WaveTurnEvent> {
    void _turnId;
    void _after;
    const connection = await this.openSocket(signal);
    try {
      await connection.rpc.call('session.resume', { session_id: sessionId });
    } catch (error) {
      throw toWaveError(error);
    } finally {
      connection.close();
    }
  }

  async getActiveTurn(
    sessionId: string,
    signal?: AbortSignal,
  ): Promise<{
    activeTurn: { latestSequence: number; turnId: string } | null;
    apiVersion: 'v1';
    sessionId: string;
  }> {
    sessionId = this.resolveSessionId(sessionId);
    if (isPendingSessionId(sessionId)) {
      return { activeTurn: null, apiVersion: 'v1', sessionId };
    }
    const connection = await this.openSocket(signal);
    try {
      const result = await connection.rpc.call('session.active_list', {});
      const sessions = Array.isArray(result.sessions) ? result.sessions : [];
      const match = sessions.find(
        (entry) =>
          typeof entry === 'object' &&
          entry !== null &&
          ((entry as Record<string, unknown>).session_key === sessionId ||
            (entry as Record<string, unknown>).id === sessionId),
      ) as Record<string, unknown> | undefined;
      const running = match?.status === 'running' || match?.running === true;
      return {
        activeTurn: running
          ? { latestSequence: -1, turnId: `gw-active-${sessionId}` }
          : null,
        apiVersion: 'v1',
        sessionId,
      };
    } catch {
      return { activeTurn: null, apiVersion: 'v1', sessionId };
    } finally {
      connection.close();
    }
  }

  // ---- audio ------------------------------------------------------------

  /**
   * Transcribe a recording through the gateway's configured STT provider.
   *
   * The gateway takes base64 data URLs only and caps the upload at 25 MiB;
   * no provider key ever reaches the client.
   */
  async transcribeAudio(
    input: { dataUrl: string; mimeType: string },
    signal?: AbortSignal,
  ): Promise<{ provider?: string; transcript: string }> {
    if (input.dataUrl.length > MAX_AUDIO_DATA_URL_CHARS) {
      throw new WaveBackendError('That recording is too long to transcribe.', {
        kind: 'bad_request',
      });
    }
    const body = await this.request('/api/audio/transcribe', {
      body: { data_url: input.dataUrl, mime_type: input.mimeType },
      method: 'POST',
      signal,
    });
    const record = body as { provider?: unknown; transcript?: unknown };
    return {
      ...(typeof record.provider === 'string'
        ? { provider: record.provider }
        : {}),
      transcript:
        typeof record.transcript === 'string'
          ? record.transcript.slice(0, MAX_TRANSCRIPT_CHARS)
          : '',
    };
  }

  /**
   * Synthesize speech through the gateway's configured TTS provider. 0.19.0
   * answers with a buffered data URL (no streaming endpoint at this version),
   * which is fine for message-length playback.
   */
  async speakText(
    text: string,
    signal?: AbortSignal,
  ): Promise<{ dataUrl: string; mimeType: string; provider?: string }> {
    const trimmed = text.trim().slice(0, MAX_SPEAK_CHARS);
    if (!trimmed) {
      throw new WaveBackendError('There is nothing to read aloud.', {
        kind: 'bad_request',
      });
    }
    const body = await this.request('/api/audio/speak', {
      body: { text: trimmed },
      method: 'POST',
      signal,
    });
    const record = body as {
      data_url?: unknown;
      mime_type?: unknown;
      provider?: unknown;
    };
    if (typeof record.data_url !== 'string' || !record.data_url) {
      throw new WaveBackendError('Hermes returned no audio to play.', {
        kind: 'invalid_response',
      });
    }
    return {
      dataUrl: record.data_url,
      mimeType:
        typeof record.mime_type === 'string' ? record.mime_type : 'audio/mpeg',
      ...(typeof record.provider === 'string'
        ? { provider: record.provider }
        : {}),
    };
  }

  /**
   * Which speech capabilities this gateway has configured. There is no public
   * capability flag on 0.19.0, so this reads the authenticated config once;
   * a gateway that cannot answer is reported as having neither, and the
   * affordances disable rather than failing mid-interaction.
   */
  async getAudioCapabilities(
    signal?: AbortSignal,
  ): Promise<{ stt: boolean; tts: boolean }> {
    try {
      const config = await this.request('/api/config', { signal });
      return readAudioCapabilities(config);
    } catch {
      return { stt: false, tts: false };
    }
  }

  async cancelTurn(
    sessionId: string,
    turnId: string,
    signal?: AbortSignal,
  ): Promise<{
    apiVersion: 'v1';
    status: 'cancellation_requested';
    turnId: string;
  }> {
    const connection = await this.openSocket(signal);
    try {
      await connection.rpc.call('session.interrupt', { session_id: sessionId });
      return {
        apiVersion: 'v1',
        status: 'cancellation_requested',
        turnId,
      };
    } catch (error) {
      throw toWaveError(error);
    } finally {
      connection.close();
    }
  }

  // ---- internals ---------------------------------------------------------

  /** Follow a pending placeholder to the real session, when one exists. */
  private resolveSessionId(sessionId: string): string {
    return this.resolvedSessions.get(sessionId) ?? sessionId;
  }

  private async resolveLiveSession(
    rpc: GatewayRpc,
    sessionId: string,
  ): Promise<string> {
    if (isPendingSessionId(sessionId)) {
      const created = await rpc.call('session.create', {});
      const live = created.session_id;
      const stored = created.stored_session_id;
      if (typeof live !== 'string' || !live) {
        throw new WaveBackendError('Hermes could not start a conversation.', {
          kind: 'upstream_unavailable',
          retryable: true,
        });
      }
      // Later reads address the STORED id (the durable db key); the live id is
      // only valid for this socket.
      this.resolvedSessions.set(
        sessionId,
        typeof stored === 'string' && stored ? stored : live,
      );
      return live;
    }
    const resumed = await rpc.call('session.resume', {
      session_id: sessionId,
    });
    const live = resumed.session_id;
    return typeof live === 'string' && live ? live : sessionId;
  }

  private async *pump(
    events: TurnEventQueue,
    translator: GatewayTurnTranslator,
    signal?: AbortSignal,
  ): AsyncGenerator<WaveTurnEvent> {
    while (true) {
      if (signal?.aborted) {
        throw new WaveBackendError('Wave cancelled this turn.', {
          kind: 'cancelled',
        });
      }
      const frame = await events.next(signal);
      if (frame === undefined) {
        yield* translator.finish({ interrupted: false });
        return;
      }
      if (frame === TURN_STREAM_FAILED) {
        throw new WaveBackendError('Wave lost the connection to Hermes.', {
          kind: 'network',
          retryable: true,
        });
      }
      for (const event of translator.translate(frame)) {
        yield event;
        if (event.type === 'turn.completed' || event.type === 'turn.error') {
          return;
        }
      }
    }
  }

  private async openSocket(signal?: AbortSignal): Promise<{
    close(): void;
    events: TurnEventQueue;
    rpc: GatewayRpc;
  }> {
    const ticket = await this.mintTicket(signal);
    const wsBase = this.baseUrl.replace(/^http/, 'ws');
    const socket = this.socketFactory(
      `${wsBase}/api/ws?ticket=${encodeURIComponent(ticket)}`,
    );
    const events = new TurnEventQueue();
    const rpc = new GatewayRpc({
      onEvent: (event) => events.push(event),
      socket: {
        close: (code, reason) => socket.close(code, reason),
        send: (data) => socket.send(data),
      },
    });
    socket.onmessage = (message: { data: unknown }) => {
      if (typeof message.data === 'string') rpc.handleMessage(message.data);
    };
    socket.onerror = () => {
      rpc.fail(
        new WaveBackendError('Wave lost the connection to Hermes.', {
          kind: 'network',
          retryable: true,
        }),
      );
      events.fail();
    };
    socket.onclose = () => {
      rpc.fail(
        new WaveBackendError('Hermes closed the connection.', {
          kind: 'network',
          retryable: true,
        }),
      );
      events.close();
    };

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.close();
        reject(
          new WaveBackendError(
            'Hermes did not accept the connection in time.',
            {
              kind: 'timeout',
              retryable: true,
            },
          ),
        );
      }, WS_CONNECT_TIMEOUT_MS);
      socket.onopen = () => {
        clearTimeout(timer);
        resolve();
      };
      const failOpen = () => {
        clearTimeout(timer);
        reject(
          new WaveBackendError('Wave could not reach Hermes.', {
            kind: 'network',
            retryable: true,
          }),
        );
      };
      socket.onerror = failOpen;
      signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          socket.close();
          reject(
            new WaveBackendError('Wave cancelled this turn.', {
              kind: 'cancelled',
            }),
          );
        },
        { once: true },
      );
    });

    // Re-arm the runtime handlers now that the open race is settled.
    socket.onerror = () => {
      rpc.fail(
        new WaveBackendError('Wave lost the connection to Hermes.', {
          kind: 'network',
          retryable: true,
        }),
      );
      events.fail();
    };

    return {
      close: () => {
        try {
          socket.close(1000, 'wave turn finished');
        } catch {
          // Already closed.
        }
      },
      events,
      rpc,
    };
  }

  private async mintTicket(signal?: AbortSignal): Promise<string> {
    const body = await this.request('/api/auth/ws-ticket', {
      method: 'POST',
      signal,
    });
    const ticket = (body as { ticket?: unknown }).ticket;
    if (typeof ticket !== 'string' || !ticket) {
      throw new WaveBackendError('Hermes did not issue a connection ticket.', {
        kind: 'invalid_response',
      });
    }
    return ticket;
  }

  private async request(
    path: string,
    options: GatewayRequestOptions = {},
  ): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    const abort = () => controller.abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        body:
          options.body === undefined ? undefined : JSON.stringify(options.body),
        headers: {
          accept: 'application/json',
          cookie: toCookieHeader(this.tokens),
          ...(options.body === undefined
            ? {}
            : { 'content-type': 'application/json' }),
        },
        method: options.method ?? 'GET',
        signal: controller.signal,
      });
    } catch (error) {
      if (options.signal?.aborted) {
        throw new WaveBackendError('Wave cancelled this request.', {
          kind: 'cancelled',
        });
      }
      if (controller.signal.aborted) {
        throw new WaveBackendError('Hermes took too long to respond.', {
          kind: 'timeout',
          retryable: true,
        });
      }
      throw new WaveBackendError('Wave could not reach Hermes.', {
        cause: error,
        kind: 'network',
        retryable: true,
      } as never);
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
    }

    this.harvestTokens(response);

    if (response.status === 401 || response.status === 403) {
      throw new WaveBackendError(
        'This device is no longer signed in to Hermes.',
        { kind: 'unauthorized', statusCode: response.status },
      );
    }
    if (response.status === 404) {
      throw new WaveBackendError('Hermes could not find that conversation.', {
        kind: 'not_found',
        statusCode: 404,
      });
    }
    if (response.status >= 500) {
      throw new WaveBackendError('Hermes reported a server error.', {
        kind: 'upstream_unavailable',
        retryable: true,
        statusCode: response.status,
      });
    }
    if (!response.ok) {
      throw new WaveBackendError('Hermes rejected the request.', {
        kind: 'bad_request',
        statusCode: response.status,
      });
    }

    try {
      return await response.json();
    } catch {
      throw new WaveBackendError('Hermes returned an unreadable response.', {
        kind: 'invalid_response',
      });
    }
  }

  /**
   * The gateway rotates both tokens whenever it refreshes an expired access
   * token, so every response is a chance to learn a newer pair.
   */
  private harvestTokens(response: Response): void {
    const getSetCookie = (
      response.headers as unknown as { getSetCookie?: () => string[] }
    ).getSetCookie;
    const raw =
      typeof getSetCookie === 'function'
        ? getSetCookie.call(response.headers)
        : splitSetCookie(response.headers.get('set-cookie'));
    if (raw.length === 0) return;
    const rotated = parseGatewaySetCookies(raw);
    const next = mergeRotatedTokens(this.tokens, rotated);
    if (next !== this.tokens) {
      this.tokens = next;
      this.onTokensRotated?.(next);
    }
  }
}

const PENDING_SESSION_PREFIX = 'wave-pending-';
const TURN_STREAM_FAILED = Symbol('turn-stream-failed');

export function isPendingSessionId(sessionId: string): boolean {
  return sessionId.startsWith(PENDING_SESSION_PREFIX);
}

/** Async queue bridging socket callbacks to the turn generator. */
class TurnEventQueue {
  private readonly buffer: (GatewayTurnFrame | typeof TURN_STREAM_FAILED)[] =
    [];
  private closed = false;
  private waiter?: () => void;

  push(frame: GatewayTurnFrame): void {
    this.buffer.push(frame);
    this.wake();
  }

  fail(): void {
    this.buffer.push(TURN_STREAM_FAILED);
    this.wake();
  }

  close(): void {
    this.closed = true;
    this.wake();
  }

  async next(
    signal?: AbortSignal,
  ): Promise<GatewayTurnFrame | typeof TURN_STREAM_FAILED | undefined> {
    while (this.buffer.length === 0 && !this.closed) {
      if (signal?.aborted) return undefined;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, TURN_IDLE_TIMEOUT_MS);
        this.waiter = () => {
          clearTimeout(timer);
          resolve();
        };
        signal?.addEventListener('abort', () => this.wake(), { once: true });
      });
      if (this.buffer.length === 0 && !this.closed) {
        // Idle timeout: treat as a dropped stream so the caller reconciles.
        return TURN_STREAM_FAILED;
      }
    }
    return this.buffer.shift();
  }

  private wake(): void {
    const waiter = this.waiter;
    this.waiter = undefined;
    waiter?.();
  }
}

function turnInputToText(input: WaveTurnInput): string {
  if (typeof input === 'string') return input;
  return input
    .flatMap((part) =>
      part.type === 'text'
        ? [part.text]
        : part.type === 'text_file'
          ? [`--- ${part.name} ---\n${part.text}`]
          : [],
    )
    .join('\n\n');
}

function turnInputAttachments(input: WaveTurnInput) {
  if (typeof input === 'string') return [];
  return input.flatMap((part) =>
    part.type === 'image'
      ? [
          {
            base64: part.dataUrl.slice(part.dataUrl.indexOf(',') + 1),
            name: part.name,
          },
        ]
      : [],
  );
}

/**
 * A provider counts as configured when the config names one and has not
 * disabled the feature. Shapes vary by provider, so only these two fields are
 * trusted.
 */
export function readAudioCapabilities(config: unknown): {
  stt: boolean;
  tts: boolean;
} {
  const section = (name: 'stt' | 'tts') => {
    const value = (config as Record<string, unknown> | null)?.[name];
    if (typeof value !== 'object' || value === null) return false;
    const record = value as Record<string, unknown>;
    if (record.enabled === false) return false;
    return typeof record.provider === 'string' && record.provider.trim() !== '';
  };
  return { stt: section('stt'), tts: section('tts') };
}

function splitSetCookie(value: string | null): string[] {
  if (!value) return [];
  // Split on commas that begin a new `name=` pair, leaving expiry commas alone.
  return value.split(/,(?=\s*[^=;,]+=)/).map((part) => part.trim());
}

function toWaveError(error: unknown): WaveBackendError {
  if (error instanceof WaveBackendError) return error;
  if (error instanceof GatewayRpcError) {
    return new WaveBackendError(error.message, {
      kind: error.code === 4007 ? 'not_found' : 'upstream_unavailable',
      retryable: error.code !== 4007,
    });
  }
  return new WaveBackendError('Hermes could not complete the request.', {
    kind: 'upstream_unavailable',
    retryable: true,
  });
}

export type { GatewayTokens };
export { isCompleteTokenSet };
