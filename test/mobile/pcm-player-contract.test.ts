import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createToneChunk,
  decodeInterleavedInt16Pcm,
  PCM_MAX_CHUNK_BYTES,
  resamplePlanarPcm,
  StreamingPcmResampler,
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

test('PCM conversion preserves interleaving, byte offsets, and signed amplitude', () => {
  const storage = new Uint8Array(12);
  const view = new DataView(storage.buffer);
  view.setInt16(2, -32_768, true);
  view.setInt16(4, 16_384, true);
  view.setInt16(6, 32_767, true);
  view.setInt16(8, -16_384, true);

  const [left, right] = decodeInterleavedInt16Pcm(storage.subarray(2, 10), 2);

  assert.deepEqual(Array.from(left), [-1, 32_767 / 32_768]);
  assert.deepEqual(Array.from(right), [0.5, -0.5]);
});

test('PCM resampling preserves duration, channels, and bounded interpolation', () => {
  const source = [new Float32Array([0, 1]), new Float32Array([1, 0])];
  const [left, right] = resamplePlanarPcm(source, 2, 4);

  assert.deepEqual(Array.from(left), [0, 0.5, 1, 1]);
  assert.deepEqual(Array.from(right), [1, 0.5, 0, 0]);
  assert.equal(resamplePlanarPcm(source, 4, 4), source);
  assert.throws(
    () => resamplePlanarPcm([new Float32Array()], 24_000, 48_000),
    /non-empty/,
  );
});

test('streaming PCM resampling interpolates continuously across buffers', () => {
  const resampler = new StreamingPcmResampler(2, 4);
  const first = resampler.append([new Float32Array([0, 1, 0])]);
  const second = resampler.append([new Float32Array([-1, 0])]);
  const tail = resampler.finish();

  assert.deepEqual(
    [first, second, tail].map((block) => block.sourceFrames),
    [2, 2, 1],
  );
  assert.deepEqual(
    [first, second, tail].flatMap((block) => Array.from(block.channelData[0])),
    [0, 0.5, 1, 0.5, 0, -0.5, -1, -0.5, 0, 0],
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
