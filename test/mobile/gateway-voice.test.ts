import assert from 'node:assert/strict';
import test from 'node:test';

import { readAudioCapabilities } from '../../src/services/gateway/gateway-client.ts';
import {
  initialUtteranceTracker,
  isVoiceStopCommand,
  MAX_UTTERANCE_MS,
  mimeTypeForRecording,
  observeUtterance,
  SILENCE_HOLD_MS,
  voicePhaseDescription,
  voicePhaseTitle,
} from '../../src/features/voice/gateway-voice-machine.ts';

test('detects only bare stop commands, never instructions containing them', () => {
  assert.equal(isVoiceStopCommand('stop'), true);
  assert.equal(isVoiceStopCommand('Stop.'), true);
  assert.equal(isVoiceStopCommand('  Never mind!  '), true);
  assert.equal(isVoiceStopCommand('wave stop'), true);

  // Real instructions that merely contain a stop word must reach Hermes.
  assert.equal(isVoiceStopCommand('stop the deployment'), false);
  assert.equal(isVoiceStopCommand('cancel my 3pm meeting'), false);
  assert.equal(isVoiceStopCommand('tell me when to stop'), false);
  assert.equal(isVoiceStopCommand(''), false);
});

test('ends an utterance on a held silence that followed real speech', () => {
  const interval = 250;
  let tracker = initialUtteranceTracker;
  let elapsed = 0;
  const feed = (level: number) => {
    elapsed += interval;
    const result = observeUtterance(
      tracker,
      { elapsedMs: elapsed, level },
      interval,
    );
    tracker = result.tracker;
    return result.decision;
  };

  // Silence before any speech never submits, however long it lasts.
  for (let i = 0; i < 20; i += 1) {
    assert.deepEqual(feed(-80), { type: 'continue' });
  }
  assert.equal(tracker.heardSpeech, false);

  // Speech, then a pause shorter than the hold: still listening.
  assert.deepEqual(feed(-15), { type: 'continue' });
  assert.equal(tracker.heardSpeech, true);
  const shortPause = Math.floor(SILENCE_HOLD_MS / interval) - 1;
  for (let i = 0; i < shortPause; i += 1) {
    assert.deepEqual(feed(-80), { type: 'continue' });
  }

  // Speaking again resets the silence counter.
  feed(-12);
  assert.equal(tracker.silentForMs, 0);

  // A full hold of silence submits.
  let submitted = false;
  for (let i = 0; i < Math.ceil(SILENCE_HOLD_MS / interval); i += 1) {
    const decision = feed(-80);
    if (decision.type === 'submit') {
      assert.equal(decision.reason, 'silence');
      submitted = true;
      break;
    }
  }
  assert.equal(submitted, true);
});

test('caps an utterance by duration and tolerates missing metering', () => {
  const capped = observeUtterance(
    { heardSpeech: true, silentForMs: 0 },
    { elapsedMs: MAX_UTTERANCE_MS, level: -10 },
    250,
  );
  assert.deepEqual(capped.decision, { reason: 'max_duration', type: 'submit' });

  // A platform that reports no metering keeps listening until the cap; the
  // user's explicit stop is the normal path there.
  const unmetered = observeUtterance(
    initialUtteranceTracker,
    { elapsedMs: 5_000 },
    250,
  );
  assert.deepEqual(unmetered.decision, { type: 'continue' });
  assert.equal(unmetered.tracker.heardSpeech, false);
});

test('reads audio capabilities from a gateway config', () => {
  assert.deepEqual(
    readAudioCapabilities({
      stt: { provider: 'whisper-1' },
      tts: { provider: 'edge', enabled: true },
    }),
    { stt: true, tts: true },
  );
  assert.deepEqual(
    readAudioCapabilities({ tts: { provider: 'edge', enabled: false } }),
    { stt: false, tts: false },
  );
  assert.deepEqual(readAudioCapabilities({ tts: { provider: '  ' } }), {
    stt: false,
    tts: false,
  });
  assert.deepEqual(readAudioCapabilities({}), { stt: false, tts: false });
  assert.deepEqual(readAudioCapabilities(null), { stt: false, tts: false });
});

test('maps recording extensions to upload MIME types', () => {
  assert.equal(mimeTypeForRecording('file:///tmp/rec.m4a'), 'audio/mp4');
  assert.equal(mimeTypeForRecording('file:///tmp/rec.caf'), 'audio/x-caf');
  assert.equal(mimeTypeForRecording('file:///tmp/rec.wav'), 'audio/wav');
  assert.equal(mimeTypeForRecording('file:///tmp/rec.m4a?x=1'), 'audio/mp4');
  // Unknown or extensionless recordings still upload as audio.
  assert.match(mimeTypeForRecording('file:///tmp/recording'), /^audio\//);
});

test('describes every voice phase for the user', () => {
  for (const phase of [
    'idle',
    'listening',
    'transcribing',
    'thinking',
    'speaking',
  ] as const) {
    assert.ok(voicePhaseTitle(phase).length > 0);
    assert.ok(voicePhaseDescription(phase).length > 0);
  }
  assert.notEqual(voicePhaseTitle('listening'), voicePhaseTitle('speaking'));
});
