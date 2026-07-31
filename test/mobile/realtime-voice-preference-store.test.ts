import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseRealtimeVoicePreference,
  serializeRealtimeVoicePreference,
} from '../../src/services/realtime/realtime-voice-preference-record.ts';

test('round-trips Gateway-default and explicit Realtime voice preferences', () => {
  assert.equal(
    parseRealtimeVoicePreference(serializeRealtimeVoicePreference('default')),
    'default',
  );
  assert.equal(
    parseRealtimeVoicePreference(serializeRealtimeVoicePreference('cedar')),
    'cedar',
  );
});

test('rejects unknown, malformed, and forward-incompatible voice preferences', () => {
  assert.throws(() =>
    parseRealtimeVoicePreference(
      JSON.stringify({ preference: 'custom-voice', version: 1 }),
    ),
  );
  assert.throws(() =>
    parseRealtimeVoicePreference(
      JSON.stringify({ extra: true, preference: 'marin', version: 1 }),
    ),
  );
  assert.throws(() =>
    parseRealtimeVoicePreference(
      JSON.stringify({ preference: 'marin', version: 2 }),
    ),
  );
  assert.throws(() => parseRealtimeVoicePreference('not-json'));
});
