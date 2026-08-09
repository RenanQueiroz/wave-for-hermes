/**
 * The fake Hermes gateway: HTTP + WebSocket on one listener, protocol pinned
 * to the Hermes Agent `v2026.8.3` baseline as consumed by Wave's
 * `src/services/gateway` (cookie auth with rotation on every response,
 * single-use WS tickets, JSON-RPC turns on `/api/ws`, clause-streamed speech
 * on `/api/audio/speak-stream`).
 *
 * It plays scripts, journals what it observed, and never performs inference,
 * networking, or audio capture. Test double only.
 */
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { Duplex } from 'node:stream';

import { WebSocket, WebSocketServer } from 'ws';

import { sinePcm, wavDataUrl } from './audio.js';
import type { Journal } from './journal.js';
import type { OpenAiRealtimeFake } from './openai-realtime-fake.js';
import type { HarnessSession, HarnessState } from './state.js';
import { ActiveTurn, type FrameSink } from './turn-engine.js';

const MAX_BODY_BYTES = 32 * 1024 * 1024;
const ACCESS_COOKIE = 'hermes_session_at';
const REFRESH_COOKIE = 'hermes_session_rt';
const PROVIDER_COOKIE = 'hermes_session_provider';
const SPEECH_BINARY_CHUNK_BYTES = 64 * 1024;
const DEFAULT_SPEECH_SAMPLE_RATE = 24_000;
const DEFAULT_SPEECH_MS_PER_CHAR = 15;
const DEFAULT_SPEECH_MAX_MS_PER_TEXT = 1_200;

interface GatewayServerOptions {
  host: string;
  journal: Journal;
  port: number;
  realtimeFake: OpenAiRealtimeFake;
  state: HarnessState;
}

export interface RunningGatewayServer {
  activeTurnCount(): number;
  close(): Promise<void>;
  port: number;
  url: string;
}

