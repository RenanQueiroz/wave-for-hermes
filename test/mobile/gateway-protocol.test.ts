import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeMessageRow,
  normalizeSessionRows,
  normalizeTimelineEntries,
  toIsoTimestamp,
  toToolDetail,
} from '../../src/services/gateway/gateway-normalize.ts';
import {
  GatewayRpc,
  GatewayRpcError,
} from '../../src/services/gateway/gateway-rpc.ts';
import {
  GatewayClient,
  isGatewaySessionActive,
  isPendingSessionId,
  normalizeGatewayCompatibilityStatus,
  TurnEventQueue,
} from '../../src/services/gateway/gateway-client.ts';
import { GatewayTurnTranslator } from '../../src/services/gateway/gateway-turn-events.ts';
import { WaveBackendError } from '../../src/services/wave/wave-backend-error.ts';
import {
  isCompleteTokenSet,
  mergeRotatedTokens,
  parseGatewaySetCookies,
  toCookieHeader,
} from '../../src/services/gateway/gateway-tokens.ts';
import {
  GATEWAY_V019_FIXTURE,
  GATEWAY_V020_FIXTURE,
} from '../fixtures/gateway-compatibility.ts';

test('normalizes a bounded gateway version for diagnostics only', () => {
  assert.deepEqual(
    normalizeGatewayCompatibilityStatus(GATEWAY_V019_FIXTURE.status),
    { version: '0.19.0' },
  );
  assert.deepEqual(
    normalizeGatewayCompatibilityStatus(GATEWAY_V020_FIXTURE.status),
    { version: '0.20.0' },
  );
  assert.deepEqual(normalizeGatewayCompatibilityStatus(null), {});
  assert.deepEqual(normalizeGatewayCompatibilityStatus({ version: 20 }), {});
  assert.deepEqual(
    normalizeGatewayCompatibilityStatus({ version: `0.${'2'.repeat(100)}` }),
    {},
  );
  assert.deepEqual(
    normalizeGatewayCompatibilityStatus({ version: '0.20.0\nsecret' }),
    {},
  );
});

test('treats every measured non-idle live-session phase as active', () => {
  for (const entry of GATEWAY_V019_FIXTURE.activeList.sessions) {
    assert.equal(
      isGatewaySessionActive(entry),
      entry.status !== 'idle',
      `unexpected v0.19 status handling for ${entry.status}`,
    );
  }
  for (const entry of GATEWAY_V020_FIXTURE.activeList.sessions) {
    assert.equal(
      isGatewaySessionActive(entry),
      entry.status !== 'idle',
      `unexpected v0.20 status handling for ${entry.status}`,
    );
  }
  assert.equal(isGatewaySessionActive({ running: true }), true);
  assert.equal(isGatewaySessionActive({ status: 'future-state' }), false);
  assert.equal(isGatewaySessionActive(undefined), false);
});

test('normalizes gateway session rows and drops unusable ones', () => {
  const sessions = normalizeSessionRows({
    sessions: [
      {
        id: '20260801_235222_3fd078',
        title: '  Long fixture conversation  ',
        message_count: 130,
        tool_call_count: 3,
        started_at: 1785642618.063404,
        ended_at: 1785642700,
      },
      { id: '', title: 'no id' },
      { title: 'missing id entirely' },
      { id: '20260801_235222_3fd078', title: 'duplicate id' },
    ],
  });
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].id, '20260801_235222_3fd078');
  assert.equal(sessions[0].title, 'Long fixture conversation');
  assert.equal(sessions[0].messageCount, 130);
  assert.equal(sessions[0].toolCallCount, 3);
  assert.match(sessions[0].startedAt ?? '', /^2026-/);
  assert.match(sessions[0].lastActiveAt ?? '', /^2026-/);

  assert.deepEqual(normalizeSessionRows({}), []);
  assert.deepEqual(normalizeSessionRows(null), []);
});

test('converts epoch seconds and rejects unusable timestamps', () => {
  assert.match(toIsoTimestamp(1785642618.06) ?? '', /^2026-.*Z$/);
  assert.match(toIsoTimestamp(1785642618000) ?? '', /^2026-.*Z$/);
  assert.equal(toIsoTimestamp(0), undefined);
  assert.equal(toIsoTimestamp(-5), undefined);
  assert.equal(toIsoTimestamp('nope'), undefined);
  assert.equal(toIsoTimestamp(Number.NaN), undefined);
});

test('bounds tool details and marks truncation explicitly', () => {
  assert.equal(toToolDetail(undefined), undefined);
  assert.equal(toToolDetail(''), undefined);
  assert.deepEqual(toToolDetail('ls -la'), {
    text: 'ls -la',
    truncated: false,
  });
  assert.deepEqual(toToolDetail({ path: '/tmp' }), {
    text: '{"path":"/tmp"}',
    truncated: false,
  });
  const long = toToolDetail('x'.repeat(5_000));
  assert.equal(long?.truncated, true);
  assert.equal(long?.text.length, 4_000);
});

test('normalizes message rows into timeline entries with stable ids', () => {
  const entries = normalizeTimelineEntries({
    messages: [
      { id: 1, role: 'user', content: 'hello', timestamp: 1785642743.6 },
      { id: 2, role: 'assistant', content: 'hi there' },
      { id: 3, role: 'tool', content: '{"ok":true}', tool_name: 'search' },
      { id: 4, role: 'assistant', content: '' },
      { id: 5, role: 'weird-role', content: 'still shown' },
    ],
  });
  assert.equal(entries.length, 4);
  assert.equal(entries[0].id, 'msg-1');
  assert.equal(entries[0].turnId, 'msg-1');
  assert.equal(entries[0].source, 'hermes');
  assert.equal(entries[0].type, 'message');
  assert.equal(entries[0].message.role, 'user');
  assert.match(entries[0].message.createdAt ?? '', /^2026-/);
  assert.equal(entries[2].message.toolName, 'search');
  assert.deepEqual(entries[2].message.toolOutput, {
    text: '{"ok":true}',
    truncated: false,
  });
  // Unknown roles degrade rather than disappear.
  assert.equal(entries[3].message.role, 'unknown');

  assert.deepEqual(normalizeTimelineEntries({ messages: 'nope' }), []);
  // A row with no content and no tool identity carries nothing to render.
  assert.equal(
    normalizeMessageRow({ role: 'assistant', content: '' }),
    undefined,
  );
});

