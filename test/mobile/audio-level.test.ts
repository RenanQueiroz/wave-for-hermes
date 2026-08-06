import assert from 'node:assert/strict';
import test from 'node:test';

import {
  dbfsToAudioLevel,
  linearPcmLevelToAudioLevel,
  pcmChannelsToAudioLevel,
} from '../../src/services/audio/audio-level.ts';

test('normalizes recorder dBFS without animating digital silence', () => {
  assert.equal(dbfsToAudioLevel(Number.NaN), 0);
  assert.equal(dbfsToAudioLevel(-160), 0);
  assert.equal(dbfsToAudioLevel(-60), 0);
  assert.equal(dbfsToAudioLevel(-30), 0.5);
  assert.equal(dbfsToAudioLevel(0), 1);
  assert.equal(dbfsToAudioLevel(3), 1);
});

test('maps linear RMS levels logarithmically onto the same bounded scale', () => {
  assert.equal(linearPcmLevelToAudioLevel(0), 0);
  assert.ok(Math.abs(linearPcmLevelToAudioLevel(0.01) - 1 / 3) < 1e-12);
  assert.ok(Math.abs(linearPcmLevelToAudioLevel(0.1) - 2 / 3) < 1e-12);
  assert.equal(linearPcmLevelToAudioLevel(1), 1);
  assert.equal(linearPcmLevelToAudioLevel(2), 1);
});

test('calculates bounded RMS across normalized PCM channels', () => {
  assert.equal(pcmChannelsToAudioLevel([]), 0);
  assert.equal(pcmChannelsToAudioLevel([new Float32Array(8)]), 0);

  const level = pcmChannelsToAudioLevel([
    new Float32Array([1, -1]),
    [0.5, -0.5],
  ]);
  assert.ok(level > 0.9 && level <= 1);

  assert.equal(pcmChannelsToAudioLevel([[Infinity, Number.NaN]]), 0);
  assert.equal(pcmChannelsToAudioLevel([[2, -2]]), 1);
});
