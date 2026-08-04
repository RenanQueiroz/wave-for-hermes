import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isWaveRealtimeModelId,
  parseRealtimeModelPreference,
  serializeRealtimeModelPreference,
  WAVE_REALTIME_DEFAULT_MODEL,
  WAVE_REALTIME_MODEL_IDS,
  WAVE_REALTIME_MODEL_OPTIONS,
} from '../../src/services/realtime/realtime-model-preference-record.ts';
import { RealtimeModelPreferenceStore } from '../../src/services/realtime/realtime-model-preference-store.ts';

function memoryStorage(initial?: string) {
  let value = initial ?? null;
  return {
    current: () => value,
    storage: {
      getItemAsync: async () => value,
      setItemAsync: async (_key: string, next: string) => {
        value = next;
      },
    },
  };
}

test('allowlist contains only the two supported Realtime model ids', () => {
  assert.deepEqual(WAVE_REALTIME_MODEL_IDS, [
    'gpt-realtime-2.1-mini',
    'gpt-realtime-2.1',
  ]);
  assert.equal(WAVE_REALTIME_DEFAULT_MODEL, 'gpt-realtime-2.1-mini');
  assert.equal(isWaveRealtimeModelId('gpt-realtime-2.1-mini'), true);
  assert.equal(isWaveRealtimeModelId('gpt-realtime-2.1'), true);
  assert.equal(isWaveRealtimeModelId('gpt-realtime-3'), false);
  assert.equal(isWaveRealtimeModelId(''), false);
});

test('round-trips each supported Realtime model in a strict v1 record', () => {
  for (const model of WAVE_REALTIME_MODEL_IDS) {
    assert.equal(
      parseRealtimeModelPreference(serializeRealtimeModelPreference(model)),
      model,
    );
  }
  assert.throws(() =>
    parseRealtimeModelPreference(
      JSON.stringify({
        extra: true,
        model: WAVE_REALTIME_DEFAULT_MODEL,
        version: 1,
      }),
    ),
  );
  assert.throws(() =>
    parseRealtimeModelPreference(
      JSON.stringify({ model: WAVE_REALTIME_DEFAULT_MODEL, version: 2 }),
    ),
  );
});

test('missing, corrupt, and removed model records fall back to mini', async () => {
  const missing = new RealtimeModelPreferenceStore(memoryStorage().storage);
  assert.equal(await missing.load(), WAVE_REALTIME_DEFAULT_MODEL);

  for (const stored of [
    'not-json',
    JSON.stringify({ model: 'gpt-realtime-retired', version: 1 }),
    JSON.stringify({ model: 'gpt-realtime-2.1-mini', version: 99 }),
  ]) {
    const store = new RealtimeModelPreferenceStore(
      memoryStorage(stored).storage,
    );
    assert.equal(await store.load(), WAVE_REALTIME_DEFAULT_MODEL);
  }
});

test('saves independently and exposes accessible model option metadata', async () => {
  const memory = memoryStorage();
  const store = new RealtimeModelPreferenceStore(memory.storage);
  await store.save('gpt-realtime-2.1');
  assert.equal(await store.load(), 'gpt-realtime-2.1');
  assert.doesNotMatch(memory.current() ?? '', /voice|api.?key/i);
  assert.deepEqual(
    WAVE_REALTIME_MODEL_OPTIONS.map(({ id, testID }) => ({ id, testID })),
    [
      {
        id: 'gpt-realtime-2.1-mini',
        testID: 'realtime-model-gpt-realtime-2-1-mini',
      },
      {
        id: 'gpt-realtime-2.1',
        testID: 'realtime-model-gpt-realtime-2-1',
      },
    ],
  );
});