test('folds gateway image annotations out of user messages', () => {
  // Content captured live on 0.19.0: one annotation pair per attached image,
  // each followed by a blank line, then the typed text.
  const annotated =
    '[The user attached an image:\nA solid blue rectangle.]\n' +
    '[You can examine it with vision_analyze using image_url: /srv/hermes/images/upload_1.png]\n\n' +
    '[The user attached an image:\nA solid red square.]\n' +
    '[You can examine it with vision_analyze using image_url: /srv/hermes/images/upload_2.png]\n\n' +
    'what do these have in common?';
  const folded = normalizeMessageRow({ content: annotated, role: 'user' });
  assert.equal(
    folded?.content,
    'what do these have in common?\n' +
      '[Attached image: A solid blue rectangle.]\n' +
      '[Attached image: A solid red square.]',
  );
  // The server filesystem path must never reach the rendered content.
  assert.ok(!folded?.content.includes('/srv/hermes'));

  // An empty description degrades to a bare marker.
  const bare = normalizeMessageRow({
    content:
      '[The user attached an image:\n]\n' +
      '[You can examine it with vision_analyze using image_url: /srv/x.png]\n\nhello',
    role: 'user',
  });
  assert.equal(bare?.content, 'hello\n[Attached image]');

  // Only exact leading annotations fold; lookalikes render unchanged.
  const midMessage = 'see below\n[The user attached an image:\nnope]';
  assert.equal(
    normalizeMessageRow({ content: midMessage, role: 'user' })?.content,
    midMessage,
  );
  const missingVisionLine =
    '[The user attached an image:\nno second line]\n\nhello';
  assert.equal(
    normalizeMessageRow({ content: missingVisionLine, role: 'user' })?.content,
    missingVisionLine,
  );
  // Non-user rows are never rewritten, even with matching content.
  const assistantEcho = normalizeMessageRow({
    content: annotated,
    role: 'assistant',
  });
  assert.equal(assistantEcho?.content, annotated);

  // Session previews carry the same annotations and fold the same way.
  const [session] = normalizeSessionRows({
    sessions: [{ id: 's1', preview: annotated }],
  });
  assert.equal(
    session?.preview,
    'what do these have in common?\n' +
      '[Attached image: A solid blue rectangle.]\n' +
      '[Attached image: A solid red square.]',
  );
});

test('parses, merges, and serializes gateway session cookies', () => {
  const parsed = parseGatewaySetCookies([
    'hermes_session_at="access-1"; HttpOnly; Max-Age=43200; Path=/; SameSite=lax',
    '__Secure-hermes_session_rt=refresh-1; HttpOnly; Secure; Path=/',
    'hermes_session_provider=basic; Path=/',
    'unrelated=value; Path=/',
  ]);
  assert.deepEqual(parsed, {
    accessToken: 'access-1',
    provider: 'basic',
    refreshToken: 'refresh-1',
  });
  assert.equal(isCompleteTokenSet(parsed), true);
  assert.equal(isCompleteTokenSet({ accessToken: 'a' }), false);

  const current = {
    accessToken: 'access-1',
    provider: 'basic',
    refreshToken: 'refresh-1',
  };
  // No rotation → same object, so callers can skip a storage write.
  assert.equal(mergeRotatedTokens(current, {}), current);
  const rotated = mergeRotatedTokens(current, { accessToken: 'access-2' });
  assert.notEqual(rotated, current);
  assert.equal(rotated.accessToken, 'access-2');
  assert.equal(rotated.refreshToken, 'refresh-1');

  assert.equal(
    toCookieHeader(current),
    'hermes_session_at=access-1; hermes_session_rt=refresh-1; hermes_session_provider=basic',
  );
});

test('correlates JSON-RPC responses and routes event frames', async () => {
  const sent: string[] = [];
  const events: { payload: Record<string, unknown>; type: string }[] = [];
  const rpc = new GatewayRpc({
    onEvent: (event) => events.push(event),
    socket: { close: () => undefined, send: (data) => sent.push(data) },
  });

  const call = rpc.call('session.list', {});
  const request = JSON.parse(sent[0]);
  assert.equal(request.jsonrpc, '2.0');
  assert.equal(request.method, 'session.list');

  rpc.handleMessage(
    JSON.stringify({
      jsonrpc: '2.0',
      method: 'event',
      params: { type: 'message.delta', payload: { text: 'hi' } },
    }),
  );
  rpc.handleMessage(
    JSON.stringify({
      jsonrpc: '2.0',
      method: 'event',
      params: GATEWAY_V020_FIXTURE.gatewayReady,
    }),
  );
  rpc.handleMessage('not json at all');
  rpc.handleMessage(JSON.stringify({ jsonrpc: '2.0', id: 999, result: {} }));
  rpc.handleMessage(
    JSON.stringify({
      jsonrpc: '2.0',
      id: request.id,
      result: { sessions: [] },
    }),
  );

  assert.deepEqual(await call, { sessions: [] });
  assert.equal(events.length, 2);
  assert.equal(events[0].type, 'message.delta');
  assert.deepEqual(events[1], GATEWAY_V020_FIXTURE.gatewayReady);

  const failing = rpc.call('session.resume', {});
  const secondId = JSON.parse(sent[1]).id;
  rpc.handleMessage(
    JSON.stringify({
      jsonrpc: '2.0',
      id: secondId,
      error: { code: 4007, message: 'session not found' },
    }),
  );
  await assert.rejects(failing, (error: unknown) => {
    assert.ok(error instanceof GatewayRpcError);
    assert.equal(error.code, 4007);
    return true;
  });

  const orphan = rpc.call('prompt.submit', {});
  rpc.fail(new Error('socket closed'));
  await assert.rejects(orphan, /socket closed/);
});

