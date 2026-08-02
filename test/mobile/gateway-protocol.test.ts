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
import { GatewayTurnTranslator } from '../../src/services/gateway/gateway-turn-events.ts';
import {
  isCompleteTokenSet,
  mergeRotatedTokens,
  parseGatewaySetCookies,
  toCookieHeader,
} from '../../src/services/gateway/gateway-tokens.ts';

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
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'message.delta');

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
