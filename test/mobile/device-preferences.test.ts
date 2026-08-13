import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isWaveRealtimeModelId,
  parseRealtimeModelPreference,
  serializeRealtimeModelPreference,
  WAVE_REALTIME_MODEL_IDS,
  WAVE_REALTIME_MODEL_OPTIONS,
} from '../../src/services/realtime/realtime-model-preference-record.ts';
import { parseRealtimeCaptionPreference } from '../../src/services/realtime/realtime-caption-preference-record.ts';
import {
  parseRealtimeVoicePreference,
  resolveRealtimeVoicePreference,
} from '../../src/services/realtime/realtime-voice-preference-record.ts';
import { openAiKeyStore } from '../../src/services/realtime/openai-key-store.ts';
import {
  parseUpdateAutoCheckPreference,
  serializeUpdateAutoCheckPreference,
  WAVE_UPDATE_AUTO_CHECK_DEFAULT,
} from '../../src/services/updates/update-check-preference-record.ts';
import {
  createDevicePreferenceStores,
  parseThemeAppearance,
  serializeThemeAppearance,
} from '../../src/state/device-preferences.ts';
import { openAiKeyState } from '../../src/state/openai-key-state.ts';

function memoryStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  let failWrites = false;
  return {
    items,
    setFailWrites: (value: boolean) => {
      failWrites = value;
    },
    storage: {
      getItemAsync: async (key: string) => items.get(key) ?? null,
      setItemAsync: async (key: string, value: string) => {
        if (failWrites) throw new Error('storage full');
        items.set(key, value);
      },
    },
  };
}

test('allowlist contains only the two supported Realtime model ids', () => {
  assert.deepEqual(WAVE_REALTIME_MODEL_IDS, [
    'gpt-realtime-2.1-mini',
    'gpt-realtime-2.1',
  ]);
  assert.equal(
    WAVE_REALTIME_MODEL_OPTIONS.every((option) =>
      isWaveRealtimeModelId(option.id),
    ),
    true,
  );
  assert.deepEqual(
    WAVE_REALTIME_MODEL_OPTIONS.map((option) => option.label),
    ['GPT-Realtime-2.1 mini', 'GPT-Realtime-2.1'],
  );
});

test('records reject malformed, retired, and unknown-field payloads', () => {
  assert.throws(() => parseRealtimeModelPreference('"gpt-realtime-2.1"'));
  assert.throws(() =>
    parseRealtimeModelPreference(
      JSON.stringify({ model: 'gpt-5', version: 1 }),
    ),
  );
  assert.throws(() =>
    parseRealtimeModelPreference(
      JSON.stringify({ extra: true, model: 'gpt-realtime-2.1', version: 1 }),
    ),
  );
  assert.equal(
    parseRealtimeModelPreference(
      serializeRealtimeModelPreference('gpt-realtime-2.1'),
    ),
    'gpt-realtime-2.1',
  );
  assert.throws(() => parseRealtimeCaptionPreference('true'));
  assert.throws(() =>
    parseRealtimeVoicePreference(
      JSON.stringify({ preference: 'robotic', version: 1 }),
    ),
  );
});

test('the update auto-check record is strict and defaults on', () => {
  assert.equal(WAVE_UPDATE_AUTO_CHECK_DEFAULT, true);
  assert.equal(
    parseUpdateAutoCheckPreference(serializeUpdateAutoCheckPreference(false)),
    false,
  );
  assert.throws(() => parseUpdateAutoCheckPreference('true'));
  assert.throws(() =>
    parseUpdateAutoCheckPreference(JSON.stringify({ autoCheck: true })),
  );
  assert.throws(() =>
    parseUpdateAutoCheckPreference(
      JSON.stringify({ autoCheck: true, extra: 1, version: 1 }),
    ),
  );
  assert.throws(() =>
    parseUpdateAutoCheckPreference(
      JSON.stringify({ autoCheck: 'yes', version: 1 }),
    ),
  );

  const memory = memoryStorage();
  const stores = createDevicePreferenceStores(memory.storage);
  assert.equal(stores.updateAutoCheck.api.getState().value, true);
});