test('translates gateway turn frames into Wave turn events', () => {
  const translator = new GatewayTurnTranslator({
    messageId: 'assistant-1',
    now: () => new Date('2026-08-02T00:00:00.000Z'),
    sessionId: 'session-1',
    turnId: 'turn-1',
  });

  const started = translator.start();
  assert.equal(started.type, 'turn.started');
  assert.equal(started.sequence, 0);
  assert.equal(started.turnId, 'turn-1');

  // Unknown/noise frames never reach the transcript.
  assert.deepEqual(
    translator.translate({ type: 'session.info', payload: {} }),
    [],
  );
  assert.deepEqual(
    translator.translate({ type: 'thinking.delta', payload: { text: '…' } }),
    [],
  );
  for (const frame of GATEWAY_V020_FIXTURE.turnFrames) {
    assert.deepEqual(
      translator.translate(frame),
      [],
      `${frame.type} must degrade safely until it has a Wave projection`,
    );
  }

  // The first delta implies assistant.started.
  const first = translator.translate({
    payload: { text: 'Mock chunk 1. ' },
    type: 'message.delta',
  });
  assert.deepEqual(
    first.map((event) => event.type),
    ['assistant.started', 'assistant.delta'],
  );
  const second = translator.translate({
    payload: { text: 'Mock chunk 2. ' },
    type: 'message.delta',
  });
  assert.equal(second.length, 1);
  assert.equal(second[0].type, 'assistant.delta');

  const tool = translator.translate({
    payload: { name: 'search' },
    type: 'tool.start',
  });
  assert.equal(tool[0].type, 'tool.status');
  assert.equal(tool[0].status, 'started');
  assert.equal(tool[0].toolName, 'search');

  const ended = translator.translate({ payload: {}, type: 'message.end' });
  assert.deepEqual(
    ended.map((event) => event.type),
    ['assistant.completed', 'turn.completed'],
  );
  const completed = ended[0];
  assert.equal(completed.content, 'Mock chunk 1. Mock chunk 2. ');
  assert.equal(completed.partial, false);

  // Sequence numbers are monotonic across the whole turn, and a terminated
  // turn stays terminated.
  const sequences = [started, ...first, ...second, ...tool, ...ended].map(
    (event) => event.sequence,
  );
  assert.deepEqual(
    sequences,
    [...sequences].sort((a, b) => a - b),
  );
  assert.deepEqual(
    translator.translate({ payload: {}, type: 'message.delta' }),
    [],
  );
  assert.deepEqual(translator.finish({ interrupted: false }), []);
});

test('marks an interrupted turn partial and reports gateway turn errors', () => {
  const interrupted = new GatewayTurnTranslator({
    messageId: 'assistant-2',
    sessionId: 'session-1',
    turnId: 'turn-2',
  });
  interrupted.start();
  interrupted.translate({
    payload: { text: 'partial' },
    type: 'message.delta',
  });
  const events = interrupted.finish({ interrupted: true });
  const completed = events.find(
    (event) => event.type === 'assistant.completed',
  );
  assert.equal(completed?.partial, true);
  assert.equal(completed?.interrupted, true);
  const turnCompleted = events.find((event) => event.type === 'turn.completed');
  assert.equal(turnCompleted?.completed, false);

  const failing = new GatewayTurnTranslator({
    messageId: 'assistant-3',
    sessionId: 'session-1',
    turnId: 'turn-3',
  });
  failing.start();
  const errorEvents = failing.translate({
    payload: { message: 'model unavailable' },
    type: 'turn.error',
  });
  assert.equal(errorEvents[0].type, 'turn.error');
  assert.equal(errorEvents[0].error.message, 'model unavailable');
  assert.equal(errorEvents[0].error.retryable, true);
});

test('a new conversation keeps its route while its real session is created', async () => {
  // Regression: a placeholder session must not be asked for its timeline (the
  // gateway 404s and the chat screen bounces back to the new-conversation
  // screen), and after the first turn creates the real session every later
  // call must address that session rather than the placeholder.
  const requests: string[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    requests.push(`${init?.method ?? 'GET'} ${new URL(url).pathname}`);
    return new Response(
      JSON.stringify({ message_count: 0, messages: [], ok: true }),
      {
        headers: { 'content-type': 'application/json' },
        status: 200,
      },
    );
  }) as unknown as typeof globalThis.fetch;

  const client = new GatewayClient({
    baseUrl: 'http://localhost:9119',
    fetch: fetchImpl,
    socketFactory: () => {
      throw new Error('no socket needed');
    },
    tokens: { accessToken: 'a', provider: 'basic', refreshToken: 'r' },
  });

  const created = await client.createSession();
  assert.ok(isPendingSessionId(created.session.id));

  const empty = await client.getSessionTimeline(created.session.id);
  assert.deepEqual(empty.entries, []);
  assert.equal(empty.hasMore, false);
  assert.equal(
    requests.length,
    0,
    'a placeholder session must not reach the gateway',
  );

  // Simulate the first turn resolving the placeholder to a stored session.
  (
    client as unknown as { resolvedSessions: Map<string, string> }
  ).resolvedSessions.set(created.session.id, '20260802_000000_abcdef');

  await client.getSessionTimeline(created.session.id);
  await client.updateSession(created.session.id, { title: 'Renamed' });
  await client.deleteSession(created.session.id);
  assert.deepEqual(requests, [
    // First timeline page: the detail row supplies the count, then the rows.
    'GET /api/sessions/20260802_000000_abcdef',
    'GET /api/sessions/20260802_000000_abcdef/messages',
    'PATCH /api/sessions/20260802_000000_abcdef',
    // Delete probes for a running turn first (the gateway would otherwise
    // accept a mid-turn delete and let the session reappear).
    'POST /api/auth/ws-ticket',
    'DELETE /api/sessions/20260802_000000_abcdef',
  ]);
});

