import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseRealtimeCaptionPreference,
  serializeRealtimeCaptionPreference,
} from '../../src/services/realtime/realtime-caption-preference-record.ts';
import { RealtimeCaptionPreferenceStore } from '../../src/services/realtime/realtime-caption-preference-store.ts';

test('caption preference round-trips and rejects foreign shapes', () => {
  assert.equal(
    parseRealtimeCaptionPreference(serializeRealtimeCaptionPreference(true)),
    true,
  );
  assert.equal(
    parseRealtimeCaptionPreference(serializeRealtimeCaptionPreference(false)),
    false,
  );
  for (const bad of [
    '"true"',
    '{}',
    '{"captions":1,"version":1}',
    '{"captions":true,"version":2}',
    '{"captions":true,"version":1,"extra":true}',
  ]) {
    assert.throws(() => parseRealtimeCaptionPreference(bad));
  }
});

test('missing or corrupt storage resolves to captions off', async () => {
  const missing = new RealtimeCaptionPreferenceStore({
    getItemAsync: async () => null,
    setItemAsync: async () => undefined,
  });
  assert.equal(await missing.load(), false);

  const corrupt = new RealtimeCaptionPreferenceStore({
    getItemAsync: async () => 'not json',
    setItemAsync: async () => undefined,
  });
  assert.equal(await corrupt.load(), false);

  let stored: string | null = null;
  const working = new RealtimeCaptionPreferenceStore({
    getItemAsync: async () => stored,
    setItemAsync: async (_key, value) => {
      stored = value;
    },
  });
  await working.save(true);
  assert.equal(await working.load(), true);
});