test('the default Realtime voice preference resolves to the call default', () => {
  assert.equal(resolveRealtimeVoicePreference('default'), 'marin');
  assert.equal(resolveRealtimeVoicePreference('cedar'), 'cedar');
});

test('theme appearance keeps v1 appearances and rejects unknown shapes', () => {
  assert.equal(
    parseThemeAppearance(
      JSON.stringify({ appearance: 'dark', family: 'moon', version: 1 }),
    ),
    'dark',
  );
  assert.equal(
    parseThemeAppearance(serializeThemeAppearance('light')),
    'light',
  );
  assert.throws(() =>
    parseThemeAppearance(JSON.stringify({ appearance: 'sepia', version: 2 })),
  );
});

test('stores hydrate stored records once and default on corrupt ones', async () => {
  const memory = memoryStorage({
    'wave.realtime-caption-preference.v1': JSON.stringify({
      captions: true,
      version: 1,
    }),
    'wave.realtime-model-preference.v1': 'not json',
  });
  const stores = createDevicePreferenceStores(memory.storage);
  assert.equal(stores.realtimeCaptions.api.getState().hydrated, false);
  assert.equal(await stores.realtimeCaptions.read(), true);
  assert.equal(await stores.realtimeModel.read(), 'gpt-realtime-2.1-mini');
  assert.equal(await stores.realtimeVoice.read(), 'default');
  assert.equal(stores.realtimeCaptions.api.getState().hydrated, true);
});

test('set applies optimistically, persists, and reports a failed write', async () => {
  const memory = memoryStorage();
  const stores = createDevicePreferenceStores(memory.storage);
  await stores.realtimeModel.set('gpt-realtime-2.1');
  assert.equal(
    memory.items.get('wave.realtime-model-preference.v1'),
    JSON.stringify({ model: 'gpt-realtime-2.1', version: 1 }),
  );

  memory.setFailWrites(true);
  await assert.rejects(
    () => stores.themeAppearance.set('dark'),
    /appearance preference/,
  );
  // The in-memory value stands until the next launch even when the write
  // failed — matching the previous behavior of the theme preference.
  assert.equal(stores.themeAppearance.api.getState().value, 'dark');
});

test('a set that races ahead of hydration wins over the stored record', async () => {
  const memory = memoryStorage({
    'wave.realtime-caption-preference.v1': JSON.stringify({
      captions: false,
      version: 1,
    }),
  });
  const stores = createDevicePreferenceStores(memory.storage);
  const hydration = stores.realtimeCaptions.hydrate();
  await stores.realtimeCaptions.set(true);
  await hydration;
  assert.equal(stores.realtimeCaptions.api.getState().value, true);
});

test('store subscribers observe preference changes', async () => {
  const stores = createDevicePreferenceStores(memoryStorage().storage);
  const seen: boolean[] = [];
  const unsubscribe = stores.realtimeCaptions.api.subscribe((state) =>
    seen.push(state.value),
  );
  await stores.realtimeCaptions.set(true);
  await stores.realtimeCaptions.set(false);
  unsubscribe();
  assert.deepEqual(seen, [true, false]);
});

test('openai key state projects presence only and refreshes after changes', async () => {
  // The shim-backed singleton starts with no key saved.
  await openAiKeyState.hydrate();
  assert.equal(openAiKeyState.api.getState().hasKey, false);
  assert.equal(openAiKeyState.api.getState().realtimeEnabled, true);

  await openAiKeyStore.save('sk-unit-test-key-value-000000');
  await openAiKeyStore.saveRealtimeEnabled(false);
  await openAiKeyState.refresh();
  const state = openAiKeyState.api.getState();
  assert.equal(state.hasKey, true);
  assert.equal(state.realtimeEnabled, false);
  // Presence only: the state object never carries the key value itself.
  assert.deepEqual(Object.keys(state).sort(), [
    'hasKey',
    'hydrated',
    'realtimeEnabled',
  ]);

  await openAiKeyStore.clear();
  await openAiKeyState.refresh();
  assert.equal(openAiKeyState.api.getState().hasKey, false);
});