test('reads the public compatibility version without exposing raw status', async () => {
  const requests: string[] = [];
  const fetchImpl = (async (url: string | URL) => {
    requests.push(new URL(String(url)).pathname);
    return jsonResponse({
      ...GATEWAY_V020_FIXTURE.status,
      auth_providers: ['fixture-provider'],
      gateway_platforms: { fixture: { configured: true } },
      unrelated_future_field: { nested: true },
    });
  }) as unknown as typeof globalThis.fetch;
  const client = new GatewayClient({
    baseUrl: 'http://localhost:9119',
    fetch: fetchImpl,
    socketFactory: () => {
      throw new Error('no socket needed');
    },
    tokens: { accessToken: 'a', provider: 'basic', refreshToken: 'r' },
  });

  assert.deepEqual(await client.getCompatibilityBaseline(), {
    version: '0.20.0',
  });
  assert.deepEqual(requests, ['/api/status']);
});

test('caps session pages at the v0.19/v0.20 shared limit', async () => {
  let requestedUrl = '';
  const fetchImpl = (async (url: string | URL) => {
    requestedUrl = String(url);
    return jsonResponse({ sessions: [] });
  }) as unknown as typeof globalThis.fetch;
  const client = new GatewayClient({
    baseUrl: 'http://localhost:9119',
    fetch: fetchImpl,
    socketFactory: () => {
      throw new Error('no socket needed');
    },
    tokens: { accessToken: 'a', provider: 'basic', refreshToken: 'r' },
  });

  const page = await client.listSessions({ limit: 200 });
  assert.equal(page.limit, 100);
  assert.equal(new URL(requestedUrl).searchParams.get('limit'), '100');
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status: 200,
  });
}

function timelineFixtureClient(
  rowCount: number,
  reportedCount: number | 'unavailable',
) {
  const rows = Array.from({ length: rowCount }, (_, index) => ({
    content: `message ${index + 1}`,
    id: index + 1,
    role: index % 2 === 0 ? 'user' : 'assistant',
  }));
  const requests: string[] = [];
  const fetchImpl = (async (url: string | URL) => {
    const parsed = new URL(String(url));
    requests.push(`${parsed.pathname}${parsed.search}`);
    if (parsed.pathname === '/api/sessions/s1') {
      if (reportedCount === 'unavailable') {
        return new Response('gateway error', { status: 500 });
      }
      return jsonResponse({ id: 's1', message_count: reportedCount });
    }
    const limit = Number(parsed.searchParams.get('limit') ?? '500');
    const offset = Number(parsed.searchParams.get('offset') ?? '0');
    const page = rows.slice(offset, offset + limit);
    return jsonResponse({
      messages: page,
      pagination: { limit, offset, returned: page.length },
    });
  }) as unknown as typeof globalThis.fetch;
  const client = new GatewayClient({
    baseUrl: 'http://localhost:9119',
    fetch: fetchImpl,
    socketFactory: () => {
      throw new Error('no socket needed');
    },
    tokens: { accessToken: 'a', provider: 'basic', refreshToken: 'r' },
  });
  return { client, requests };
}

test('pages the timeline from the newest end', async () => {
  // Regression: `/messages?limit=N` keeps the OLDEST N rows (verified live on
  // 0.19.0), so a naive capped fetch hides the newest messages of a long
  // conversation. The first page must hold the newest rows and the cursor
  // must walk backwards to the oldest.
  const { client } = timelineFixtureClient(7, 7);

  const first = await client.getSessionTimeline('s1', { limit: 3 });
  assert.deepEqual(
    first.entries.map((entry) => entry.id),
    ['msg-5', 'msg-6', 'msg-7'],
  );
  assert.equal(first.hasMore, true);
  assert.equal(first.nextCursor, '4');

  const second = await client.getSessionTimeline('s1', {
    before: first.nextCursor,
    limit: 3,
  });
  assert.deepEqual(
    second.entries.map((entry) => entry.id),
    ['msg-2', 'msg-3', 'msg-4'],
  );
  assert.equal(second.hasMore, true);
  assert.equal(second.nextCursor, '1');

  const third = await client.getSessionTimeline('s1', {
    before: second.nextCursor,
    limit: 3,
  });
  assert.deepEqual(
    third.entries.map((entry) => entry.id),
    ['msg-1'],
  );
  assert.equal(third.hasMore, false);
  assert.equal(third.nextCursor, undefined);
});

test('recovers when the reported message count overshoots the rows', async () => {
  const { client, requests } = timelineFixtureClient(2, 50);
  const page = await client.getSessionTimeline('s1', { limit: 3 });
  assert.deepEqual(
    page.entries.map((entry) => entry.id),
    ['msg-1', 'msg-2'],
  );
  assert.equal(page.hasMore, false);
  // The overshot offset returned nothing, so the client located the true end
  // with single-row probes before fetching the real window.
  const messageRequests = requests.filter((request) =>
    request.includes('/messages'),
  );
  assert.ok(messageRequests.length >= 3);
  for (const request of messageRequests.slice(1, -1)) {
    assert.match(
      request,
      /limit=1&/,
      `expected a single-row probe: ${request}`,
    );
  }
});

test('the first page stays bounded when the count probe fails', async () => {
  // Regression: with the count unknown the client fell back to offset=0 with
  // an uncapped limit — transferring the entire history. The fallback must
  // locate the end with bounded probes and still return the newest window.
  const { client, requests } = timelineFixtureClient(1_200, 'unavailable');
  const page = await client.getSessionTimeline('s1', { limit: 100 });
  assert.equal(page.entries.length, 100);
  assert.equal(page.entries[0]?.id, 'msg-1101');
  assert.equal(page.entries.at(-1)?.id, 'msg-1200');
  assert.equal(page.hasMore, true);
  assert.equal(page.nextCursor, '1100');
  // Every row request either probes a single row or fetches the final window
  // from deep in the history; nothing pulls the conversation from offset 0.
  for (const request of requests.filter((r) => r.includes('/messages'))) {
    assert.ok(
      /limit=1&/.test(request) || /offset=1100$/.test(request),
      `unbounded request: ${request}`,
    );
  }
});

