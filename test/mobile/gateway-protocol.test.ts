import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeMessageRow,
  normalizeSessionSource,
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
  normalizeSurvivorRowIdMap,
  normalizeSurvivorUserRowIds,
  normalizeGatewayCompatibilityStatus,
  normalizeGatewaySessionLiveState,
  TurnEventQueue,
} from '../../src/services/gateway/gateway-client.ts';
import { isPendingSessionId } from '../../src/services/wave/wave-chat-client.ts';
import type { WaveTruncationSurvivors } from '../../src/services/wave/wave-chat-client.ts';
import {
  GatewayTurnTranslator,
  isLocalPromptId,
} from '../../src/services/gateway/gateway-turn-events.ts';
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

test('normalizes live-session phases and freshness without exposing raw rows', () => {
  for (const entry of GATEWAY_V020_FIXTURE.activeList.sessions) {
    const normalized = normalizeGatewaySessionLiveState(entry);
    assert.equal(normalized.liveStatus, entry.status);
    if ('last_active' in entry)
      assert.match(normalized.lastActiveAt ?? '', /Z$/);
  }
  assert.deepEqual(normalizeGatewaySessionLiveState({ running: true }), {
    liveStatus: 'working',
  });
  assert.deepEqual(normalizeGatewaySessionLiveState({ status: 'running' }), {
    liveStatus: 'working',
  });
  assert.deepEqual(
    normalizeGatewaySessionLiveState({
      last_active: 'invalid',
      status: 'future-state',
    }),
    { liveStatus: 'idle' },
  );
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
        pinned: 1,
        source: 'a2a',
        status: 'working',
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
  assert.equal(sessions[0].liveStatus, 'working');
  assert.equal(sessions[0].pinned, true);
  assert.equal(sessions[0].source, 'external');
  assert.match(sessions[0].startedAt ?? '', /^2026-/);
  assert.match(sessions[0].lastActiveAt ?? '', /^2026-/);

  assert.deepEqual(normalizeSessionRows({}), []);
  assert.deepEqual(normalizeSessionRows(null), []);
});

test('normalizes open-ended sources without leaking raw identifiers', () => {
  assert.equal(normalizeSessionSource(undefined), 'chat');
  assert.equal(normalizeSessionSource('gateway'), 'chat');
  assert.equal(normalizeSessionSource('wave'), 'chat');
  assert.equal(normalizeSessionSource('cron'), 'automation');
  assert.equal(normalizeSessionSource('a2a'), 'external');
  assert.equal(normalizeSessionSource('telegram'), 'external');
  assert.equal(normalizeSessionSource('future_mcp_origin'), 'other');
  assert.deepEqual(normalizeSessionRows({ data: [{ id: 'api-row' }] }), [
    {
      id: 'api-row',
      liveStatus: 'idle',
      pinned: false,
      source: 'chat',
      unread: false,
    },
  ]);
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
  assert.equal(entries[0].rowId, 1);
  assert.match(entries[0].message.createdAt ?? '', /^2026-/);
  assert.equal(entries[2].message.toolName, 'search');
  assert.deepEqual(entries[2].message.toolOutput, {
    text: '{"ok":true}',
    truncated: false,
  });
  // Unknown roles degrade rather than disappear.
  assert.equal(entries[3].message.role, 'unknown');

  const invalidRowIds = normalizeTimelineEntries({
    messages: [
      { content: 'negative', id: -1, role: 'user' },
      { content: 'string', id: 'legacy-id', role: 'user' },
    ],
  });
  assert.equal(invalidRowIds[0]?.rowId, undefined);
  assert.equal(invalidRowIds[1]?.rowId, undefined);

  assert.deepEqual(normalizeTimelineEntries({ messages: 'nope' }), []);
  // A row with no content and no tool identity carries nothing to render.
  assert.equal(
    normalizeMessageRow({ role: 'assistant', content: '' }),
    undefined,
  );
});

test('correlates assistant tool_calls arguments onto stored tool rows', () => {
  const entries = normalizeTimelineEntries({
    messages: [
      {
        id: 1,
        role: 'assistant',
        content: 'Checking both.',
        tool_calls: [
          {
            id: 'call-a',
            type: 'function',
            function: { name: 'search', arguments: '{"query":"tides"}' },
          },
          // Flat variant with object arguments, no id: matched by name order.
          { name: 'search', arguments: { query: 'currents' } },
        ],
      },
      {
        id: 2,
        role: 'tool',
        content: 'first result',
        tool_call_id: 'call-a',
        tool_name: 'search',
      },
      { id: 3, role: 'tool', content: 'second result', tool_name: 'search' },
      // No pending call left: the row keeps no input rather than guessing.
      { id: 4, role: 'tool', content: 'orphan', tool_name: 'search' },
    ],
  });
  assert.deepEqual(entries[1].message.toolInput, {
    text: '{"query":"tides"}',
    truncated: false,
  });
  assert.deepEqual(entries[2].message.toolInput, {
    text: '{"query":"currents"}',
    truncated: false,
  });
  assert.equal(entries[3].message.toolInput, undefined);
});

