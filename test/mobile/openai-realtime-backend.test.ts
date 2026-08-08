import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  createOpenAiRealtimeSessionConfig,
  OpenAiRealtimeBackend,
} from '../../src/services/realtime/openai-realtime-backend.ts';
import { createDevicePreferenceStores } from '../../src/state/device-preferences.ts';
import {
  buildWaveRealtimeInstructions,
  createAskHermesToolDefinition,
  createCorrectHermesToolDefinition,
  createRealtimeToolDefinitions,
  createRealtimeToolSurfaceSessionUpdate,
} from '../../src/services/realtime/realtime-prompt.ts';

const UNUSED_RESULT = { answer: '', ok: true, truncated: false } as const;
const UNUSED_CORRECTION = { ok: true, status: 'redirected' } as const;

type SocketListener = (event: { data?: unknown }) => void;

function fakeSocket() {
  const listeners = new Map<string, Set<SocketListener>>();
  const sent: string[] = [];
  const socket = {
    readyState: 1,
    addEventListener(type: string, listener: SocketListener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    close() {
      socket.readyState = 3;
      emit('close', {});
    },
    removeEventListener(type: string, listener: SocketListener) {
      listeners.get(type)?.delete(listener);
    },
    send(data: string) {
      sent.push(data);
    },
  };
  const emit = (type: string, event: { data?: unknown }) => {
    for (const listener of listeners.get(type) ?? []) listener(event);
  };
  return {
    sent,
    socket: socket as unknown as WebSocket,
    receive(payload: unknown) {
      emit('message', { data: JSON.stringify(payload) });
    },
  };
}

async function settled() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

test('idle and active prompt snapshots advertise exactly their tool surfaces', () => {
  const idlePrompt = buildWaveRealtimeInstructions('idle');
  const activePrompt = buildWaveRealtimeInstructions('active');
  assert.equal(
    createHash('sha256').update(idlePrompt).digest('hex'),
    '8e90f89b7a6388a1a887bae590facca2e24fa624ca04bc4594aad78b085237cc',
  );
  assert.equal(
    createHash('sha256').update(activePrompt).digest('hex'),
    '25b7b0da1a23fb4cbae0bf2d983d41e8cf5e494ff991f283a8c83712e7468527',
  );
  assert.match(idlePrompt, /ask_hermes/);
  assert.doesNotMatch(idlePrompt, /correct_hermes/);
  assert.match(activePrompt, /ask_hermes/);
  assert.match(activePrompt, /correct_hermes/);
  for (const untrusted of [
    'MALICIOUS_TOOL_DESCRIPTION',
    'mcp://attacker.invalid',
    'AGENT_CARD_INJECTION',
    'session.info secret payload',
  ]) {
    assert.doesNotMatch(
      `${idlePrompt}\n${activePrompt}`,
      new RegExp(untrusted.replaceAll('.', '\\.')),
    );
  }
  assert.match(
    idlePrompt,
    /user explicitly names a tool, skill, CLI, provider/,
  );
  assert.match(idlePrompt, /Otherwise, do not invent or prescribe one/);
  assert.match(idlePrompt, /silence, background noise, hold music/);
  assert.match(idlePrompt, /corrects themselves within one utterance/);
  assert.match(idlePrompt, /bare stop command ends live voice locally/);
  assert.match(activePrompt, /add-versus-replace intent is unclear/);
  assert.match(activePrompt, /approval or clarification/);
});

test('session config contains one strict generic ask_hermes tool and one model', () => {
  for (const model of ['gpt-realtime-2.1-mini', 'gpt-realtime-2.1'] as const) {
    const config = createOpenAiRealtimeSessionConfig(model, 'marin');
    const serialized = JSON.stringify(config);
    assert.equal(serialized.split(model).length - 1, 1);
    assert.equal(config.model, model);
    assert.deepEqual(config.reasoning, { effort: 'low' });
    assert.deepEqual(config.tools, createRealtimeToolDefinitions('idle'));
    assert.equal(config.tools[0].name, 'ask_hermes');
    assert.equal(config.tools[0].parameters.additionalProperties, false);
    assert.deepEqual(config.tools[0].parameters.required, ['instruction']);
  }
  const activeUpdate = createRealtimeToolSurfaceSessionUpdate('active');
  assert.deepEqual(activeUpdate.tools, [
    createAskHermesToolDefinition('active'),
    createCorrectHermesToolDefinition(),
  ]);
  assert.doesNotMatch(JSON.stringify(activeUpdate), /"model"|"voice"/);
  assert.throws(() =>
    createOpenAiRealtimeSessionConfig(
      'gpt-realtime-unknown' as 'gpt-realtime-2.1',
      'marin',
    ),
  );
});

test('backend snapshots the selected model even after preference changes', async () => {
  let stored = JSON.stringify({
    model: 'gpt-realtime-2.1-mini',
    version: 1,
  });
  const stores = createDevicePreferenceStores({
    getItemAsync: async () => stored,
    setItemAsync: async (_key, value) => {
      stored = value;
    },
  });
  const selectedAtConstruction = await stores.realtimeModel.read();
  let setupSession = '';
  const backend = new OpenAiRealtimeBackend({
    apiKey: 'unit-test-api-key',
    executeAskHermes: async () => UNUSED_RESULT,
    executeCorrectHermes: async () => UNUSED_CORRECTION,
    fetchImpl: async (_url, init) => {
      const form = init?.body as FormData;
      setupSession = String(form.get('session'));
      return new Response('provider body must stay private', { status: 400 });
    },
    model: selectedAtConstruction,
    socketFactory: () => {
      throw new Error('setup rejection must not open a sideband');
    },
  });
  await stores.realtimeModel.set('gpt-realtime-2.1');

  await assert.rejects(
    backend.startRealtimeCall('session-1', 'v=0\r\nwave-offer'),
    (error: unknown) => {
      assert.equal((error as { kind?: unknown }).kind, 'model_unavailable');
      assert.equal((error as { retryable?: unknown }).retryable, false);
      assert.equal(
        (error as Error).message,
        'OpenAI could not start Realtime with the selected model. Choose another model in Settings.',
      );
      assert.doesNotMatch(
        (error as Error).message,
        /provider body|unit-test-api-key|session-1|realtime\/calls/i,
      );
      return true;
    },
  );
  assert.equal(JSON.parse(setupSession).model, 'gpt-realtime-2.1-mini');
  assert.equal(await stores.realtimeModel.read(), 'gpt-realtime-2.1');
});

test('model-specific setup rejection is attempted once without fallback', async () => {
  let attempts = 0;
  const backend = new OpenAiRealtimeBackend({
    apiKey: 'unit-test-api-key',
    executeAskHermes: async () => UNUSED_RESULT,
    executeCorrectHermes: async () => UNUSED_CORRECTION,
    fetchImpl: async () => {
      attempts += 1;
      return new Response('sensitive upstream details', { status: 422 });
    },
    model: 'gpt-realtime-2.1',
  });
  await assert.rejects(
    backend.startRealtimeCall('session-1', 'v=0\r\nwave-offer'),
    /selected model/,
  );
  assert.equal(attempts, 1);
});

test('backend wires active execution to acknowledged correction availability', async () => {
  const sidebandSocket = fakeSocket();
  let finishAsk!: () => void;
  const corrected: string[] = [];
  const backend = new OpenAiRealtimeBackend({
    apiKey: 'unit-test-api-key',
    executeAskHermes: (_instruction, _signal, lifecycle) =>
      new Promise((resolve) => {
        lifecycle.activate();
        finishAsk = () =>
          resolve({ answer: 'finished', ok: true, truncated: false });
      }),
    executeCorrectHermes: async (instruction) => {
      corrected.push(instruction);
      return { ok: true, status: 'redirected' };
    },
    fetchImpl: async (url) =>
      String(url).endsWith('/hangup')
        ? new Response('', { status: 200 })
        : new Response('v=0\r\nwave-answer', {
            headers: { location: '/v1/realtime/calls/call-wiring' },
            status: 200,
          }),
    model: 'gpt-realtime-2.1-mini',
    socketFactory: () => sidebandSocket.socket,
  });
  await backend.startRealtimeCall('trusted-session', 'v=0\r\nwave-offer');

  sidebandSocket.receive({
    item: { id: 'user-ask', role: 'user' },
    type: 'conversation.item.added',
  });
  sidebandSocket.receive({
    response: { id: 'response-ask' },
    type: 'response.created',
  });
  sidebandSocket.receive({
    response: {
      id: 'response-ask',
      output: [
        {
          arguments: '{"instruction":"start the task"}',
          call_id: 'ask-call',
          name: 'ask_hermes',
          type: 'function_call',
        },
      ],
    },
    type: 'response.done',
  });
  await settled();
  const updates = () =>
    sidebandSocket.sent
      .map((entry) => JSON.parse(entry) as Record<string, unknown>)
      .filter((entry) => entry.type === 'session.update');
  assert.equal(updates().length, 1);
  assert.deepEqual(
    (updates()[0]!.session as { tools: { name: string }[] }).tools.map(
      ({ name }) => name,
    ),
    ['ask_hermes', 'correct_hermes'],
  );
  sidebandSocket.receive({
    session: createRealtimeToolSurfaceSessionUpdate('active'),
    type: 'session.updated',
  });

  sidebandSocket.receive({
    item: { id: 'user-correct', role: 'user' },
    type: 'conversation.item.added',
  });
  sidebandSocket.receive({
    response: { id: 'response-correct' },
    type: 'response.created',
  });
  sidebandSocket.receive({
    response: {
      id: 'response-correct',
      output: [
        {
          arguments: '{"instruction":"use SQLite instead"}',
          call_id: 'correct-call',
          name: 'correct_hermes',
          type: 'function_call',
        },
      ],
    },
    type: 'response.done',
  });
  await settled();
  assert.deepEqual(corrected, ['use SQLite instead']);

  finishAsk();
  await settled();
  assert.equal(updates().length, 2);
  assert.deepEqual(
    (updates()[1]!.session as { tools: { name: string }[] }).tools.map(
      ({ name }) => name,
    ),
    ['ask_hermes'],
  );
  await backend.endRealtimeCall('call-wiring');
});

test('input transcription is opt-in and uses the turn-committed model', () => {
  // Default: no transcription block — captions bill separately on the
  // user's key, so fresh installs pay nothing extra.
  const off = createOpenAiRealtimeSessionConfig(
    'gpt-realtime-2.1-mini',
    'marin',
  );
  assert.equal(JSON.stringify(off).includes('transcription'), false);

  const on = createOpenAiRealtimeSessionConfig(
    'gpt-realtime-2.1-mini',
    'marin',
    true,
  );
  assert.deepEqual(
    (on.audio.input as { transcription?: { model: string } }).transcription,
    { model: 'gpt-transcribe' },
  );
});
