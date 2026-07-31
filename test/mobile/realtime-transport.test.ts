import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseRealtimeServerEvent,
  WAVE_MAX_REALTIME_EVENT_BYTES,
} from '../../src/services/realtime/realtime-transport.ts';

test('normalizes only bounded Realtime activity and transcript events', () => {
  assert.deepEqual(
    parseRealtimeServerEvent(
      JSON.stringify({
        audio_start_ms: 10,
        item_id: 'item-1',
        type: 'input_audio_buffer.speech_started',
      }),
    ),
    {
      activity: 'user_speaking',
      type: 'activity',
    },
  );
  assert.deepEqual(
    parseRealtimeServerEvent(
      JSON.stringify({
        delta: 'Hello',
        type: 'response.output_audio_transcript.delta',
      }),
    ),
    {
      final: false,
      role: 'assistant',
      text: 'Hello',
      type: 'transcript',
    },
  );
  assert.deepEqual(
    parseRealtimeServerEvent(
      JSON.stringify({
        transcript: 'Hi Wave',
        type: 'conversation.item.input_audio_transcription.completed',
      }),
    ),
    {
      final: true,
      role: 'user',
      text: 'Hi Wave',
      type: 'transcript',
    },
  );
  assert.equal(
    parseRealtimeServerEvent(
      JSON.stringify({
        type: 'rate_limits.updated',
      }),
    ),
    undefined,
  );
});

test('turns malformed, binary, and oversized Realtime events into safe protocol errors', () => {
  for (const input of [
    new Uint8Array([1, 2, 3]),
    '{',
    JSON.stringify({ type: '../../invalid' }),
    'x'.repeat(WAVE_MAX_REALTIME_EVENT_BYTES + 1),
  ]) {
    const event = parseRealtimeServerEvent(input);
    assert.equal(event?.type, 'error');
    if (event?.type === 'error') {
      assert.equal(event.error.kind, 'protocol');
      assert.doesNotMatch(event.error.message, /\{|\.\.\/|Uint8Array/);
    }
  }
});

test('does not expose provider error payloads', () => {
  const event = parseRealtimeServerEvent(
    JSON.stringify({
      error: {
        code: 'provider_secret',
        message: 'sensitive upstream details',
      },
      type: 'error',
    }),
  );
  assert.equal(event?.type, 'error');
  if (event?.type === 'error') {
    assert.equal(
      event.error.message,
      'The Realtime service reported an error.',
    );
    assert.doesNotMatch(event.error.message, /sensitive|provider_secret/);
  }
});
