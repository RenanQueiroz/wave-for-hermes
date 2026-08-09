import assert from 'node:assert/strict';
import test from 'node:test';

import { createGatewayAskHermesExecutor } from '../../src/features/realtime/gateway-ask-hermes-executor.ts';
import { createGatewayCorrectHermesExecutor } from '../../src/features/realtime/gateway-correct-hermes-executor.ts';
import type { GatewayClient } from '../../src/services/gateway/gateway-client.ts';
import { WaveBackendError } from '../../src/services/wave/wave-backend-error.ts';

test('ask execution advertises active only after the gateway stream is registered', async () => {
  const lifecycle: boolean[] = [];
  const client = {
    async *streamTurn() {
      assert.deepEqual(lifecycle, [], 'not active before the first live event');
      yield { type: 'turn.started' };
      assert.deepEqual(lifecycle, [true]);
      yield { content: 'Finished safely.', type: 'assistant.completed' };
      yield { type: 'turn.completed' };
    },
  } as unknown as GatewayClient;
  const execute = createGatewayAskHermesExecutor({
    client,
    sessionId: 'trusted-session',
  });
  const result = await execute('do work', new AbortController().signal, {
    activate: () => lifecycle.push(true),
    deactivate: () => lifecycle.push(false),
  });
  assert.deepEqual(result, {
    answer: 'Finished safely.',
    ok: true,
    truncated: false,
  });
  assert.deepEqual(lifecycle, [true, false]);
});

test('a consumed queued follow-on keeps streaming and joins the combined answer', async () => {
  const client = {
    async *streamTurn(
      _sessionId: string,
      _input: unknown,
      _signal: AbortSignal | undefined,
      options: { followOn?: () => boolean },
    ) {
      yield { type: 'turn.started' };
      yield { content: 'First outcome.', type: 'assistant.completed' };
      yield { type: 'turn.completed' };
      // The real client consults followOn after each completed turn and
      // keeps translating the drained follow-on turn on the same socket.
      if (options.followOn?.()) {
        yield { type: 'turn.started' };
        yield { content: 'Follow-on outcome.', type: 'assistant.completed' };
        yield { type: 'turn.completed' };
      }
    },
  } as unknown as GatewayClient;
  const execute = createGatewayAskHermesExecutor({
    client,
    sessionId: 'trusted-session',
  });
  let followOns = 1;
  const result = await execute('do work', new AbortController().signal, {
    activate: () => undefined,
    consumeQueuedFollowOn: () => followOns-- > 0,
    deactivate: () => undefined,
  });
  assert.deepEqual(result, {
    answer: 'First outcome.\n\nFollow-on outcome.',
    ok: true,
    truncated: false,
  });
});

test('sealed interim narration reaches lifecycle.progress; nothing else does', async () => {
  const progress: string[] = [];
  const client = {
    async *streamTurn() {
      yield { type: 'turn.started' };
      yield { content: 'Checked the sensors.', type: 'assistant.interim' };
      yield { delta: 'streaming ', type: 'assistant.delta' };
      yield { delta: 'private', type: 'reasoning.delta' };
      yield { status: 'started', toolName: 'search', type: 'tool.status' };
      yield { content: 'Locked the door.', type: 'assistant.interim' };
      yield { content: 'All done.', type: 'assistant.completed' };
      yield { type: 'turn.completed' };
    },
  } as unknown as GatewayClient;
  const execute = createGatewayAskHermesExecutor({
    client,
    sessionId: 'trusted-session',
  });
  const result = await execute('do work', new AbortController().signal, {
    activate: () => undefined,
    deactivate: () => undefined,
    progress: (text) => progress.push(text),
  });
  assert.deepEqual(progress, ['Checked the sensors.', 'Locked the door.']);
  assert.deepEqual(result, { answer: 'All done.', ok: true, truncated: false });
});

test('correction executor maps only bounded redirect outcomes without retry', async () => {
  let calls = 0;
  const client = {
    redirectTurn: async (sessionId: string, instruction: string) => {
      calls += 1;
      assert.equal(sessionId, 'trusted-session');
      assert.equal(instruction, 'use SQLite instead');
      return {
        apiVersion: 'v1',
        sessionId,
        status: 'queued',
      } as const;
    },
  } as unknown as GatewayClient;
  const execute = createGatewayCorrectHermesExecutor({
    client,
    sessionId: 'trusted-session',
  });
  assert.deepEqual(
    await execute('use SQLite instead', new AbortController().signal),
    { ok: true, status: 'queued' },
  );
  assert.equal(calls, 1);
});

test('correction races become nothing_active and other failures stay private', async () => {
  let attempts = 0;
  let error: unknown = new WaveBackendError(
    'That response is no longer accepting corrections.',
    { kind: 'conflict' },
  );
  const client = {
    redirectTurn: async () => {
      attempts += 1;
      throw error;
    },
  } as unknown as GatewayClient;
  const execute = createGatewayCorrectHermesExecutor({
    client,
    sessionId: 'trusted-session',
  });
  const signal = new AbortController().signal;
  assert.equal((await execute('change it', signal)).status, 'nothing_active');
  error = new Error('secret gateway payload');
  const rejected = await execute('change it', signal);
  assert.equal(rejected.status, 'rejected');
  assert.doesNotMatch(JSON.stringify(rejected), /secret gateway payload/);
  assert.equal(attempts, 2, 'each requested correction is attempted once');

  const aborted = new AbortController();
  aborted.abort();
  assert.equal(
    (await execute('change it', aborted.signal)).status,
    'nothing_active',
  );
  assert.equal(attempts, 2, 'an aborted correction is not dispatched');
});
