import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  createOpenAiRealtimeSessionConfig,
  OpenAiRealtimeBackend,
} from '../../src/services/realtime/openai-realtime-backend.ts';
import { RealtimeModelPreferenceStore } from '../../src/services/realtime/realtime-model-preference-store.ts';
import {
  buildWaveRealtimeInstructions,
  createAskHermesToolDefinition,
} from '../../src/services/realtime/realtime-prompt.ts';

const UNUSED_RESULT = { answer: '', ok: true, truncated: false } as const;

test('prompt snapshot keeps generic delegation independent of agent metadata', () => {
  const prompt = buildWaveRealtimeInstructions();
  assert.equal(buildWaveRealtimeInstructions.length, 0);
  assert.equal(
    createHash('sha256').update(prompt).digest('hex'),
    '3a35059fd0297374d43d8dcb642d4c9f055199eb9a5459808cfd2b1648c356d2',
  );
  for (const untrusted of [
    'MALICIOUS_TOOL_DESCRIPTION',
    'mcp://attacker.invalid',
    'AGENT_CARD_INJECTION',
    'session.info secret payload',
  ]) {
    assert.doesNotMatch(prompt, new RegExp(untrusted.replaceAll('.', '\\.')));
  }
  assert.match(prompt, /user explicitly names a tool, skill, CLI, provider/);
  assert.match(prompt, /Otherwise, do not invent or prescribe one/);
  assert.match(prompt, /silence, background noise, hold music/);
  assert.match(prompt, /corrects themselves within one utterance/);
  assert.match(prompt, /bare stop command ends live voice locally/);
});

test('session config contains one strict generic ask_hermes tool and one model', () => {
  for (const model of ['gpt-realtime-2.1-mini', 'gpt-realtime-2.1'] as const) {
    const config = createOpenAiRealtimeSessionConfig(model, 'marin');
    const serialized = JSON.stringify(config);
    assert.equal(serialized.split(model).length - 1, 1);
    assert.equal(config.model, model);
    assert.deepEqual(config.reasoning, { effort: 'low' });
    assert.deepEqual(config.tools, [createAskHermesToolDefinition()]);
    assert.equal(config.tools[0].name, 'ask_hermes');
    assert.equal(config.tools[0].parameters.additionalProperties, false);
    assert.deepEqual(config.tools[0].parameters.required, ['instruction']);
  }
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
  const store = new RealtimeModelPreferenceStore({
    getItemAsync: async () => stored,
    setItemAsync: async (_key, value) => {
      stored = value;
    },
  });
  const selectedAtConstruction = await store.load();
  let setupSession = '';
  const backend = new OpenAiRealtimeBackend({
    apiKey: 'unit-test-api-key',
    executeAskHermes: async () => UNUSED_RESULT,
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
  await store.save('gpt-realtime-2.1');

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
  assert.equal(await store.load(), 'gpt-realtime-2.1');
});

test('model-specific setup rejection is attempted once without fallback', async () => {
  let attempts = 0;
  const backend = new OpenAiRealtimeBackend({
    apiKey: 'unit-test-api-key',
    executeAskHermes: async () => UNUSED_RESULT,
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