test('a short history with a failed count probe takes one bounded fetch', async () => {
  const { client, requests } = timelineFixtureClient(7, 'unavailable');
  const page = await client.getSessionTimeline('s1', { limit: 3 });
  assert.deepEqual(
    page.entries.map((entry) => entry.id),
    ['msg-5', 'msg-6', 'msg-7'],
  );
  assert.equal(page.hasMore, true);
  assert.equal(page.nextCursor, '4');
  // One probe past the short-history bound, then a single capped fetch.
  assert.deepEqual(
    requests.filter((request) => request.includes('/messages')),
    [
      '/api/sessions/s1/messages?limit=1&offset=499',
      '/api/sessions/s1/messages?limit=500&offset=0',
    ],
  );
});

test('cancels a turn through the live transport sid', async () => {
  // Regression: `session.interrupt` rejects stored session ids with a 4001
  // (verified live on 0.19.0); the interrupt must use the live sid learned
  // when the turn was started or resumed.
  const sent: string[] = [];
  class FakeSocket {
    onopen?: () => void;
    onmessage?: (message: { data: string }) => void;
    onerror?: () => void;
    onclose?: () => void;
    constructor() {
      setTimeout(() => this.onopen?.(), 0);
    }
    send(data: string): void {
      sent.push(data);
      const frame = JSON.parse(data) as { id: number };
      setTimeout(() => {
        this.onmessage?.({
          data: JSON.stringify({
            id: frame.id,
            jsonrpc: '2.0',
            result: { status: 'interrupted' },
          }),
        });
      }, 0);
    }
    close(): void {
      // No-op for the fake.
    }
  }
  const fetchImpl = (async (url: string | URL) => {
    if (String(url).endsWith('/api/auth/ws-ticket')) {
      return jsonResponse({ ticket: 't-1' });
    }
    throw new Error(`unexpected request: ${String(url)}`);
  }) as unknown as typeof globalThis.fetch;
  const client = new GatewayClient({
    baseUrl: 'http://localhost:9119',
    fetch: fetchImpl,
    socketFactory: () => new FakeSocket() as unknown as WebSocket,
    tokens: { accessToken: 'a', provider: 'basic', refreshToken: 'r' },
  });

  // A pending conversation has no gateway session: nothing to interrupt.
  const pending = await client.cancelTurn('wave-pending-1', 'turn-0');
  assert.equal(pending.status, 'cancellation_requested');
  assert.equal(sent.length, 0);

  (client as unknown as { liveSessions: Map<string, string> }).liveSessions.set(
    '20260802_000000_abcdef',
    'live-9',
  );
  const result = await client.cancelTurn('20260802_000000_abcdef', 'turn-1');
  assert.equal(result.status, 'cancellation_requested');
  const interrupt = JSON.parse(sent[0]) as {
    method: string;
    params: { session_id: string };
  };
  assert.equal(interrupt.method, 'session.interrupt');
  assert.equal(interrupt.params.session_id, 'live-9');
});

test('the turn event queue tells cancellation apart from idle timeout', async () => {
  // An abort mid-wait is the user's decision and must not read as a dropped
  // stream (which would surface "Wave lost the connection to Hermes").
  const abortQueue = new TurnEventQueue(5_000);
  const controller = new AbortController();
  const pending = abortQueue.next(controller.signal);
  controller.abort();
  assert.equal(await pending, undefined);

  // A queue that stays silent past its idle budget reports a dropped stream.
  const idleQueue = new TurnEventQueue(20);
  const result = await idleQueue.next();
  assert.equal(typeof result, 'symbol');

  // A buffered frame is delivered even under an aborted signal only after
  // the abort check, which the pump performs — next() itself must still
  // never hang.
  const readyQueue = new TurnEventQueue(5_000);
  readyQueue.push({ payload: { text: 'hi' }, type: 'message.delta' });
  const frame = await readyQueue.next();
  assert.deepEqual(frame, { payload: { text: 'hi' }, type: 'message.delta' });
});

/**
 * A fake gateway socket that answers the turn RPCs (`session.create`,
 * `image.attach_bytes`, `prompt.submit`) and streams configured event frames
 * after a successful submit. Method behavior is overridable per test.
 */
function makeTurnFixtureClient(options: {
  attachResult?: { code: number; message: string };
  redirectError?: { code: number; message: string };
  redirectStatus?: 'queued' | 'redirected' | 'rejected' | 'unknown';
  submitResult?: { code: number; message: string };
}) {
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  class FakeTurnSocket {
    onopen?: () => void;
    onmessage?: (message: { data: string }) => void;
    onerror?: () => void;
    onclose?: () => void;
    constructor() {
      setTimeout(() => this.onopen?.(), 0);
    }
    send(data: string): void {
      const frame = JSON.parse(data) as {
        id: number;
        method: string;
        params: Record<string, unknown>;
      };
      calls.push({ method: frame.method, params: frame.params });
      const reply = (body: Record<string, unknown>) => {
        setTimeout(() => {
          this.onmessage?.({
            data: JSON.stringify({ id: frame.id, jsonrpc: '2.0', ...body }),
          });
        }, 0);
      };
      const emit = (type: string, payload: Record<string, unknown>) => {
        setTimeout(() => {
          this.onmessage?.({
            data: JSON.stringify({
              jsonrpc: '2.0',
              method: 'event',
              params: { payload, type },
            }),
          });
        }, 0);
      };
      if (frame.method === 'session.create') {
        reply({
          result: { session_id: 'live-1', stored_session_id: 'stored-1' },
        });
        return;
      }
      if (frame.method === 'image.attach_bytes') {
        if (options.attachResult) {
          reply({ error: options.attachResult });
          return;
        }
        reply({ result: { attached: true, count: 1 } });
        return;
      }
      if (frame.method === 'session.redirect') {
        if (options.redirectError) {
          reply({ error: options.redirectError });
          return;
        }
        reply({ result: { status: options.redirectStatus ?? 'redirected' } });
        return;
      }
      if (frame.method === 'prompt.submit') {
        if (options.submitResult) {
          reply({ error: options.submitResult });
          return;
        }
        reply({ result: { ok: true } });
        emit('message.delta', { text: 'reply text' });
        emit('message.complete', { text: 'reply text' });
        return;
      }
      reply({ result: {} });
    }
    close(): void {
      // No-op for the fake.
    }
  }
  const fetchImpl = (async (url: string | URL) => {
    if (String(url).endsWith('/api/auth/ws-ticket')) {
      return jsonResponse({ ticket: 't-1' });
    }
    throw new Error(`unexpected request: ${String(url)}`);
  }) as unknown as typeof globalThis.fetch;
  const client = new GatewayClient({
    baseUrl: 'http://localhost:9119',
    fetch: fetchImpl,
    socketFactory: () => new FakeTurnSocket() as unknown as WebSocket,
    tokens: { accessToken: 'a', provider: 'basic', refreshToken: 'r' },
  });
  return { calls, client };
}