export async function startGatewayServer(
  options: GatewayServerOptions,
): Promise<RunningGatewayServer> {
  const { host, journal, realtimeFake, state } = options;
  const activeTurns = new Map<string, ActiveTurn>();
  /** Texts accepted by a `queued` redirect, drained as follow-on turns. */
  const queuedTexts = new Map<string, string[]>();

  function startTurn(
    session: HarnessSession,
    sink: FrameSink,
    text: string,
  ): void {
    const turn = new ActiveTurn({
      journal,
      script: state.nextTurnScript() ?? {},
      session,
      sink,
      state,
      text,
    });
    activeTurns.set(session.storedId, turn);
    void turn.done.finally(() => {
      if (activeTurns.get(session.storedId) === turn) {
        activeTurns.delete(session.storedId);
      }
      const queued = queuedTexts.get(session.storedId)?.shift();
      if (
        queued !== undefined &&
        sink.isOpen() &&
        state.resolveSession(session.storedId) === session
      ) {
        journal.record('turn.drain', { text: queued });
        startTurn(session, sink, queued);
      }
    });
  }

  const server = createServer((request, response) => {
    void handleHttp(request, response).catch(() => {
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
  });

  const rpcSocketServer = new WebSocketServer({ noServer: true });
  const speechSocketServer = new WebSocketServer({ noServer: true });
  const realtimeSocketServer = new WebSocketServer({ noServer: true });

  server.on(
    'upgrade',
    (request: IncomingMessage, socket: Duplex, head: Buffer) => {
      const url = requestUrl(request);
      // The OpenAI-shaped sideband authenticates by issued call id, not by
      // the gateway's ticket scheme.
      if (realtimeFake.isSidebandPath(url.pathname)) {
        const callId = url.searchParams.get('call_id') ?? '';
        if (!realtimeFake.hasIssuedCall(callId)) {
          journal.record('ws.rejected', { path: url.pathname });
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }
        realtimeSocketServer.handleUpgrade(request, socket, head, (ws) => {
          journal.record('ws.open', { path: url.pathname });
          realtimeFake.handleSidebandSocket(ws, callId);
        });
        return;
      }
      const ticket = url.searchParams.get('ticket') ?? '';
      if (!state.consumeTicket(ticket)) {
        journal.record('ws.rejected', { path: url.pathname });
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      if (url.pathname === '/api/ws') {
        rpcSocketServer.handleUpgrade(request, socket, head, (ws) => {
          journal.record('ws.open', { path: url.pathname });
          handleRpcSocket(ws);
        });
        return;
      }
      if (url.pathname === '/api/audio/speak-stream') {
        speechSocketServer.handleUpgrade(request, socket, head, (ws) => {
          journal.record('ws.open', { path: url.pathname });
          handleSpeechSocket(ws);
        });
        return;
      }
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
    },
  );

  function requestUrl(request: IncomingMessage): URL {
    return new URL(request.url ?? '/', `http://${host}`);
  }

  // ---- HTTP ---------------------------------------------------------------

  async function handleHttp(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    const url = requestUrl(request);
    const method = request.method ?? 'GET';
    const path = url.pathname;

    // `rotate` mints a fresh cookie pair: `true` on every authenticated
    // response (Wave must harvest rotations), or the provider name at
    // sign-in, which issues the initial pair.
    const reply = (
      status: number,
      body: unknown,
      rotate: boolean | string,
    ): void => {
      const headers: Record<string, number | string | string[]> = {
        'content-type': 'application/json',
      };
      if (rotate !== false) {
        const tokens = state.issueTokens(
          typeof rotate === 'string' ? rotate : readProviderCookie(request),
        );
        headers['set-cookie'] = [
          `${ACCESS_COOKIE}=${tokens.accessToken}; Path=/; HttpOnly`,
          `${REFRESH_COOKIE}=${tokens.refreshToken}; Path=/; HttpOnly`,
          `${PROVIDER_COOKIE}=${tokens.provider}; Path=/; HttpOnly`,
        ];
      }
      response.writeHead(status, headers);
      response.end(JSON.stringify(body));
      journal.record('http.request', { method, path, status });
    };

    // OpenAI-shaped Realtime surface (dummy-bearer auth, no cookies).
    if (path.startsWith('/v1/realtime')) {
      const realtimeResponse = await realtimeFake.handleHttp({
        authorization: request.headers.authorization,
        body: await readRawBody(request),
        contentType: request.headers['content-type'],
        method,
        path,
      });
      if (realtimeResponse) {
        response.writeHead(realtimeResponse.status, {
          'content-type': 'application/json',
          ...realtimeResponse.headers,
        });
        response.end(realtimeResponse.body);
        journal.record('http.request', {
          method,
          path,
          status: realtimeResponse.status,
        });
        return;
      }
    }

    // Public surface.
    if (method === 'GET' && path === '/api/auth/providers') {
      reply(
        200,
        {
          providers: [
            {
              display_name: 'Harness password',
              name: 'password',
              supports_password: true,
            },
          ],
        },
        false,
      );
      return;
    }
    if (method === 'GET' && path === '/api/status') {
      reply(200, { release_date: 'harness', version: '0.20.0' }, false);
      return;
    }
    if (method === 'POST' && path === '/auth/password-login') {
      const body = await readJsonBody(request);
      const username = typeof body?.username === 'string' ? body.username : '';
      const password = typeof body?.password === 'string' ? body.password : '';
      const provider =
        typeof body?.provider === 'string' && body.provider
          ? body.provider
          : 'password';
      journal.record('auth.signin', { provider, username });
      if (!username || !password) {
        reply(401, { error: 'invalid credentials' }, false);
        return;
      }
      reply(200, { ok: true }, provider);
      return;
    }

    // Everything else needs a known access token, and every authenticated
    // response rotates the pair — the client must harvest to stay signed in.
    if (!isAuthenticated(request)) {
      response.writeHead(401, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'unauthorized' }));
      journal.record('http.request', { method, path, status: 401 });
      return;
    }

    if (method === 'GET' && path === '/api/auth/me') {
      reply(200, { user_id: 'harness-user' }, true);
      return;
    }
    if (method === 'POST' && path === '/api/auth/ws-ticket') {
      reply(200, { ticket: state.mintTicket() }, true);
      return;
    }
    if (method === 'GET' && path === '/api/config') {
      const capabilities = state.audioCapabilities();
      reply(
        200,
        {
          ...(capabilities.stt
            ? { stt: { enabled: true, provider: 'harness' } }
            : {}),
          ...(capabilities.tts
            ? { tts: { enabled: true, provider: 'harness' } }
            : {}),
        },
        true,
      );
      return;
    }
    if (method === 'POST' && path === '/api/audio/transcribe') {
      const body = await readJsonBody(request);
      const dataUrl = typeof body?.data_url === 'string' ? body.data_url : '';
      const script = state.transcribeScript();
      journal.record('audio.transcribe', {
        bytes: dataUrl.length,
        mimeType: typeof body?.mime_type === 'string' ? body.mime_type : '',
      });
      if (script?.delayMs) await sleep(script.delayMs);
      if (script?.failWith) {
        reply(
          script.failWith,
          { error: 'scripted transcription failure' },
          true,
        );
        return;
      }
      reply(
        200,
        { provider: 'harness', transcript: state.nextTranscript() },
        true,
      );
      return;
    }
    if (method === 'POST' && path === '/api/audio/speak') {
      const body = await readJsonBody(request);
      const text = typeof body?.text === 'string' ? body.text : '';
      journal.record('audio.speak', { chars: text.length });
      reply(
        200,
        {
          data_url: wavDataUrl(600, DEFAULT_SPEECH_SAMPLE_RATE),
          mime_type: 'audio/wav',
          provider: 'harness',
        },
        true,
      );
      return;
    }
    if (method === 'GET' && path === '/api/sessions') {
      const sessions = state
        .listSessions()
        .map((session) => sessionRow(session));
      reply(200, { has_more: false, sessions, total: sessions.length }, true);
      return;
    }
    if (method === 'GET' && path === '/api/sessions/search') {
      const query = (url.searchParams.get('q') ?? '').toLowerCase();
      const results = state.listSessions().flatMap((session) => {
        const match = session.messages.find((row) =>
          row.content.toLowerCase().includes(query),
        );
        return query && match
          ? [
              {
                session_id: session.storedId,
                snippet: match.content.slice(0, 200),
              },
            ]
          : [];
      });
      reply(200, { results }, true);
      return;
    }

    const sessionMatch = /^\/api\/sessions\/([^/]+)(\/messages)?$/.exec(path);
    if (sessionMatch) {
      const session = state.resolveSession(
        decodeURIComponent(sessionMatch[1] ?? ''),
      );
      if (!session) {
        reply(404, { error: 'session not found' }, true);
        return;
      }
      if (sessionMatch[2] === '/messages' && method === 'GET') {
        const limit = boundedQueryInt(url, 'limit', 100, 1, 1_000);
        const offset = boundedQueryInt(url, 'offset', 0, 0, 1_000_000);
        reply(
          200,
          {
            messages: session.messages
              .slice(offset, offset + limit)
              .map((row) => ({
                content: row.content,
                id: row.id,
                role: row.role,
                timestamp: row.timestamp,
              })),
          },
          true,
        );
        return;
      }
      if (!sessionMatch[2] && method === 'GET') {
        reply(200, sessionRow(session), true);
        return;
      }
      if (!sessionMatch[2] && method === 'PATCH') {
        const body = await readJsonBody(request);
        if (typeof body?.title === 'string') session.title = body.title;
        if (typeof body?.pinned === 'boolean') session.pinned = body.pinned;
        journal.record('session.patch', { sessionId: session.storedId });
        reply(200, { ok: true }, true);
        return;
      }
      if (!sessionMatch[2] && method === 'DELETE') {
        state.deleteSession(session.storedId);
        journal.record('session.delete', { sessionId: session.storedId });
        reply(200, { deleted: true }, true);
        return;
      }
    }

    reply(404, { error: 'unknown route' }, false);
  }

  function sessionRow(session: HarnessSession): Record<string, unknown> {
    const lastUser = [...session.messages]
      .reverse()
      .find((row) => row.role === 'user');
    const last = session.messages.at(-1);
    return {
      id: session.storedId,
      message_count: session.messages.length,
      pinned: session.pinned,
      source: 'gateway',
      status: activeTurns.has(session.storedId) ? 'working' : 'idle',
      title: session.title,
      ...(lastUser ? { preview: lastUser.content } : {}),
      ...(last ? { last_active: last.timestamp } : {}),
    };
  }

  function isAuthenticated(request: IncomingMessage): boolean {
    const token = readCookie(request, ACCESS_COOKIE);
    return token !== undefined && state.isKnownAccessToken(token);
  }

  function readProviderCookie(request: IncomingMessage): string {
    return readCookie(request, PROVIDER_COOKIE) ?? 'password';
  }

  // ---- /api/ws JSON-RPC ---------------------------------------------------

  function handleRpcSocket(ws: WebSocket): void {
    const sink: FrameSink = {
      isOpen: () => ws.readyState === WebSocket.OPEN,
      sendEvent: (type, sessionId, payload) => {
        ws.send(
          JSON.stringify({
            jsonrpc: '2.0',
            method: 'event',
            params: { payload, session_id: sessionId, type },
          }),
        );
      },
    };

    ws.on('message', (data) => {
      let frame: Record<string, unknown>;
      try {
        const parsed: unknown = JSON.parse(String(data));
        if (typeof parsed !== 'object' || parsed === null) return;
        frame = parsed as Record<string, unknown>;
      } catch {
        return;
      }
      const id = frame.id;
      const method = typeof frame.method === 'string' ? frame.method : '';
      const params =
        typeof frame.params === 'object' && frame.params !== null
          ? (frame.params as Record<string, unknown>)
          : {};
      if (typeof id !== 'number' || !method) return;
      journal.record('rpc.call', {
        method,
        params: JSON.stringify(params),
      });
      const respond = (result: Record<string, unknown>) => {
        ws.send(JSON.stringify({ id, jsonrpc: '2.0', result }));
      };
      const respondError = (code: number, message: string) => {
        ws.send(
          JSON.stringify({ error: { code, message }, id, jsonrpc: '2.0' }),
        );
      };
      handleRpcCall(method, params, sink, respond, respondError);
    });
  }

  function handleRpcCall(
    method: string,
    params: Record<string, unknown>,
    sink: FrameSink,
    respond: (result: Record<string, unknown>) => void,
    respondError: (code: number, message: string) => void,
  ): void {
    const sessionParam =
      typeof params.session_id === 'string' ? params.session_id : '';

    if (method === 'session.create') {
      const session = state.createSession();
      respond({
        session_id: session.liveId,
        stored_session_id: session.storedId,
      });
      return;
    }

    if (method === 'session.resume') {
      const session = state.resolveSession(sessionParam);
      if (!session) {
        respondError(4001, 'session not found');
        return;
      }
      respond({ resumed: true, session_id: session.liveId });
      return;
    }

    if (method === 'session.active_list') {
      respond({
        sessions: state.listSessions().map((session) => ({
          id: session.liveId,
          session_key: session.storedId,
          status: activeTurns.has(session.storedId) ? 'working' : 'idle',
        })),
      });
      return;
    }

    if (method === 'prompt.submit') {
      const session = state.resolveSession(sessionParam);
      if (!session) {
        respondError(4001, 'session not found');
        return;
      }
      const text = typeof params.text === 'string' ? params.text : '';
      state.appendMessage(session, 'user', text);
      respond({ status: 'streaming' });
      const previous =
        activeTurns.get(session.storedId)?.done ?? Promise.resolve();
      void previous.then(() => startTurn(session, sink, text));
      return;
    }

    if (method === 'session.redirect') {
      const session = state.resolveSession(sessionParam);
      const text = typeof params.text === 'string' ? params.text.trim() : '';
      if (!text) {
        respondError(4002, 'text is required');
        return;
      }
      if (!session) {
        respondError(4001, 'session not found');
        return;
      }
      const script = state.nextRedirectScript();
      journal.record('session.redirect', {
        scripted: script.status ?? 'redirected',
        sessionId: session.storedId,
        text,
      });
      if (script.errorCode !== undefined) {
        respondError(script.errorCode, script.errorMessage ?? 'scripted error');
        return;
      }
      const status = script.status ?? 'redirected';
      if (status === 'redirected' || status === 'queued') {
        state.appendMessage(session, 'user', text);
      }
      if (status === 'queued') {
        // Like the real gateway's queued_prompt: the text drains as the
        // session's next turn on the same transport once the current turn
        // finishes.
        const pending = queuedTexts.get(session.storedId) ?? [];
        pending.push(text);
        queuedTexts.set(session.storedId, pending);
      }
      respond({ status, text });
      return;
    }

    if (method === 'session.interrupt') {
      const session = state.resolveSession(sessionParam);
      if (!session) {
        respondError(4001, 'session not found');
        return;
      }
      activeTurns.get(session.storedId)?.interrupt();
      respond({ ok: true });
      return;
    }

    if (method === 'image.attach_bytes') {
      const content =
        typeof params.content_base64 === 'string' ? params.content_base64 : '';
      journal.record('image.attach', {
        bytes: content.length,
        filename: typeof params.filename === 'string' ? params.filename : '',
      });
      respond({ ok: true });
      return;
    }

    if (
      method === 'approval.respond' ||
      method === 'clarify.respond' ||
      method === 'secret.respond' ||
      method === 'sudo.respond'
    ) {
      respond({ ok: true });
      return;
    }

    respondError(4000, `harness does not implement ${method}`);
  }

  // ---- /api/audio/speak-stream --------------------------------------------

  function handleSpeechSocket(ws: WebSocket): void {
    const script = state.speechScript();
    const mode = script.mode ?? 'stream';
    const sampleRate = script.sampleRate ?? DEFAULT_SPEECH_SAMPLE_RATE;
    const msPerChar = script.msPerChar ?? DEFAULT_SPEECH_MS_PER_CHAR;
    const maxMsPerText = script.maxMsPerText ?? DEFAULT_SPEECH_MAX_MS_PER_TEXT;

    if (mode === 'fallback') {
      ws.send(JSON.stringify({ type: 'fallback' }));
      journal.record('speech.fallback', {});
      return;
    }

    ws.send(
      JSON.stringify({ channels: 1, sample_rate: sampleRate, type: 'start' }),
    );
    journal.record('speech.start', { sampleRate });

    ws.on('message', (data) => {
      let frame: Record<string, unknown>;
      try {
        const parsed: unknown = JSON.parse(String(data));
        if (typeof parsed !== 'object' || parsed === null) return;
        frame = parsed as Record<string, unknown>;
      } catch {
        return;
      }
      if (typeof frame.text === 'string' && frame.text) {
        journal.record('speech.text', {
          chars: frame.text.length,
          text: frame.text,
        });
        const durationMs = Math.min(
          Math.max(frame.text.length * msPerChar, 40),
          maxMsPerText,
        );
        const pcm = sinePcm(durationMs, sampleRate);
        for (
          let offset = 0;
          offset < pcm.byteLength;
          offset += SPEECH_BINARY_CHUNK_BYTES
        ) {
          ws.send(pcm.subarray(offset, offset + SPEECH_BINARY_CHUNK_BYTES));
        }
        return;
      }
      if (frame.done === true) {
        journal.record('speech.done', {});
        ws.send(JSON.stringify({ type: 'end' }));
        ws.close(1000, 'harness speech finished');
        return;
      }
      if (frame.stop === true) {
        journal.record('speech.stop', {});
        ws.close(1000, 'harness speech stopped');
      }
    });
  }

  // ---- lifecycle ----------------------------------------------------------

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, host, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  const address = server.address();
  const port =
    typeof address === 'object' && address !== null
      ? address.port
      : options.port;

  return {
    activeTurnCount: () => activeTurns.size,
    close: async () => {
      for (const turn of activeTurns.values()) turn.interrupt();
      for (const client of rpcSocketServer.clients) client.terminate();
      for (const client of speechSocketServer.clients) client.terminate();
      for (const client of realtimeSocketServer.clients) client.terminate();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
    port,
    url: `http://${host}:${port}`,
  };
}

async function readRawBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = chunk as Buffer;
    total += buffer.byteLength;
    if (total > MAX_BODY_BYTES) return Buffer.alloc(0);
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

async function readJsonBody(
  request: IncomingMessage,
): Promise<Record<string, unknown> | undefined> {
  const raw = await readRawBody(request);
  try {
    const parsed: unknown = JSON.parse(raw.toString('utf8'));
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function readCookie(
  request: IncomingMessage,
  name: string,
): string | undefined {
  const header = request.headers.cookie;
  if (!header) return undefined;
  for (const pair of header.split(';')) {
    const separator = pair.indexOf('=');
    if (separator <= 0) continue;
    if (pair.slice(0, separator).trim() === name) {
      return pair.slice(separator + 1).trim();
    }
  }
  return undefined;
}

function boundedQueryInt(
  url: URL,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number.parseInt(url.searchParams.get(name) ?? '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