test('tool_calls correlation resets per calling row and survives strings', () => {
  const entries = normalizeTimelineEntries({
    messages: [
      {
        id: 1,
        role: 'assistant',
        content: 'One.',
        // Unanswered call: must not leak onto later turns' rows.
        tool_calls: [{ name: 'search', arguments: '{"query":"stale"}' }],
      },
      {
        id: 10,
        role: 'assistant',
        content: '',
        // Renders nothing itself (no content, no reasoning) but still owns
        // its results' inputs.
        tool_calls: [
          {
            id: 'call-b',
            function: { name: 'browse', arguments: '{"url":"https://x"}' },
          },
        ],
      },
      {
        id: 11,
        role: 'tool',
        content: 'page',
        tool_call_id: 'call-b',
        tool_name: 'browse',
      },
      {
        id: 2,
        role: 'assistant',
        content: 'Two.',
        // Serialized JSON variant of the whole array still parses.
        tool_calls: JSON.stringify([
          { function: { name: 'search', arguments: '{"query":"fresh"}' } },
        ]),
      },
      { id: 3, role: 'tool', content: 'result', tool_name: 'search' },
      { id: 4, role: 'tool', content: 'extra', tool_name: 'search' },
    ],
  });
  // The tool_calls-only assistant row renders no entry of its own…
  assert.deepEqual(
    entries.map((entry) => entry.id),
    ['msg-1', 'msg-11', 'msg-2', 'msg-3', 'msg-4'],
  );
  // …but its arguments still reach its result row.
  assert.deepEqual(entries[1].message.toolInput, {
    text: '{"url":"https://x"}',
    truncated: false,
  });
  assert.deepEqual(entries[3].message.toolInput, {
    text: '{"query":"fresh"}',
    truncated: false,
  });
  assert.equal(entries[4].message.toolInput, undefined);
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
  assert.deepEqual(
    translator.translate({ type: 'message.interim', payload: {} }),
    [],
  );

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

test('projects v0.20 interim, progress, and reviewed lifecycle frames', () => {
  const translator = new GatewayTurnTranslator({
    messageId: 'assistant-v020',
    now: () => new Date('2026-08-03T00:00:00.000Z'),
    sessionId: 'session-v020',
    turnId: 'turn-v020',
  });
  const emitted = [translator.start()];
  emitted.push(
    ...translator.translate({
      payload: { text: 'Synthetic interim.' },
      type: 'message.delta',
    }),
  );
  const interim = translator.translate(GATEWAY_V020_FIXTURE.turnFrames[0]);
  assert.equal(interim.at(-1)?.type, 'assistant.interim');
  assert.equal(interim.at(-1)?.content, 'Synthetic interim.');
  emitted.push(...interim);

  const toolStart = translator.translate({
    payload: { name: 'search' },
    type: 'tool.start',
  });
  const progress = translator.translate({
    payload: { preview: 'x'.repeat(5_000) },
    type: 'tool.progress',
  });
  assert.equal(progress[0]?.type, 'tool.status');
  assert.equal(progress[0]?.status, 'progress');
  assert.equal(progress[0]?.toolName, 'search');
  assert.equal(progress[0]?.toolOutput?.text.length, 4_000);
  assert.equal(progress[0]?.toolOutput?.truncated, true);
  assert.equal(progress[0]?.toolOutputIsPreview, true);
  emitted.push(...toolStart, ...progress);

  const compacting = translator.translate(GATEWAY_V020_FIXTURE.turnFrames[2]);
  assert.equal(compacting[0]?.type, 'activity.status');
  assert.equal(compacting[0]?.status, 'compacting');
  emitted.push(...compacting);
  const goal = translator.translate({
    payload: { kind: 'goal', text: '✓ Synthetic goal complete' },
    type: 'status.update',
  });
  assert.equal(goal[0]?.type, 'activity.status');
  assert.equal(goal[0]?.status, 'goal-complete');
  emitted.push(...goal);
  assert.deepEqual(
    translator.translate({
      payload: { kind: 'reasoning', text: 'must stay hidden' },
      type: 'status.update',
    }),
    [],
  );

  const ended = translator.translate({
    payload: { response_previewed: true, text: 'Synthetic interim. Extended.' },
    type: 'message.complete',
  });
  assert.equal(ended[0]?.type, 'assistant.completed');
  assert.equal(ended[0]?.content, 'Synthetic interim. Extended.');
  assert.equal(ended[0]?.replacesLastInterim, true);
  emitted.push(...ended);
  assert.deepEqual(
    emitted.map((event) => event.sequence),
    emitted.map((_, index) => index),
  );

  const distinct = new GatewayTurnTranslator({
    messageId: 'assistant-distinct',
    sessionId: 'session-v020',
    turnId: 'turn-distinct',
  });
  distinct.start();
  distinct.translate({
    payload: { already_streamed: true, text: 'Same words.' },
    type: 'message.interim',
  });
  const distinctEnd = distinct.translate({
    payload: { text: 'Same words.' },
    type: 'message.complete',
  });
  assert.equal(distinctEnd[0]?.type, 'assistant.completed');
  assert.equal(distinctEnd[0]?.replacesLastInterim, undefined);
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
    // The unconfirmed latest-order attempt degrades to the legacy detail +
    // oldest-offset path.
    'GET /api/sessions/20260802_000000_abcdef/messages',
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
  assert.equal(
    new URL(requestedUrl).searchParams.get('include_children'),
    'false',
  );
  assert.equal(new URL(requestedUrl).searchParams.get('order'), 'recent');
  // Messageless session shells stay hidden, mirroring Hermes Desktop.
  assert.equal(new URL(requestedUrl).searchParams.get('min_messages'), '1');
});

test('pins a persisted session with one non-retrying PATCH', async () => {
  const requests: { body?: string; method: string; path: string }[] = [];
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    requests.push({
      body: typeof init?.body === 'string' ? init.body : undefined,
      method: init?.method ?? 'GET',
      path: new URL(String(url)).pathname,
    });
    return jsonResponse({ ok: true, pinned: true });
  }) as unknown as typeof globalThis.fetch;
  const client = new GatewayClient({
    baseUrl: 'http://localhost:9119',
    fetch: fetchImpl,
    socketFactory: () => {
      throw new Error('no socket needed');
    },
    tokens: { accessToken: 'a', provider: 'basic', refreshToken: 'r' },
  });

  const result = await client.setSessionPinned('session-1', true);
  assert.equal(result.session.pinned, true);
  assert.deepEqual(requests, [
    {
      body: '{"pinned":true}',
      method: 'PATCH',
      path: '/api/sessions/session-1',
    },
  ]);
  await assert.rejects(
    client.setSessionPinned('wave-pending-1', true),
    /Send a message before pinning/,
  );
  assert.equal(requests.length, 1);
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

function latestTimelineFixtureClient(rowCount: number) {
  const rows = Array.from({ length: rowCount }, (_, index) => ({
    content: `message ${index + 1}`,
    id: index + 1,
    role: index % 2 === 0 ? 'user' : 'assistant',
  }));
  const requests: string[] = [];
  const fetchImpl = (async (url: string | URL) => {
    const parsed = new URL(String(url));
    requests.push(`${parsed.pathname}${parsed.search}`);
    assert.equal(parsed.searchParams.get('order'), 'latest');
    const limit = Number(parsed.searchParams.get('limit') ?? '500');
    const offset = Number(parsed.searchParams.get('offset') ?? '0');
    const end = Math.max(rows.length - offset, 0);
    const start = Math.max(end - limit, 0);
    const page = rows.slice(start, end);
    return jsonResponse({
      data: page,
      pagination: { limit, offset, order: 'latest', returned: page.length },
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

test('uses the v0.20.1 newest-relative message contract when proven', async () => {
  const { client, requests } = latestTimelineFixtureClient(7);
  const first = await client.getSessionTimeline('s1', { limit: 3 });
  assert.deepEqual(
    first.entries.map((entry) => entry.id),
    ['msg-5', 'msg-6', 'msg-7'],
  );
  assert.equal(first.nextCursor, 'latest:3');

  const second = await client.getSessionTimeline('s1', {
    before: first.nextCursor,
    limit: 3,
  });
  assert.deepEqual(
    second.entries.map((entry) => entry.id),
    ['msg-2', 'msg-3', 'msg-4'],
  );
  assert.equal(second.nextCursor, 'latest:6');

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
  assert.deepEqual(requests, [
    '/api/sessions/s1/messages?limit=4&offset=0&order=latest&include_compacted=true',
    '/api/sessions/s1/messages?limit=4&offset=3&order=latest&include_compacted=true',
    '/api/sessions/s1/messages?limit=4&offset=6&order=latest&include_compacted=true',
  ]);
});

test('latest paging terminates on an exact page multiple', async () => {
  const { client, requests } = latestTimelineFixtureClient(6);
  const first = await client.getSessionTimeline('s1', { limit: 3 });
  const second = await client.getSessionTimeline('s1', {
    before: first.nextCursor,
    limit: 3,
  });
  assert.deepEqual(
    second.entries.map((entry) => entry.id),
    ['msg-1', 'msg-2', 'msg-3'],
  );
  assert.equal(second.hasMore, false);
  assert.equal(requests.length, 2);
});

test('a latest-order transport failure is not treated as unsupported', async () => {
  let requests = 0;
  const client = new GatewayClient({
    baseUrl: 'http://localhost:9119',
    fetch: (async () => {
      requests += 1;
      throw new Error('offline');
    }) as unknown as typeof globalThis.fetch,
    socketFactory: () => {
      throw new Error('no socket needed');
    },
    tokens: { accessToken: 'a', provider: 'basic', refreshToken: 'r' },
  });
  await assert.rejects(client.getSessionTimeline('s1'), (error: unknown) => {
    assert.ok(error instanceof WaveBackendError);
    assert.equal(error.kind, 'network');
    return true;
  });
  assert.equal(requests, 1);
});

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
  for (const request of messageRequests.filter((entry) =>
    entry.includes('limit=1&'),
  )) {
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
  for (const request of requests.filter(
    (entry) => entry.includes('/messages') && !entry.includes('order=latest'),
  )) {
    assert.ok(
      /limit=1&/.test(request) || /offset=1100(&|$)/.test(request),
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
      '/api/sessions/s1/messages?limit=4&offset=0&order=latest&include_compacted=true',
      '/api/sessions/s1/messages?limit=1&offset=499&include_compacted=true',
      '/api/sessions/s1/messages?limit=500&offset=0&include_compacted=true',
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
  submitSuccessResult?: Record<string, unknown>;
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
        reply({ result: options.submitSuccessResult ?? { ok: true } });
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
  assert.equal(calls[0].params.source, 'wave');
  assert.equal(attach.params.session_id, 'live-1');
  // The data-URL prefix is stripped; the gateway gets bare base64.
  assert.equal(attach.params.content_base64, 'aWs=');
  assert.equal(attach.params.filename, 'tiny.png');
  assert.equal(calls[2].params.session_id, 'live-1');
  assert.equal(calls[2].params.confirm_truncate, undefined);
});

test('v0.20.1 regenerate confirms truncation and targets a durable row', async () => {
  const { calls, client } = makeTurnFixtureClient({
    submitSuccessResult: { survivor_user_row_ids: [101, null, 303] },
  });
  (
    client as unknown as {
      latestMessageOrderSupport: 'supported';
    }
  ).latestMessageOrderSupport = 'supported';
  const created = await client.createSession();
  let survivors: WaveTruncationSurvivors | undefined;
  for await (const _event of client.streamTurn(
    created.session.id,
    'Replay this turn',
    undefined,
    {
      onTruncationCommitted: (reported) => {
        survivors = reported;
      },
      truncateBeforeRowId: 777,
      truncateBeforeUserOrdinal: 4,
    },
  )) {
    // Drain the fixture turn.
  }
  const submit = calls.find((call) => call.method === 'prompt.submit');
  assert.deepEqual(submit?.params, {
    confirm_truncate: true,
    session_id: 'live-1',
    text: 'Replay this turn',
    truncate_before_row_id: 777,
  });
  assert.deepEqual(survivors, { kind: 'ordinal', rowIds: [101, null, 303] });
});

test('a durable regenerate asks for a survivor map and rebinds from it', async () => {
  const { calls, client } = makeTurnFixtureClient({
    // v0.21 answers the map and deliberately omits the ordinal array.
    submitSuccessResult: { survivor_row_id_map: { '101': 201, '202': null } },
  });
  (
    client as unknown as { latestMessageOrderSupport: 'supported' }
  ).latestMessageOrderSupport = 'supported';
  const created = await client.createSession();
  let survivors: WaveTruncationSurvivors | undefined;
  for await (const _event of client.streamTurn(
    created.session.id,
    'Replay this turn',
    undefined,
    {
      onTruncationCommitted: (reported) => {
        survivors = reported;
      },
      // Duplicates and junk must not reach the wire.
      rebindRowIds: [101, 101, 202, -5, 3.5],
      truncateBeforeRowId: 777,
      truncateBeforeUserOrdinal: 4,
    },
  )) {
    // Drain the fixture turn.
  }
  const submit = calls.find((call) => call.method === 'prompt.submit');
  assert.deepEqual(submit?.params, {
    confirm_truncate: true,
    rebind_survivor_row_ids: [101, 202],
    session_id: 'live-1',
    text: 'Replay this turn',
    truncate_before_row_id: 777,
  });
  assert.equal(survivors?.kind, 'map');
  assert.deepEqual(
    survivors?.kind === 'map' ? [...survivors.rowIds] : undefined,
    [
      [101, 201],
      [202, null],
    ],
  );
});

test('a legacy rewind never asks for a survivor map', async () => {
  // No durable capability proof: the ordinal path must stay exactly as it was,
  // so an older gateway keeps answering `survivor_user_row_ids`.
  const { calls, client } = makeTurnFixtureClient({
    submitSuccessResult: { survivor_user_row_ids: [101] },
  });
  const created = await client.createSession();
  for await (const _event of client.streamTurn(
    created.session.id,
    'Replay this turn',
    undefined,
    {
      rebindRowIds: [101],
      truncateBeforeRowId: 777,
      truncateBeforeUserOrdinal: 4,
    },
  )) {
    // Drain the fixture turn.
  }
  const submit = calls.find((call) => call.method === 'prompt.submit');
  assert.equal(submit?.params.rebind_survivor_row_ids, undefined);
});

test('legacy regenerate keeps ordinal targeting with explicit consent', async () => {
  const { calls, client } = makeTurnFixtureClient({});
  const created = await client.createSession();
  for await (const _event of client.streamTurn(
    created.session.id,
    'Replay the first turn',
    undefined,
    {
      truncateBeforeRowId: 777,
      truncateBeforeUserOrdinal: 0,
    },
  )) {
    // Drain the fixture turn.
  }
  const submit = calls.find((call) => call.method === 'prompt.submit');
  assert.deepEqual(submit?.params, {
    confirm_empty_truncate: true,
    confirm_truncate: true,
    session_id: 'live-1',
    text: 'Replay the first turn',
    truncate_before_user_ordinal: 0,
  });
});

test('normalizes survivor row ids without retaining invalid addresses', () => {
  assert.equal(normalizeSurvivorUserRowIds(undefined), undefined);
  assert.deepEqual(normalizeSurvivorUserRowIds([1, null, '2', -3, 4.5, 6]), {
    kind: 'ordinal',
    rowIds: [1, null, null, null, null, 6],
  });
  // The map form: string keys, explicit nulls, and junk on both sides.
  assert.equal(normalizeSurvivorRowIdMap(undefined), undefined);
  assert.equal(normalizeSurvivorRowIdMap([1, 2]), undefined);
  const mapped = normalizeSurvivorRowIdMap({
    '-1': 5,
    '10': 20,
    '11': null,
    '12': '30',
    '13': 4.5,
    nope: 7,
  });
  assert.equal(mapped?.kind, 'map');
  assert.deepEqual(mapped?.kind === 'map' ? [...mapped.rowIds] : undefined, [
    [10, 20],
    [11, null],
  ]);
});

test('tags every stored-session resume as a Wave client', async () => {
  const streamed = makeTurnFixtureClient({});
  for await (const _event of streamed.client.streamTurn('stored-9', 'hello')) {
    // Drain the fixture turn.
  }
  assert.deepEqual(streamed.calls[0], {
    method: 'session.resume',
    params: { omit_messages: true, session_id: 'stored-9', source: 'wave' },
  });

  const reattached = makeTurnFixtureClient({});
  for await (const _event of reattached.client.resumeTurnStream(
    'stored-9',
    'turn-9',
    -1,
  )) {
    // The gateway has no replay frames on this path.
  }
  assert.deepEqual(reattached.calls[0], {
    method: 'session.resume',
    params: { omit_messages: true, session_id: 'stored-9', source: 'wave' },
  });
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

test('normalizes live titles and unexpected MCP setup as decline-only input', () => {
  const translator = new GatewayTurnTranslator({
    messageId: 'assistant-v0201',
    sessionId: 'stored-v0201',
    turnId: 'turn-v0201',
  });
  translator.start();
  const title = translator.translate({
    payload: {
      session_id: 'stored-v0201',
      title: `  ${'Generated title '.repeat(30)}  `,
    },
    type: 'session.title',
  });
  assert.equal(title[0]?.type, 'session.title.updated');
  assert.equal(title[0]?.storedSessionId, 'stored-v0201');
  assert.equal(title[0]?.title.length, 300);
  assert.deepEqual(
    translator.translate({
      payload: { session_id: 'bad/session', title: 'Ignored' },
      type: 'session.title',
    }),
    [],
  );

  const setup = translator.translate({
    payload: {
      action: 'authorize',
      reason: 'Access the repository requested in this conversation.',
      request_id: 'mcp-request-1',
      server: 'github',
    },
    type: 'mcp.setup.request',
  });
  assert.equal(setup[0]?.type, 'prompt.request');
  assert.equal(setup[0]?.kind, 'mcp-setup');
  assert.equal(setup[0]?.server, 'github');
  assert.equal(setup[0]?.allowsFreeText, false);
  assert.deepEqual(setup[0]?.choices, []);
  assert.match(setup[0]?.description ?? '', /authorize.*github/i);
  assert.match(setup[0]?.description ?? '', /repository requested/i);
  assert.equal(setup[0]?.question, undefined);

  const expired = translator.translate({
    payload: { request_id: 'mcp-request-1' },
    type: 'mcp.setup.expire',
  });
  assert.equal(expired[0]?.type, 'prompt.resolved');
  assert.equal(expired[0]?.promptId, 'mcp-request-1');
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
    kind: 'mcp-setup',
    promptId: 'req-mcp',
    server: 'github',
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
      method: 'mcp.setup.respond',
      params: {
        request_id: 'req-mcp',
        result: '{"server":"github","status":"declined"}',
        session_id: 'live-1',
      },
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
                {
                  id: 'live-1',
                  last_active: 1_785_642_618,
                  session_key: 'busy-1',
                  status: 'working',
                },
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
  assert.equal(active.liveStatus, 'working');
  assert.match(active.lastActiveAt ?? '', /Z$/);
  const idle = await client.getActiveTurn('calm-1');
  assert.equal(idle.activeTurn, null);
  assert.equal(idle.liveStatus, 'idle');
});

test('reasoning frames become bounded reasoning.delta events', () => {
  const translator = new GatewayTurnTranslator({
    messageId: 'assistant-r',
    now: () => new Date('2026-08-07T00:00:00.000Z'),
    sessionId: 'session-1',
    turnId: 'turn-1',
  });
  translator.start();

  const events = translator.translate({
    payload: { text: 'Considering the options. ' },
    type: 'reasoning.delta',
  });
  const delta = events.find((event) => event.type === 'reasoning.delta');
  assert.ok(delta);
  assert.equal(delta.type, 'reasoning.delta');
  assert.equal(
    'delta' in delta ? delta.delta : undefined,
    'Considering the options. ',
  );
  assert.equal(
    'messageId' in delta ? delta.messageId : undefined,
    'assistant-r',
  );

  // Empty payloads carry nothing.
  assert.deepEqual(
    translator.translate({ payload: {}, type: 'reasoning.delta' }),
    [],
  );
});

test('stored rows normalize plain-text reasoning with desktop precedence', () => {
  const entries = normalizeTimelineEntries({
    messages: [
      { content: 'Done.', id: 1, reasoning: 'thought a', role: 'assistant' },
      {
        content: 'Alt.',
        id: 2,
        reasoning_content: 'thought b',
        role: 'assistant',
      },
      // Opaque structures never cross.
      {
        content: 'Opaque.',
        id: 3,
        reasoning_details: [{ type: 'x' }],
        role: 'assistant',
      },
      // Thinking-only rows survive.
      { content: '', id: 4, reasoning: 'silent thought', role: 'assistant' },
      // Non-assistant reasoning is ignored.
      { content: 'hi', id: 5, reasoning: 'nope', role: 'user' },
    ],
  });
  assert.deepEqual(
    entries.map((entry) =>
      entry.type === 'message' ? entry.message.reasoning?.text : undefined,
    ),
    ['thought a', 'thought b', undefined, 'silent thought', undefined],
  );
  const bounded = normalizeTimelineEntries({
    messages: [
      { content: '', id: 9, reasoning: 'x'.repeat(70_000), role: 'assistant' },
    ],
  });
  const first = bounded[0];
  assert.ok(first?.type === 'message');
  assert.equal(first.message.reasoning?.truncated, true);
  assert.equal(first.message.reasoning?.text.length, 64_000);
});

test('v0.20.5 prompts: batch clarify, multi-select, approval ids, replay, and noise', () => {
  const translator = new GatewayTurnTranslator({
    messageId: 'assistant-v0205',
    sessionId: 'stored-v0205',
    turnId: 'turn-v0205',
  });
  translator.start();

  // approval.request now carries the gateway's request_id, which becomes the
  // prompt id so approval.respond can target exactly that request.
  const approval = translator.translate({
    payload: {
      allow_permanent: true,
      command: 'rm -rf build',
      request_id: '1f3a9c0e5b7d4a2c8e6f0b1d2c3a4e5f',
    },
    type: 'approval.request',
  });
  assert.equal(approval[0].type, 'prompt.request');
  assert.equal(approval[0].promptId, '1f3a9c0e5b7d4a2c8e6f0b1d2c3a4e5f');
  assert.equal(isLocalPromptId(approval[0].promptId), false);
  // Without one, the id stays Wave-minted and recognizably local.
  const legacy = new GatewayTurnTranslator({
    messageId: 'assistant-legacy',
    sessionId: 'stored-legacy',
    turnId: 'turn-legacy',
  });
  legacy.start();
  const legacyApproval = legacy.translate({
    payload: { command: 'ls' },
    type: 'approval.request',
  });
  assert.equal(isLocalPromptId(legacyApproval[0].promptId), true);

  // The batch form: qid-keyed questions, per-question choices and
  // multi_select (honored only with choices), duplicates and unusable
  // entries dropped, and replayed `answers` attached by id.
  const batch = translator.translate({
    payload: {
      answers: { q1: 'already said yes', q9: 'unknown id ignored' },
      questions: [
        {
          choices: ['alpha', 'beta', ''],
          multi_select: true,
          qid: 'q0',
          question: 'Which flavors?',
        },
        { choices: [], multi_select: true, qid: 'q1', question: 'Proceed?' },
        { qid: 'q0', question: 'duplicate id' },
        { qid: '', question: 'no id' },
        { qid: 'q2', question: '' },
        'not an object',
      ],
      request_id: 'req-batch',
    },
    type: 'clarify.request',
  });
  assert.deepEqual(
    batch.map((event) => event.type),
    ['prompt.resolved', 'prompt.request'],
  );
  const prompt = batch[1];
  assert.equal(prompt.type, 'prompt.request');
  assert.equal(prompt.kind, 'clarify');
  assert.equal(prompt.promptId, 'req-batch');
  assert.equal(prompt.question, undefined);
  assert.deepEqual(prompt.choices, []);
  assert.deepEqual(prompt.questions, [
    {
      choices: ['alpha', 'beta'],
      multiSelect: true,
      question: 'Which flavors?',
      questionId: 'q0',
    },
    {
      answer: 'already said yes',
      choices: [],
      multiSelect: false,
      question: 'Proceed?',
      questionId: 'q1',
    },
  ]);

  // A single question keeps the v0.20.1 shape plus the multi_select hint.
  const multi = translator.translate({
    payload: {
      choices: ['alpha', 'beta'],
      multi_select: true,
      question: 'Which?',
      request_id: 'req-multi',
    },
    type: 'clarify.request',
  });
  assert.equal(multi[1].type, 'prompt.request');
  assert.equal(multi[1].multiSelect, true);
  assert.equal(multi[1].questions, undefined);
  // A bare multi_select flag without choices stays single-select.
  const bare = translator.translate({
    payload: { multi_select: true, question: 'Free?', request_id: 'req-bare' },
    type: 'clarify.request',
  });
  assert.equal(bare[1].multiSelect, undefined);
  // A batch with no usable question degrades to an answerable (skippable)
  // single prompt rather than parking the turn for its full timeout.
  const degraded = translator.translate({
    payload: { questions: [{ qid: 'x' }], request_id: 'req-empty' },
    type: 'clarify.request',
  });
  assert.equal(degraded[1].type, 'prompt.request');
  assert.equal(degraded[1].questions, undefined);
  assert.equal(degraded[1].question, undefined);

  // Mid-turn usage ticks and loop narration: the former has no transcript
  // projection, the latter is a reviewed activity label.
  assert.deepEqual(
    translator.translate({
      payload: { usage: { calls: 3, input: 10, output: 4, total: 14 } },
      type: 'session.usage',
    }),
    [],
  );
  assert.deepEqual(
    translator.translate({
      payload: { phase: 'history', status: 'loading' },
      type: 'session.resume_progress',
    }),
    [],
  );
  const loop = translator.translate({
    payload: { kind: 'loop', text: '↻ /loop wakeup #2 firing…' },
    type: 'status.update',
  });
  assert.equal(loop[0].type, 'activity.status');
  assert.equal(loop[0].status, 'loop-running');

  // A resume payload replays the prompt the turn is still blocked on.
  const replay = new GatewayTurnTranslator({
    messageId: 'assistant-replay',
    sessionId: 'stored-replay',
    turnId: 'turn-replay',
  });
  replay.start();
  const replayed = replay.replayPendingPrompts({
    pending_clarify: {
      answers: { q0: 'alpha' },
      questions: [
        { choices: ['alpha', 'beta'], qid: 'q0', question: 'Which?' },
        { choices: [], qid: 'q1', question: 'Why?' },
      ],
      request_id: 'req-replayed',
    },
    running: true,
  });
  assert.equal(replayed.length, 1);
  assert.equal(replayed[0].type, 'prompt.request');
  assert.equal(replayed[0].promptId, 'req-replayed');
  assert.equal(replayed[0].questions?.[0]?.answer, 'alpha');
  assert.equal(replayed[0].questions?.[1]?.answer, undefined);
  // Answering it proves the wait ended exactly like a live prompt.
  assert.deepEqual(
    replay
      .translate({ payload: { text: 'ok' }, type: 'message.delta' })
      .map((event) => event.type),
    ['prompt.resolved', 'assistant.started', 'assistant.delta'],
  );
  assert.deepEqual(
    replay.replayPendingPrompts({
      pending_approval: { command: 'rm x', request_id: 'req-a' },
    })[0].kind,
    'approval',
  );
  assert.deepEqual(replay.replayPendingPrompts({ running: true }), []);
  assert.deepEqual(
    replay.replayPendingPrompts({ pending_clarify: { question: 'no id' } }),
    [],
  );
});

test('prompt responses carry gateway approval ids and lock batch answers in order', async () => {
  const { client } = makeTurnFixtureClient({});
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
    choice: 'once',
    kind: 'approval',
    promptId: '1f3a9c0e5b7d4a2c8e6f0b1d2c3a4e5f',
  });
  await client.respondToPrompt('stored-1', {
    choice: 'deny',
    kind: 'approval',
    promptId: 'wave-approval-turn-1-3',
  });
  await client.respondToPrompt('stored-1', {
    answers: [
      { answer: '["alpha","beta"]', questionId: 'q0' },
      { answer: '', questionId: 'q1' },
    ],
    kind: 'clarify-batch',
    promptId: 'req-batch',
  });
  // An empty single answer is the gateway's skip.
  await client.respondToPrompt('stored-1', {
    answer: '',
    kind: 'clarify',
    promptId: 'req-skip',
  });
  assert.deepEqual(recorded, [
    {
      method: 'approval.respond',
      params: {
        choice: 'once',
        request_id: '1f3a9c0e5b7d4a2c8e6f0b1d2c3a4e5f',
        session_id: 'live-1',
      },
    },
    {
      method: 'approval.respond',
      params: { choice: 'deny', session_id: 'live-1' },
    },
    {
      method: 'clarify.respond',
      params: {
        answer: '["alpha","beta"]',
        question_id: 'q0',
        request_id: 'req-batch',
        session_id: 'live-1',
      },
    },
    {
      method: 'clarify.respond',
      params: {
        answer: '',
        question_id: 'q1',
        request_id: 'req-batch',
        session_id: 'live-1',
      },
    },
    {
      method: 'clarify.respond',
      params: { answer: '', request_id: 'req-skip', session_id: 'live-1' },
    },
  ]);
});

function makeResumeFixtureClient(
  resumeResult: Record<string, unknown>,
  eventsSinceResult?: Record<string, unknown>,
) {
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  let closed = 0;
  class FakeResumeSocket {
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
      if (frame.method === 'session.events.since') {
        if (eventsSinceResult === undefined) {
          reply({ error: { code: -32601, message: 'method not found' } });
          return;
        }
        reply({ result: eventsSinceResult });
        return;
      }
      if (frame.method === 'session.resume') {
        reply({ result: resumeResult });
        if (resumeResult.running === true) {
          // The rest of the turn streams on this rebound socket.
          emit('message.delta', { text: ' and done.' });
          emit('message.complete', { text: 'Partial reply and done.' });
        }
        return;
      }
      reply({ result: {} });
    }
    close(): void {
      closed += 1;
    }
  }
  const fetchImpl = (async (url: string | URL) => {
    if (String(url).endsWith('/api/auth/ws-ticket')) {
      return jsonResponse({ ticket: 't-resume' });
    }
    throw new Error(`unexpected request: ${String(url)}`);
  }) as unknown as typeof globalThis.fetch;
  const client = new GatewayClient({
    baseUrl: 'http://localhost:9119',
    fetch: fetchImpl,
    socketFactory: () => new FakeResumeSocket() as unknown as WebSocket,
    tokens: { accessToken: 'a', provider: 'basic', refreshToken: 'r' },
  });
  return { calls, client, closedCount: () => closed };
}

test('reattaching streams the rest of a running turn and replays its pending prompt', async () => {
  const { calls, client, closedCount } = makeResumeFixtureClient({
    inflight: { assistant: 'Partial reply', streaming: true, user: 'go' },
    pending_clarify: {
      choices: ['alpha', 'beta'],
      question: 'Which?',
      request_id: 'req-pending',
    },
    running: true,
    session_id: 'live-9',
  });
  const events: WaveTurnEventSummary[] = [];
  let promptChannelWhileWaiting: string[] = [];
  for await (const event of client.resumeTurnStream(
    'stored-9',
    'gw-turn-1',
    -1,
  )) {
    events.push({
      ...(event.type === 'assistant.delta' ? { delta: event.delta } : {}),
      ...(event.type === 'prompt.request' || event.type === 'prompt.resolved'
        ? { promptId: event.promptId }
        : {}),
      ...(event.type === 'assistant.completed'
        ? { content: event.content }
        : {}),
      type: event.type,
    });
    if (event.type === 'prompt.request') {
      // The prompt channel is open while the replayed prompt is showing, so
      // the answer rides the resume socket — exactly like a live prompt.
      promptChannelWhileWaiting = [
        ...(
          client as unknown as { activeTurns: Map<string, unknown> }
        ).activeTurns.keys(),
      ];
    }
  }
  assert.deepEqual(
    calls.map((call) => call.method),
    ['session.resume'],
  );
  assert.deepEqual(calls[0].params, {
    omit_messages: true,
    session_id: 'stored-9',
    source: 'wave',
  });
  assert.deepEqual(events, [
    { type: 'turn.started' },
    { type: 'assistant.started' },
    // The snapshot streamed before the disconnect, then the live tail.
    { delta: 'Partial reply', type: 'assistant.delta' },
    { promptId: 'req-pending', type: 'prompt.request' },
    { promptId: 'req-pending', type: 'prompt.resolved' },
    { delta: ' and done.', type: 'assistant.delta' },
    { content: 'Partial reply and done.', type: 'assistant.completed' },
    { type: 'turn.completed' },
  ]);
  assert.deepEqual(promptChannelWhileWaiting, ['stored-9']);
  // The channel closes with the turn.
  assert.equal(
    (client as unknown as { activeTurns: Map<string, unknown> }).activeTurns
      .size,
    0,
  );
  assert.equal(closedCount(), 1);

  // An idle session yields nothing and never re-sends the prompt.
  const idle = makeResumeFixtureClient({
    running: false,
    session_id: 'live-9',
  });
  const idleEvents: string[] = [];
  for await (const event of idle.client.resumeTurnStream(
    'stored-9',
    'gw-turn-1',
    -1,
  )) {
    idleEvents.push(event.type);
  }
  assert.deepEqual(idleEvents, []);
  assert.deepEqual(
    idle.calls.map((call) => call.method),
    ['session.resume'],
  );
});

interface WaveTurnEventSummary {
  content?: string;
  delta?: string;
  promptId?: string;
  type: string;
}

test('v0.20.5 regenerate refusals map to honest, non-retryable input errors', async () => {
  const compressedAway = makeTurnFixtureClient({
    submitResult: {
      code: 4018,
      data: {
        ordinal: 3,
        prefix_user_count: 5,
        segment_ordinal: -2,
        user_turn_count: 4,
      },
      message: 'target user message is no longer in session history',
    } as { code: number; message: string },
  });
  (
    compressedAway.client as unknown as {
      latestMessageOrderSupport: 'supported';
    }
  ).latestMessageOrderSupport = 'supported';
  await assert.rejects(
    (async () => {
      for await (const _event of compressedAway.client.streamTurn(
        'stored-1',
        'Replay',
        undefined,
        { truncateBeforeRowId: 7, truncateBeforeUserOrdinal: 3 },
      )) {
        // Drain until the refusal surfaces.
      }
    })(),
    (error: unknown) => {
      assert.ok(error instanceof WaveBackendError);
      assert.equal(error.kind, 'bad_request');
      assert.equal(error.retryable, false);
      assert.match(error.message, /summarized out of this conversation/);
      return true;
    },
  );

  // A plain stale target keeps the gateway's own reason.
  const stale = makeTurnFixtureClient({
    submitResult: {
      code: 4018,
      data: {
        ordinal: 3,
        prefix_user_count: 0,
        segment_ordinal: 3,
        user_turn_count: 2,
      },
      message: 'target user message is no longer in session history',
    } as { code: number; message: string },
  });
  await assert.rejects(
    (async () => {
      for await (const _event of stale.client.streamTurn(
        'stored-1',
        'Replay',
        undefined,
        {
          truncateBeforeUserOrdinal: 3,
        },
      )) {
        // Drain.
      }
    })(),
    /no longer in session history/,
  );

  // The ordinal-only refusal for durable history (4004) is an input error
  // with Wave-owned copy, never a retryable transport failure.
  const ordinalOnly = makeTurnFixtureClient({
    submitResult: {
      code: 4004,
      message:
        'ordinal-only truncation is unsafe for durable session history; include truncate_before_row_id',
    },
  });
  await assert.rejects(
    (async () => {
      for await (const _event of ordinalOnly.client.streamTurn(
        'stored-1',
        'Replay',
        undefined,
        {
          truncateBeforeUserOrdinal: 1,
        },
      )) {
        // Drain.
      }
    })(),
    (error: unknown) => {
      assert.ok(error instanceof WaveBackendError);
      assert.equal(error.kind, 'bad_request');
      assert.match(error.message, /Refresh the conversation/);
      return true;
    },
  );

  // Structured error data is preserved on the RPC error itself.
  const rpcError = new GatewayRpcError('x', 4018, { segment_ordinal: -1 });
  assert.deepEqual(rpcError.data, { segment_ordinal: -1 });
});

test('marks a conversation read or unread with one non-retrying PATCH', async () => {
  const requests: { body?: string; method: string; path: string }[] = [];
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    requests.push({
      body: typeof init?.body === 'string' ? init.body : undefined,
      method: init?.method ?? 'GET',
      path: new URL(String(url)).pathname,
    });
    return jsonResponse({ ok: true, title: '', unread: false });
  }) as unknown as typeof globalThis.fetch;
  const client = new GatewayClient({
    baseUrl: 'http://localhost:9119',
    fetch: fetchImpl,
    socketFactory: () => {
      throw new Error('no socket needed');
    },
    tokens: { accessToken: 'a', provider: 'basic', refreshToken: 'r' },
  });
  const result = await client.setSessionUnread('session-1', false);
  assert.deepEqual(result.session, { id: 'session-1', unread: false });
  await client.setSessionUnread('session-1', true);
  assert.deepEqual(requests, [
    {
      body: '{"unread":false}',
      method: 'PATCH',
      path: '/api/sessions/session-1',
    },
    {
      body: '{"unread":true}',
      method: 'PATCH',
      path: '/api/sessions/session-1',
    },
  ]);
  await assert.rejects(
    client.setSessionUnread('wave-pending-1', false),
    /Send a message before marking/,
  );
  assert.equal(requests.length, 2);
});

test('session rows carry the server read state and hidden rows never render', () => {
  const rows = normalizeSessionRows({
    sessions: [
      { id: 'read', unread: false },
      { id: 'unread', unread: true },
      { id: 'legacy' },
      { id: 'truthy-string', unread: 'yes' },
    ],
  });
  assert.deepEqual(
    rows.map((row) => [row.id, row.unread]),
    [
      ['read', false],
      ['unread', true],
      ['legacy', false],
      ['truthy-string', false],
    ],
  );
  // display_kind: 'hidden' user rows are off-screen scaffolding the gateway
  // persists for widget intents; no client renders them as a bubble.
  assert.equal(
    normalizeMessageRow({
      content: 'Summarize the selected widget',
      display_kind: 'hidden',
      id: 4,
      role: 'user',
    }),
    undefined,
  );
  assert.equal(
    normalizeMessageRow({
      content: 'visible',
      display_kind: 'model_switch',
      id: 5,
      role: 'user',
    })?.ordinalExempt,
    true,
  );
  const entries = normalizeTimelineEntries(
    {
      messages: [
        { content: 'shown', id: 1, role: 'user' },
        { content: 'hidden send', display_kind: 'hidden', id: 2, role: 'user' },
        { content: 'reply', id: 3, role: 'assistant' },
      ],
    },
    0,
  );
  assert.deepEqual(
    entries.map((entry) =>
      entry.type === 'message' ? entry.message.content : '',
    ),
    ['shown', 'reply'],
  );
});

test('a failed turn seals as an error, not as an assistant reply', () => {
  // Hermes reports a returned-error turn on a terminal message.complete
  // carrying status:"error" — not on turn.error. Without that branch the turn
  // sealed as a healthy reply whose body was the literal string "Error: …".
  const translator = new GatewayTurnTranslator({
    messageId: 'assistant-e',
    sessionId: 'session-1',
    turnId: 'turn-e',
  });
  translator.start();
  const events = translator.translate({
    payload: {
      error: 'provider refused the request',
      error_surface: {
        code: 'context_length',
        layer: 'provider',
        retryable: false,
      },
      recoverable: true,
      status: 'error',
      text: 'Error: provider refused the request',
    },
    type: 'message.complete',
  });
  // No partial flag, so `text` is the error restated as prose: it must not
  // become a transcript bubble.
  assert.deepEqual(
    events.map((event) => event.type),
    ['turn.error'],
  );
  const failure = events[0] as Extract<WaveTurnEvent, { type: 'turn.error' }>;
  assert.equal(failure.error.message, 'provider refused the request');
  assert.equal(failure.error.retryable, false);
  assert.deepEqual(failure.surface, {
    code: 'context_length',
    layer: 'provider',
    retryable: false,
  });
});

test('a failed turn keeps the text it did generate', () => {
  const translator = new GatewayTurnTranslator({
    messageId: 'assistant-p',
    sessionId: 'session-1',
    turnId: 'turn-p',
  });
  translator.start();
  const events = translator.translate({
    payload: {
      error: 'stream dropped',
      error_surface: { layer: 'streaming' },
      partial: true,
      status: 'error',
      text: 'Half an answ',
    },
    type: 'message.complete',
  });
  const completed = events.find(
    (event) => event.type === 'assistant.completed',
  );
  assert.equal(
    completed && 'content' in completed ? completed.content : undefined,
    'Half an answ',
  );
  assert.equal(events.at(-1)?.type, 'turn.error');
});

test('an unrecognised error layer degrades to no surface at all', () => {
  const translator = new GatewayTurnTranslator({
    messageId: 'assistant-u',
    sessionId: 'session-1',
    turnId: 'turn-u',
  });
  translator.start();
  const events = translator.translate({
    payload: {
      error: 'something',
      // A layer Wave does not own must never reach the UI.
      error_surface: { layer: 'quantum', retryable: true },
      status: 'error',
    },
    type: 'message.complete',
  });
  const failure = events.at(-1) as Extract<
    WaveTurnEvent,
    { type: 'turn.error' }
  >;
  assert.equal(failure.surface, undefined);
  // With no trustworthy surface, `recoverable` still decides retryability.
  assert.equal(failure.error.retryable, true);
});

test('todo snapshots are bounded, validated, and never partial', () => {
  const translator = new GatewayTurnTranslator({
    messageId: 'assistant-t',
    sessionId: 'session-1',
    turnId: 'turn-t',
  });
  translator.start();
  const events = translator.translate({
    payload: {
      revision: 3,
      todos: [
        { content: 'Read the file', id: '1', status: 'completed' },
        { content: 'Fix the bug', id: '2', status: 'in_progress' },
        // Dropped: unknown status, empty content, missing id.
        { content: 'Ship it', id: '3', status: 'teleported' },
        { content: '   ', id: '4', status: 'pending' },
        { content: 'No id', status: 'pending' },
      ],
    },
    type: 'todo.updated',
  });
  assert.equal(events.length, 1);
  const snapshot = events[0] as Extract<
    WaveTurnEvent,
    { type: 'todo.snapshot' }
  >;
  assert.equal(snapshot.revision, 3);
  assert.deepEqual(snapshot.todos, [
    { content: 'Read the file', id: '1', status: 'completed' },
    { content: 'Fix the bug', id: '2', status: 'in_progress' },
  ]);
  // The unused-store snapshot carries no meaning and must not establish a
  // revision that would then reject real ones.
  assert.deepEqual(
    translator.translate({
      payload: { revision: 0, todos: [] },
      type: 'todo.updated',
    }),
    [],
  );
  // A real clear does.
  assert.equal(
    translator.translate({
      payload: { revision: 4, todos: [] },
      type: 'todo.updated',
    }).length,
    1,
  );
});

test('the heartbeat pings only when the gateway advertises it', async () => {
  const sent: string[] = [];
  let dead: Error | undefined;
  const rpc = new GatewayRpc({
    heartbeatDeadlineMs: 60,
    heartbeatIntervalMs: 20,
    onEvent: () => undefined,
    onHeartbeatTimeout: (error) => {
      dead = error;
    },
    socket: { close: () => undefined, send: (data) => sent.push(data) },
  });

  // Nothing is sent until the gateway says it answers gateway.ping: an older
  // gateway would reject every one of them.
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(sent.length, 0);

  rpc.startHeartbeat();
  await new Promise((resolve) => setTimeout(resolve, 50));
  const pings = sent.map(
    (frame) => JSON.parse(frame) as { id: unknown; method: string },
  );
  assert.ok(pings.length >= 1);
  assert.ok(pings.every((ping) => ping.method === 'gateway.ping'));
  // String ids: handleMessage only settles numeric ones, so a pong can never
  // resolve a caller's pending request.
  assert.ok(pings.every((ping) => typeof ping.id === 'string'));
  assert.equal(dead, undefined);
  rpc.stopHeartbeat();
});

test('inbound silence past the deadline reports the socket dead once', async () => {
  const sent: string[] = [];
  const deaths: Error[] = [];
  const rpc = new GatewayRpc({
    heartbeatDeadlineMs: 40,
    heartbeatIntervalMs: 10,
    onEvent: () => undefined,
    onHeartbeatTimeout: (error) => deaths.push(error),
    socket: { close: () => undefined, send: (data) => sent.push(data) },
  });
  rpc.startHeartbeat();
  await new Promise((resolve) => setTimeout(resolve, 90));
  assert.equal(deaths.length, 1);
  assert.match(deaths[0].message, /heartbeat/i);
  rpc.stopHeartbeat();
});

test('any inbound frame re-arms the heartbeat deadline', async () => {
  const deaths: Error[] = [];
  const rpc = new GatewayRpc({
    heartbeatDeadlineMs: 60,
    heartbeatIntervalMs: 10,
    onEvent: () => undefined,
    onHeartbeatTimeout: (error) => deaths.push(error),
    socket: { close: () => undefined, send: () => undefined },
  });
  rpc.startHeartbeat();
  for (let tick = 0; tick < 5; tick += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    // Even a frame we discard proves the socket is alive.
    rpc.handleMessage('not json');
  }
  assert.deepEqual(deaths, []);
  rpc.stopHeartbeat();
});

test('event frames carry their session id and sequence when stamped', () => {
  const events: {
    payload: Record<string, unknown>;
    seq?: number;
    sessionId?: string;
    type: string;
  }[] = [];
  const rpc = new GatewayRpc({
    onEvent: (event) => events.push(event),
    socket: { close: () => undefined, send: () => undefined },
  });
  rpc.handleMessage(
    JSON.stringify({
      jsonrpc: '2.0',
      method: 'event',
      params: {
        payload: { text: 'hi' },
        seq: 7,
        session_id: 'live-1',
        type: 'message.delta',
      },
    }),
  );
  // An older gateway stamps neither; both stay absent rather than defaulted.
  rpc.handleMessage(
    JSON.stringify({
      jsonrpc: '2.0',
      method: 'event',
      params: { payload: {}, type: 'message.delta' },
    }),
  );
  assert.equal(events[0].seq, 7);
  assert.equal(events[0].sessionId, 'live-1');
  assert.equal(events[1].seq, undefined);
  assert.equal(events[1].sessionId, undefined);
});

test('a compacted row renders its display projection, not its scaffolding', () => {
  // v0.21 projects context-compaction rows: the physical `content` keeps the
  // model-facing wrapper for export, and `display_content` is what a person
  // should read. Preferring the wrapper renders Hermes's own compaction
  // scaffolding as if the user had typed it.
  assert.equal(
    normalizeMessageRow({
      content: '<compaction-summary>internal wrapper</compaction-summary>',
      display_content: 'Earlier conversation summarized.',
      id: 11,
      role: 'user',
    })?.content,
    'Earlier conversation summarized.',
  );
  // Rows the gateway could not project arrive hidden and still never render.
  assert.equal(
    normalizeMessageRow({
      content: '<compaction-summary>internal</compaction-summary>',
      display_kind: 'hidden',
      id: 12,
      role: 'user',
    }),
    undefined,
  );
  // A non-string projection is ignored rather than coerced.
  assert.equal(
    normalizeMessageRow({
      content: 'physical',
      display_content: { not: 'a string' },
      id: 13,
      role: 'user',
    })?.content,
    'physical',
  );
});

test('a reattach replays the durable records it missed', async () => {
  const { calls, client } = makeResumeFixtureClient(
    {
      inflight: { assistant: 'Partial reply', streaming: true, user: 'go' },
      running: true,
      session_id: 'live-9',
    },
    {
      epoch: 'epoch-1',
      events: [
        // Durable records the resume snapshot has never carried.
        {
          payload: { name: 'terminal', tool_id: 't-missed' },
          seq: 12,
          type: 'tool.start',
        },
        {
          payload: {
            revision: 2,
            todos: [{ content: 'Do it', id: '1', status: 'in_progress' }],
          },
          seq: 13,
          type: 'todo.updated',
        },
        // Never replayed: the snapshot is authoritative for assistant text,
        // and a stale terminal frame would seal a turn that is still running.
        { payload: { text: 'ghost text' }, seq: 14, type: 'message.delta' },
        { payload: { text: 'ghost' }, seq: 15, type: 'message.complete' },
        // Prompt frames belong to replayPendingPrompts, not here.
        {
          payload: { question: 'stale?', request_id: 'req-old' },
          seq: 16,
          type: 'clarify.request',
        },
      ],
      latest_seq: 16,
      truncated: false,
    },
  );
  (client as unknown as { replayEpoch: string }).replayEpoch = 'epoch-1';
  (
    client as unknown as { eventWatermarks: Map<string, number> }
  ).eventWatermarks.set('live-9', 11);

  const events: string[] = [];
  for await (const event of client.resumeTurnStream(
    'stored-9',
    'gw-turn-1',
    -1,
  )) {
    events.push(event.type);
  }
  const replay = calls.find((call) => call.method === 'session.events.since');
  assert.deepEqual(replay?.params, { last_seen: 11, session_id: 'live-9' });
  assert.ok(events.includes('tool.status'), 'the missed tool row is restored');
  assert.ok(
    events.includes('todo.snapshot'),
    'the missed task list is restored',
  );
  // Exactly one assistant.delta: the snapshot's, never the replayed ghost.
  assert.equal(events.filter((type) => type === 'assistant.delta').length, 2);
  assert.ok(!events.includes('prompt.request'), 'no resurrected prompt');
});

test('a gateway restart during the gap discards the stale watermarks', async () => {
  const { calls, client } = makeResumeFixtureClient(
    {
      inflight: { assistant: 'Partial', streaming: true, user: 'go' },
      running: true,
      session_id: 'live-9',
    },
    {
      // A different epoch: the gateway restarted, its seq counters reset, and
      // this window describes numbering that no longer exists.
      epoch: 'epoch-2',
      events: [
        {
          payload: { name: 'terminal', tool_id: 't-x' },
          seq: 1,
          type: 'tool.start',
        },
      ],
      truncated: false,
    },
  );
  (client as unknown as { replayEpoch: string }).replayEpoch = 'epoch-1';
  (
    client as unknown as { eventWatermarks: Map<string, number> }
  ).eventWatermarks.set('live-9', 99);

  const events: string[] = [];
  for await (const event of client.resumeTurnStream(
    'stored-9',
    'gw-turn-1',
    -1,
  )) {
    events.push(event.type);
  }
  assert.ok(calls.some((call) => call.method === 'session.events.since'));
  assert.ok(!events.includes('tool.status'), 'nothing from the old numbering');
  assert.deepEqual(
    [
      ...(client as unknown as { eventWatermarks: Map<string, number> })
        .eventWatermarks,
    ],
    [],
    'the stale watermarks are dropped',
  );
});

test('an older gateway without replay reattaches exactly as before', async () => {
  const { calls, client } = makeResumeFixtureClient({
    inflight: { assistant: 'Partial reply', streaming: true, user: 'go' },
    running: true,
    session_id: 'live-9',
  });
  (
    client as unknown as { eventWatermarks: Map<string, number> }
  ).eventWatermarks.set('live-9', 5);
  const events: string[] = [];
  for await (const event of client.resumeTurnStream(
    'stored-9',
    'gw-turn-1',
    -1,
  )) {
    events.push(event.type);
  }
  // The method is attempted and refused; the reattach proceeds regardless.
  assert.ok(calls.some((call) => call.method === 'session.events.since'));
  assert.deepEqual(events.at(-1), 'turn.completed');
});

test('a turn that failed while detached rebuilds as a failed turn', async () => {
  // Its terminal frame died with the socket, so the resume snapshot is the
  // only carrier. Yielding nothing here left the composer latched on Stop.
  const { client } = makeResumeFixtureClient({
    inflight: {
      assistant: 'Half an answ',
      error: 'provider refused the request',
      error_surface: { layer: 'provider', retryable: false },
      recoverable: true,
      streaming: true,
      user: 'go',
    },
    running: false,
    session_id: 'live-9',
  });
  const events: WaveTurnEvent[] = [];
  for await (const event of client.resumeTurnStream(
    'stored-9',
    'gw-turn-1',
    -1,
  )) {
    events.push(event);
  }
  assert.deepEqual(
    events.map((event) => event.type),
    ['turn.started', 'assistant.started', 'assistant.completed', 'turn.error'],
  );
  const failure = events.at(-1) as Extract<
    WaveTurnEvent,
    { type: 'turn.error' }
  >;
  assert.equal(failure.error.message, 'provider refused the request');
  assert.deepEqual(failure.surface, { layer: 'provider', retryable: false });
});