const IMAGE_TURN_INPUT = [
  { text: 'What is attached?', type: 'text' as const },
  {
    dataUrl: 'data:image/png;base64,aWs=',
    mimeType: 'image/png' as const,
    name: 'tiny.png',
    type: 'image' as const,
  },
];

test('attaches images to the live session before submitting the turn', async () => {
  // Verified live on 0.19.0: `image.attach_bytes` queues the image on the
  // LIVE session (stored ids earn a 4001) and the next prompt.submit consumes
  // the queue, so the attach must land on the same socket, before submit.
  const { calls, client } = makeTurnFixtureClient({});
  const created = await client.createSession();
  const events: string[] = [];
  for await (const event of client.streamTurn(
    created.session.id,
    IMAGE_TURN_INPUT,
  )) {
    events.push(event.type);
  }
  assert.deepEqual(events, [
    'turn.started',
    'assistant.started',
    'assistant.delta',
    'assistant.completed',
    'turn.completed',
  ]);
  assert.deepEqual(
    calls.map((call) => call.method),
    ['session.create', 'image.attach_bytes', 'prompt.submit'],
  );
  const attach = calls[1];
  assert.equal(attach.params.session_id, 'live-1');
  // The data-URL prefix is stripped; the gateway gets bare base64.
  assert.equal(attach.params.content_base64, 'aWs=');
  assert.equal(attach.params.filename, 'tiny.png');
  assert.equal(calls[2].params.session_id, 'live-1');
});

test('surfaces the gateway reason when an attachment is rejected', async () => {
  const { client } = makeTurnFixtureClient({
    attachResult: {
      code: 4018,
      message: 'image too large (26214401 bytes; cap is 25 MB)',
    },
  });
  const created = await client.createSession();
  const stream = client.streamTurn(created.session.id, IMAGE_TURN_INPUT);
  await assert.rejects(stream.next(), (error: unknown) => {
    assert.ok(error instanceof WaveBackendError);
    assert.equal(error.kind, 'bad_request');
    assert.equal(error.retryable, false);
    assert.match(error.message, /image too large/);
    return true;
  });
});

test('a rejected submit reports its own error, not a dropped stream', async () => {
  const { client } = makeTurnFixtureClient({
    submitResult: { code: 4001, message: 'session not found' },
  });
  const created = await client.createSession();
  const events: string[] = [];
  const consume = async () => {
    for await (const event of client.streamTurn(created.session.id, 'hello')) {
      events.push(event.type);
    }
  };
  await assert.rejects(consume(), (error: unknown) => {
    assert.ok(error instanceof WaveBackendError);
    assert.equal(error.kind, 'not_found');
    assert.equal(error.message, 'session not found');
    return true;
  });
  assert.deepEqual(events, ['turn.started']);
});

test('redirects an active turn through its trusted live session exactly once', async () => {
  for (const status of ['queued', 'redirected', 'rejected'] as const) {
    const { calls, client } = makeTurnFixtureClient({
      redirectStatus: status,
    });
    const created = await client.createSession();
    const stream = client.streamTurn(created.session.id, 'Original request');
    const first = await stream.next();
    assert.equal(first.value?.type, 'turn.started');

    const result = await client.redirectTurn(
      created.session.id,
      '  Use SQLite instead.  ',
    );
    assert.equal(result.status, status);
    const redirects = calls.filter(
      (call) => call.method === 'session.redirect',
    );
    assert.equal(redirects.length, 1);
    assert.deepEqual(redirects[0]?.params, {
      session_id: 'live-1',
      text: 'Use SQLite instead.',
    });

    while (!(await stream.next()).done) {
      // Drain the fixture turn so its active-channel registration is cleaned.
    }
  }
});

test('a redirect race or malformed response restores control without retrying', async () => {
  const raced = makeTurnFixtureClient({
    redirectError: { code: 4010, message: 'turn is no longer redirectable' },
  });
  const created = await raced.client.createSession();
  const stream = raced.client.streamTurn(created.session.id, 'Original');
  await stream.next();
  await assert.rejects(
    raced.client.redirectTurn(created.session.id, 'Correction'),
    (error: unknown) => {
      assert.ok(error instanceof WaveBackendError);
      assert.equal(error.kind, 'conflict');
      assert.equal(error.retryable, false);
      return true;
    },
  );
  assert.equal(
    raced.calls.filter((call) => call.method === 'session.redirect').length,
    1,
  );
  while (!(await stream.next()).done) {
    // Drain the fixture turn.
  }

  const malformed = makeTurnFixtureClient({ redirectStatus: 'unknown' });
  const malformedCreated = await malformed.client.createSession();
  const malformedStream = malformed.client.streamTurn(
    malformedCreated.session.id,
    'Original',
  );
  await malformedStream.next();
  await assert.rejects(
    malformed.client.redirectTurn(malformedCreated.session.id, 'Correction'),
    (error: unknown) => {
      assert.ok(error instanceof WaveBackendError);
      assert.equal(error.kind, 'upstream_incompatible');
      assert.equal(error.retryable, false);
      return true;
    },
  );
  while (!(await malformedStream.next()).done) {
    // Drain the fixture turn.
  }
});

