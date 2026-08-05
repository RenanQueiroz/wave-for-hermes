import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createToneChunk,
  PCM_MAX_CHUNK_BYTES,
  validatePcmChunk,
  validatePcmFormat,
} from '../../src/native/pcm-player-contract.ts';

test('PCM format accepts the Hermes range and rejects unsupported shapes', () => {
  assert.deepEqual(validatePcmFormat({ channels: 1, sampleRate: 24_000 }), {
    channels: 1,
    sampleRate: 24_000,
  });
  assert.deepEqual(validatePcmFormat({ channels: 2, sampleRate: 48_000 }), {
    channels: 2,
    sampleRate: 48_000,
  });
  assert.throws(
    () => validatePcmFormat({ channels: 1, sampleRate: 7_999 }),
    /sampleRate/,
  );
  assert.throws(
    () =>
      validatePcmFormat({
        channels: 3 as unknown as 1,
        sampleRate: 24_000,
      }),
    /channels/,
  );
});

test('PCM chunks require bounded complete interleaved Int16 frames', () => {
  assert.doesNotThrow(() => validatePcmChunk(new Uint8Array(2), 1));
  assert.doesNotThrow(() => validatePcmChunk(new Uint8Array(4), 2));
  assert.throws(() => validatePcmChunk(new Uint8Array(), 1), /between/);
  assert.throws(
    () => validatePcmChunk(new Uint8Array(3), 1),
    /complete interleaved/,
  );
  assert.throws(
    () => validatePcmChunk(new Uint8Array(PCM_MAX_CHUNK_BYTES + 2), 1),
    /between/,
  );
});

test('tone chunks are little-endian, aligned, and duplicate stereo samples', () => {
  const chunk = createToneChunk({
    amplitude: 0.5,
    channels: 2,
    frameCount: 3,
    frequencyHz: 2_000,
    sampleRate: 8_000,
    startFrame: 0,
  });
  const view = new DataView(chunk.buffer);

  assert.equal(chunk.byteLength, 12);
  assert.equal(view.getInt16(0, true), 0);
  assert.equal(view.getInt16(2, true), 0);
  assert.equal(view.getInt16(4, true), 16_384);
  assert.equal(view.getInt16(6, true), 16_384);
  assert.equal(view.getInt16(8, true), 0);
  assert.equal(view.getInt16(10, true), 0);
});
