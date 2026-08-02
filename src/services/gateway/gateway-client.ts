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
// `/messages` returns rows oldest-first and `limit` keeps the OLDEST rows
// (verified live on 0.19.0), so an uncapped limit is how "from this offset to
// the end" is expressed. The offset bounds the actual payload.
const FETCH_TO_END_LIMIT = 100_000;
// The gateway caps transcription uploads at 25 MiB; base64 inflates by 4/3, so
// refuse locally rather than spending the upload to earn a 413.
const MAX_AUDIO_DATA_URL_CHARS = Math.floor((25 * 1024 * 1024 * 4) / 3);
const MAX_TRANSCRIPT_CHARS = 32_000;
const MAX_SPEAK_CHARS = 4_000;
// Speech synthesis and transcription are model work, not lookups: a locally
// hosted provider routinely takes tens of seconds where a REST read takes
// milliseconds.
const AUDIO_REQUEST_TIMEOUT_MS = 90_000;
const MAX_SEARCH_SNIPPET_CHARS = 300;

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
  /** Overrides the client's default budget for slow endpoints. */
  timeoutMs?: number;
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
  /**
   * Stored session id → the live transport sid from this client's last
   * `session.create`/`session.resume`. `session.interrupt` only accepts live
   * sids (the stored id earns a 4001, verified live on 0.19.0), so cancelling
   * a turn needs the sid the turn was started under.
   */
  private readonly liveSessions = new Map<string, string>();
  /**
   * Stored session id → the RPC channel of the turn currently streaming on
   * it. Mid-turn prompts (approval/clarify/secret/sudo) must be answered on
   * a socket bound to the live session, and the streaming socket is exactly
   * that; entries live only as long as their turn.
   */
  private readonly activeTurns = new Map<
    string,
    { liveSessionId: string; rpc: GatewayRpc }
  >();

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

  /**
   * Full-text search across message CONTENT and session ids.
   *
   * Verified live on 0.19.0: titles are NOT indexed — renaming a session and
   * searching its new title returns nothing — so a title search stays a
   * client-side filter over the loaded session list and this covers what that
   * cannot see. Results carry a highlighted snippet using `>>>term<<<`
   * markers, which are normalized away here.
   */
  async searchSessions(
    query: string,
    input: { limit?: number } = {},
    signal?: AbortSignal,
  ): Promise<{ results: { sessionId: string; snippet?: string }[] }> {
    const trimmed = query.trim();
    if (!trimmed) return { results: [] };
    const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
    const body = await this.request(
      `/api/sessions/search?q=${encodeURIComponent(trimmed)}&limit=${limit}`,
      { signal },
    );
    const rows = (body as { results?: unknown } | null)?.results;
    if (!Array.isArray(rows)) return { results: [] };
    const seen = new Set<string>();
    const results: { sessionId: string; snippet?: string }[] = [];
    for (const row of rows) {
      if (typeof row !== 'object' || row === null) continue;
      const record = row as { session_id?: unknown; snippet?: unknown };
      const sessionId =
        typeof record.session_id === 'string' ? record.session_id.trim() : '';
      if (!sessionId || seen.has(sessionId)) continue;
      seen.add(sessionId);
      const snippet =
        typeof record.snippet === 'string'
          ? record.snippet
              .replace(/>>>|<<</g, '')
              .replace(/\s+/g, ' ')
              .trim()
              .slice(0, MAX_SEARCH_SNIPPET_CHARS)
          : '';
      results.push({ sessionId, ...(snippet ? { snippet } : {}) });
    }
    return { results };
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
    // The gateway pages by numeric offset from the OLDEST message, while Wave
    // pages backwards from the newest with an opaque cursor. `before` carries
    // the offset (in raw gateway rows) of the oldest row already held.
    const limit = Math.min(
      Math.max(input.limit ?? 100, 1),
      TIMELINE_PAGE_LIMIT,
    );
    const before = Number.parseInt(input.before ?? '', 10);

    if (Number.isFinite(before)) {
      // Later pages: the cursor fully determines the window.
      const upper = Math.max(before, 0);
      const lower = Math.max(upper - limit, 0);
      const rows = await this.fetchMessageRows(
        sessionId,
        upper - lower,
        lower,
        signal,
      );
      return {
        apiVersion: 'v1',
        entries: normalizeTimelineEntries({ messages: rows }, lower),
        hasMore: lower > 0,
        limit,
        ...(lower > 0 ? { nextCursor: String(lower) } : {}),
        sessionId,
      };
    }

    // First page: the newest rows live at the END of the ascending history,
    // so start from the session's reported row count. The uncapped limit and
    // the client-side tail slice keep this correct even when that count has
    // drifted from the true total.
    const count = await this.fetchMessageCount(sessionId, signal);
    let offset = Math.max(count - limit, 0);
    let rows = await this.fetchMessageRows(
      sessionId,
      FETCH_TO_END_LIMIT,
      offset,
      signal,
    );
    if (rows.length === 0 && offset > 0) {
      // The reported count overshot the stored rows; take history from the top.
      offset = 0;
      rows = await this.fetchMessageRows(
        sessionId,
        FETCH_TO_END_LIMIT,
        0,
        signal,
      );
    }
    const drop = Math.max(rows.length - limit, 0);
    const lower = offset + drop;
    return {
      apiVersion: 'v1',
      entries: normalizeTimelineEntries({ messages: rows.slice(drop) }, lower),
      hasMore: lower > 0,
      limit,
      ...(lower > 0 ? { nextCursor: String(lower) } : {}),
      sessionId,
    };
  }

  private async fetchMessageRows(
    sessionId: string,
    limit: number,
    offset: number,
    signal?: AbortSignal,
  ): Promise<unknown[]> {
    if (limit <= 0) return [];
    const body = await this.request(
      `/api/sessions/${encodeURIComponent(sessionId)}/messages?limit=${limit}&offset=${offset}`,
      { signal },
    );
    const rows = (body as { messages?: unknown } | null)?.messages;
    return Array.isArray(rows) ? rows : [];
  }

  /** The session's row count from its detail row; 0 when unavailable. */
  private async fetchMessageCount(
    sessionId: string,
    signal?: AbortSignal,
  ): Promise<number> {
    try {
      const body = await this.request(
        `/api/sessions/${encodeURIComponent(sessionId)}`,
        { signal },
      );
      const count = (body as { message_count?: unknown } | null)?.message_count;
      return typeof count === 'number' && Number.isFinite(count) && count > 0
        ? Math.floor(count)
        : 0;
    } catch {
      return 0;
    }
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

  /**
   * Delete a conversation, refusing while a turn is still running.
   *
   * Wave's contract requires an active-turn delete to fail explicitly. The
   * gateway does not enforce that: a mid-turn `DELETE` answers `{"ok":true}`
   * while the turn runs to completion and re-persists the session, so it
   * silently reappears in the list (verified live on 0.19.0). Wave therefore
   * enforces it here, using the gateway's own `session.active_list` status
   * as the signal rather than trusting local state.
   */
  async deleteSession(
    sessionId: string,
    signal?: AbortSignal,
  ): Promise<{ apiVersion: 'v1'; deleted: true; sessionId: string }> {
    sessionId = this.resolveSessionId(sessionId);
    if (isPendingSessionId(sessionId)) {
      return { apiVersion: 'v1', deleted: true, sessionId };
    }
    if (this.activeTurns.has(sessionId)) {
      throw new WaveBackendError(
        'This conversation is still working. Stop it before deleting.',
        { kind: 'conflict' },
      );
    }
    const active = await this.getActiveTurn(sessionId, signal);
    if (active.activeTurn) {
      throw new WaveBackendError(
        'This conversation is still working. Stop it before deleting.',
        { kind: 'conflict' },
      );
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
      // A first turn on a placeholder id learns its stored id only here, and
      // every later lookup (including prompt responses) resolves to that
      // stored id — so the prompt channel must be keyed by it, not by the
      // placeholder this call started with.
      sessionId = this.resolveSessionId(sessionId);
      this.activeTurns.set(sessionId, { liveSessionId, rpc });
      for (const attachment of attachments) {
        try {
          // Queues the image on the live session; the next prompt.submit
          // consumes it (verified live on 0.19.0, including the 25 MiB cap
          // and unsupported-extension rejections).
          await rpc.call('image.attach_bytes', {
            content_base64: attachment.base64,
            filename: attachment.name,
            session_id: liveSessionId,
          });
        } catch (error) {
          // Surface the gateway's own reason ("image too large (…)") instead
          // of a generic transport failure.
          throw toWaveError(error);
        }
      }
      const turnId = `gw-turn-${Date.now()}`;
      const translator = new GatewayTurnTranslator({
        messageId: `${turnId}-assistant`,
        sessionId,
        turnId,
      });
      yield translator.start();
      let submitFailure: WaveBackendError | undefined;
      void rpc
        .call('prompt.submit', { session_id: liveSessionId, text })
        .catch((error: unknown) => {
          submitFailure = toWaveError(error);
          events.fail();
        });
      try {
        yield* this.pump(events, translator, signal);
      } catch (error) {
        // A rejected submit fails the queue; report the submit's actual error
        // rather than the queue's generic dropped-stream one.
        throw submitFailure ?? error;
      }
    } finally {
      if (this.activeTurns.get(sessionId)?.rpc === rpc) {
        this.activeTurns.delete(sessionId);
      }
      close();
    }
  }

  /**
   * Answer the mid-turn prompt currently blocking this session's streaming
   * turn. Approvals resolve the session's oldest pending request (the
   * gateway keys them FIFO, verified live); clarify/secret/sudo correlate by
   * the prompt id the request carried. Secret and sudo are always declined —
   * Wave never collects credentials on the phone.
   */
  async respondToPrompt(
    sessionId: string,
    input:
      | { choice: string; kind: 'approval' }
      | { answer: string; kind: 'clarify'; promptId: string }
      | { kind: 'secret' | 'sudo'; promptId: string },
  ): Promise<void> {
    sessionId = this.resolveSessionId(sessionId);
    const active = this.activeTurns.get(sessionId);
    if (!active) {
      throw new WaveBackendError('This prompt is no longer waiting.', {
        kind: 'not_found',
      });
    }
    try {
      if (input.kind === 'approval') {
        await active.rpc.call('approval.respond', {
          choice: input.choice,
          session_id: active.liveSessionId,
        });
      } else if (input.kind === 'clarify') {
        await active.rpc.call('clarify.respond', {
          answer: input.answer,
          request_id: input.promptId,
          session_id: active.liveSessionId,
        });
      } else if (input.kind === 'secret') {
        await active.rpc.call('secret.respond', {
          request_id: input.promptId,
          session_id: active.liveSessionId,
          value: '',
        });
      } else {
        await active.rpc.call('sudo.respond', {
          password: '',
          request_id: input.promptId,
          session_id: active.liveSessionId,
        });
      }
    } catch (error) {
      throw toWaveError(error);
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

  /**
   * Whether a turn is running for this session, from the gateway's own view.
   *
   * A probe that cannot answer reports "no active turn" rather than failing:
   * this is a hint used to offer resume and to guard deletes, and an
   * unreachable gateway will fail the real operation anyway.
   */
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
    let connection:
      Awaited<ReturnType<GatewayClient['openSocket']>> | undefined;
    try {
      connection = await this.openSocket(signal);
      const result = await connection.rpc.call('session.active_list', {});
      const sessions = Array.isArray(result.sessions) ? result.sessions : [];
      const match = sessions.find(
        (entry) =>
          typeof entry === 'object' &&
          entry !== null &&
          ((entry as Record<string, unknown>).session_key === sessionId ||
            (entry as Record<string, unknown>).id === sessionId),
      ) as Record<string, unknown> | undefined;
      // 0.19.0 reports `working` while a turn runs and `idle` otherwise
      // (verified live); `running` is kept as a defensive alias.
      const running =
        match?.status === 'working' ||
        match?.status === 'running' ||
        match?.running === true;
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
      connection?.close();
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
      timeoutMs: AUDIO_REQUEST_TIMEOUT_MS,
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
      timeoutMs: AUDIO_REQUEST_TIMEOUT_MS,
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
    sessionId = this.resolveSessionId(sessionId);
    if (isPendingSessionId(sessionId)) {
      // No gateway session exists yet, so there is nothing to interrupt; the
      // caller's local abort ends the streaming request.
      return { apiVersion: 'v1', status: 'cancellation_requested', turnId };
    }
    // `session.interrupt` accepts only live transport sids — the stored id
    // earns a 4001 "session not found" (verified live on 0.19.0). Interrupt
    // through the sid this client learned when it started or resumed the
    // turn; without one the stored id still goes out and the resulting
    // not_found tells the caller to fall back to its local abort.
    const liveSessionId = this.liveSessions.get(sessionId) ?? sessionId;
    const connection = await this.openSocket(signal);
    try {
      await connection.rpc.call('session.interrupt', {
        session_id: liveSessionId,
      });
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
      // only valid on the transport, where interrupt needs it.
      const storedId = typeof stored === 'string' && stored ? stored : live;
      this.resolvedSessions.set(sessionId, storedId);
      this.liveSessions.set(storedId, live);
      return live;
    }
    const resumed = await rpc.call('session.resume', {
      session_id: sessionId,
    });
    const live = resumed.session_id;
    if (typeof live === 'string' && live) {
      this.liveSessions.set(sessionId, live);
      return live;
    }
    return sessionId;
  }

  private async *pump(
    events: TurnEventQueue,
    translator: GatewayTurnTranslator,
    signal?: AbortSignal,
  ): AsyncGenerator<WaveTurnEvent> {
    while (true) {
      const frame = await events.next(signal);
      // The abort check comes after the wait: an abort that arrives mid-wait
      // must read as the user's cancellation, never as a dropped stream.
      if (signal?.aborted) {
        throw new WaveBackendError('Wave cancelled this turn.', {
          kind: 'cancelled',
        });
      }
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
    const timer = setTimeout(
      () => controller.abort(),
      options.timeoutMs ?? this.requestTimeoutMs,
    );
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

/**
 * Async queue bridging socket callbacks to the turn generator. Exported for
 * tests; production use stays inside this module.
 */
export class TurnEventQueue {
  private readonly buffer: (GatewayTurnFrame | typeof TURN_STREAM_FAILED)[] =
    [];
  private closed = false;
  private waiter?: () => void;
  private readonly idleTimeoutMs: number;

  constructor(idleTimeoutMs: number = TURN_IDLE_TIMEOUT_MS) {
    this.idleTimeoutMs = idleTimeoutMs;
  }

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
        let timer: ReturnType<typeof setTimeout> | undefined;
        const done = () => {
          if (timer) clearTimeout(timer);
          signal?.removeEventListener('abort', done);
          if (this.waiter === done) this.waiter = undefined;
          resolve();
        };
        timer = setTimeout(done, this.idleTimeoutMs);
        this.waiter = done;
        signal?.addEventListener('abort', done, { once: true });
      });
      // An abort is a caller decision, not a stream failure.
      if (signal?.aborted) return undefined;
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

/** Gateway app-level error codes for a session id it does not know. */
const RPC_NOT_FOUND_CODES = new Set([4001, 4007]);
/** Attachment rejections: empty/invalid/unsupported/oversized input. */
const RPC_BAD_REQUEST_CODES = new Set([4015, 4016, 4017, 4018]);

function toWaveError(error: unknown): WaveBackendError {
  if (error instanceof WaveBackendError) return error;
  if (error instanceof GatewayRpcError) {
    if (RPC_NOT_FOUND_CODES.has(error.code)) {
      return new WaveBackendError(error.message, { kind: 'not_found' });
    }
    if (RPC_BAD_REQUEST_CODES.has(error.code)) {
      // The caller's input is the problem; retrying the same input cannot
      // succeed, and the gateway's message names the actual limit.
      return new WaveBackendError(error.message, { kind: 'bad_request' });
    }
    return new WaveBackendError(error.message, {
      kind: 'upstream_unavailable',
      retryable: true,
    });
  }
  return new WaveBackendError('Hermes could not complete the request.', {
    kind: 'upstream_unavailable',
    retryable: true,
  });
}

export type { GatewayTokens };
export { isCompleteTokenSet };