test('refuses empty corrections and sessions without a registered turn', async () => {
  const { calls, client } = makeTurnFixtureClient({});
  await assert.rejects(
    client.redirectTurn('stored-1', '   '),
    (error: unknown) => {
      assert.ok(error instanceof WaveBackendError);
      assert.equal(error.kind, 'bad_request');
      return true;
    },
  );
  await assert.rejects(
    client.redirectTurn('stored-1', 'Use SQLite'),
    (error: unknown) => {
      assert.ok(error instanceof WaveBackendError);
      assert.equal(error.kind, 'conflict');
      return true;
    },
  );
  assert.equal(
    calls.filter((call) => call.method === 'session.redirect').length,
    0,
  );
});

test('translates observed tool frames with bounded input and output details', () => {
  // tool.generating / tool.start / tool.complete are the frames 0.19.0
  // actually emits (verified live); tool.complete carries args and result,
  // and a truthy result.error — a denied approval's BLOCKED text, for
  // example — is the failure signal.
  const translator = new GatewayTurnTranslator({
    messageId: 'assistant-9',
    sessionId: 'session-1',
    turnId: 'turn-9',
  });
  translator.start();

  assert.deepEqual(
    translator.translate({
      payload: { name: 'terminal' },
      type: 'tool.generating',
    }),
    [],
  );
  const started = translator.translate({
    payload: { context: 'Running echo hi', name: 'terminal', tool_id: 't1' },
    type: 'tool.start',
  });
  assert.equal(started[0].type, 'tool.status');
  assert.equal(started[0].status, 'started');
  assert.equal(started[0].toolName, 'terminal');

  const completed = translator.translate({
    payload: {
      args: { command: 'echo hi' },
      duration_s: 0.4,
      name: 'terminal',
      result: { error: null, exit_code: 0, output: 'hi' },
      tool_id: 't1',
    },
    type: 'tool.complete',
  });
  assert.equal(completed[0].type, 'tool.status');
  assert.equal(completed[0].status, 'completed');
  assert.equal(completed[0].toolInput?.text, '{"command":"echo hi"}');
  assert.equal(completed[0].toolOutput?.text, 'hi');

  const failed = translator.translate({
    payload: {
      args: { command: 'rm -rf /tmp/x' },
      name: 'terminal',
      result: {
        error: 'BLOCKED: Command denied by user.',
        exit_code: -1,
        output: '',
      },
      tool_id: 't2',
    },
    type: 'tool.complete',
  });
  assert.equal(failed[0].status, 'failed');
  assert.match(failed[0].toolOutput?.text ?? '', /BLOCKED/);
});

test('translates approval and clarify prompts and resolves them on progress', () => {
  const translator = new GatewayTurnTranslator({
    messageId: 'assistant-10',
    sessionId: 'session-1',
    turnId: 'turn-10',
  });
  translator.start();

  // approval.request: session-FIFO (no request_id), choices from the frame.
  const approval = translator.translate({
    payload: {
      allow_permanent: true,
      choices: ['once', 'session', 'always', 'deny'],
      command: 'rm -rf /tmp/wave-probe',
      description: 'delete in root path',
      pattern_key: 'delete in root path',
    },
    type: 'approval.request',
  });
  assert.equal(approval.length, 1);
  const prompt = approval[0];
  assert.equal(prompt.type, 'prompt.request');
  assert.equal(prompt.kind, 'approval');
  assert.equal(prompt.allowsFreeText, false);
  assert.deepEqual(prompt.choices, ['once', 'session', 'always', 'deny']);
  assert.equal(prompt.command?.text, 'rm -rf /tmp/wave-probe');
  assert.equal(prompt.description, 'delete in root path');

  // The next frame proves the wait ended: prompt.resolved precedes it.
  const afterAnswer = translator.translate({
    payload: {
      args: { command: 'rm -rf /tmp/wave-probe' },
      name: 'terminal',
      result: { error: null, exit_code: 0, output: '' },
      tool_id: 't1',
    },
    type: 'tool.complete',
  });
  assert.deepEqual(
    afterAnswer.map((event) => event.type),
    ['prompt.resolved', 'tool.status'],
  );
  assert.equal(afterAnswer[0].promptId, prompt.promptId);

  // clarify.request correlates by the gateway's request_id.
  const clarify = translator.translate({
    payload: {
      choices: ['alpha', 'beta'],
      question: 'Which flavor?',
      request_id: 'req-77',
    },
    type: 'clarify.request',
  });
  assert.equal(clarify[0].type, 'prompt.request');
  assert.equal(clarify[0].kind, 'clarify');
  assert.equal(clarify[0].promptId, 'req-77');
  assert.equal(clarify[0].allowsFreeText, true);
  assert.deepEqual(clarify[0].choices, ['alpha', 'beta']);
  assert.equal(clarify[0].question, 'Which flavor?');

  // A clarify frame without a request_id cannot be answered: noise.
  assert.deepEqual(
    translator.translate({
      payload: { question: 'orphan' },
      type: 'clarify.request',
    }),
    [],
  );

  // Turn completion resolves a still-pending prompt before finishing.
  const finished = translator.translate({
    payload: { text: 'done' },
    type: 'message.complete',
  });
  assert.deepEqual(
    finished.map((event) => event.type),
    // assistant.started is synthesized because no delta ever arrived.
    [
      'prompt.resolved',
      'assistant.started',
      'assistant.completed',
      'turn.completed',
    ],
  );

  // secret/sudo requests surface as decline-only prompts.
  const secretTranslator = new GatewayTurnTranslator({
    messageId: 'assistant-11',
    sessionId: 'session-1',
    turnId: 'turn-11',
  });
  secretTranslator.start();
  const secret = secretTranslator.translate({
    payload: { prompt: 'API key for svc', request_id: 'req-88' },
    type: 'secret.request',
  });
  assert.equal(secret[0].kind, 'secret');
  assert.equal(secret[0].allowsFreeText, false);
  assert.deepEqual(secret[0].choices, []);
  assert.equal(secret[0].question, 'API key for svc');
});

test('routes prompt responses through the active turn socket', async () => {
  const { calls, client } = makeTurnFixtureClient({});
  const created = await client.createSession();
  // Regression: a first turn starts on a placeholder id and learns its stored
  // id mid-flight. The prompt channel must be keyed by the STORED id, because
  // that is what every later lookup resolves to — otherwise answering an
  // approval on a brand-new conversation fails with "no longer waiting".
  const prompts: string[] = [];
  for await (const event of client.streamTurn(created.session.id, 'hello')) {
    if (event.type === 'turn.started') {
      const channels = (
        client as unknown as { activeTurns: Map<string, unknown> }
      ).activeTurns;
      prompts.push(...channels.keys());
    }
  }
  assert.deepEqual(prompts, ['stored-1']);
  // The turn ended, so its prompt channel is gone.
  await assert.rejects(
    client.respondToPrompt(created.session.id, {
      choice: 'once',
      kind: 'approval',
    }),
    (error: unknown) => {
      assert.ok(error instanceof WaveBackendError);
      assert.equal(error.kind, 'not_found');
      return true;
    },
  );

  // With an active turn, responses ride its rpc and live sid.
  const recorded: { method: string; params: Record<string, unknown> }[] = [];
  (
    client as unknown as {
      activeTurns: Map<string, { liveSessionId: string; rpc: unknown }>;
    }
  ).activeTurns.set('stored-1', {
    liveSessionId: 'live-1',
    rpc: {
      call: (method: string, params: Record<string, unknown>) => {
        recorded.push({ method, params });
        return Promise.resolve({});
      },
    },
  });
  await client.respondToPrompt('stored-1', {
    choice: 'deny',
    kind: 'approval',
  });
  await client.respondToPrompt('stored-1', {
    answer: 'alpha',
    kind: 'clarify',
    promptId: 'req-77',
  });
  await client.respondToPrompt('stored-1', {
    kind: 'secret',
    promptId: 'req-88',
  });
  await client.respondToPrompt('stored-1', {
    kind: 'sudo',
    promptId: 'req-99',
  });
  assert.deepEqual(recorded, [
    {
      method: 'approval.respond',
      params: { choice: 'deny', session_id: 'live-1' },
    },
    {
      method: 'clarify.respond',
      params: { answer: 'alpha', request_id: 'req-77', session_id: 'live-1' },
    },
    {
      method: 'secret.respond',
      params: { request_id: 'req-88', session_id: 'live-1', value: '' },
    },
    {
      method: 'sudo.respond',
      params: { password: '', request_id: 'req-99', session_id: 'live-1' },
    },
  ]);
  assert.equal(
    calls.some((call) => call.method === 'approval.respond'),
    false,
    'the closed turn socket must not receive responses',
  );
});

test('refuses to delete a conversation whose turn is still running', async () => {
  // Wave's contract requires an active-turn delete to fail explicitly. The
  // gateway does not enforce it — a mid-turn DELETE answers ok:true, the turn
  // finishes, and the session reappears (verified live on 0.19.0) — so the
  // client enforces it using the gateway's own active_list status, which
  // reports "working" during a turn.
  const requests: string[] = [];
  class ActiveListSocket {
    onopen?: () => void;
    onmessage?: (message: { data: string }) => void;
    onerror?: () => void;
    onclose?: () => void;
    constructor() {
      setTimeout(() => this.onopen?.(), 0);
    }
    send(data: string): void {
      const frame = JSON.parse(data) as { id: number; method: string };
      setTimeout(() => {
        this.onmessage?.({
          data: JSON.stringify({
            id: frame.id,
            jsonrpc: '2.0',
            result: {
              sessions: [
                { id: 'live-1', session_key: 'busy-1', status: 'working' },
                { id: 'live-2', session_key: 'calm-1', status: 'idle' },
              ],
            },
          }),
        });
      }, 0);
    }
    close(): void {
      // No-op for the fake.
    }
  }
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const parsed = new URL(String(url));
    requests.push(`${init?.method ?? 'GET'} ${parsed.pathname}`);
    if (parsed.pathname.endsWith('/api/auth/ws-ticket')) {
      return jsonResponse({ ticket: 't-1' });
    }
    return jsonResponse({ ok: true });
  }) as unknown as typeof globalThis.fetch;
  const client = new GatewayClient({
    baseUrl: 'http://localhost:9119',
    fetch: fetchImpl,
    socketFactory: () => new ActiveListSocket() as unknown as WebSocket,
    tokens: { accessToken: 'a', provider: 'basic', refreshToken: 'r' },
  });

  await assert.rejects(client.deleteSession('busy-1'), (error: unknown) => {
    assert.ok(error instanceof WaveBackendError);
    assert.equal(error.kind, 'conflict');
    assert.equal(error.retryable, false);
    assert.match(error.message, /still working/);
    return true;
  });
  assert.equal(
    requests.some((request) => request.startsWith('DELETE')),
    false,
    'a busy conversation must never reach the delete endpoint',
  );

  // An idle conversation deletes normally.
  const deleted = await client.deleteSession('calm-1');
  assert.equal(deleted.deleted, true);
  assert.ok(requests.includes('DELETE /api/sessions/calm-1'));

  // getActiveTurn recognizes 0.19.0's "working" status.
  const active = await client.getActiveTurn('busy-1');
  assert.ok(active.activeTurn);
  const idle = await client.getActiveTurn('calm-1');
  assert.equal(idle.activeTurn, null);
});
