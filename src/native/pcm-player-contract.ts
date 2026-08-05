export const PCM_MIN_SAMPLE_RATE = 8_000;
export const PCM_MAX_SAMPLE_RATE = 48_000;
export const PCM_MAX_CHUNK_BYTES = 512 * 1024;
export const PCM_MAX_QUEUED_SECONDS = 12;

export interface PcmFormat {
  channels: 1 | 2;
  sampleRate: number;
}

export interface ToneChunkOptions extends PcmFormat {
  amplitude?: number;
  frameCount: number;
  frequencyHz: number;
  startFrame: number;
}

/**
 * Validate the exact foreground playback format supported by Wave's focused
 * native module. Hermes v0.20 currently advertises mono Int16 PCM, while two
 * channels remain accepted for explicit format/restart testing.
 */
export function validatePcmFormat(format: PcmFormat): PcmFormat {
  if (
    !Number.isInteger(format.sampleRate) ||
    format.sampleRate < PCM_MIN_SAMPLE_RATE ||
    format.sampleRate > PCM_MAX_SAMPLE_RATE
  ) {
    throw new Error(
      `PCM sampleRate must be an integer between ${PCM_MIN_SAMPLE_RATE} and ${PCM_MAX_SAMPLE_RATE}.`,
    );
  }
  if (format.channels !== 1 && format.channels !== 2) {
    throw new Error('PCM channels must be 1 or 2.');
  }
  return format;
}

export function validatePcmChunk(data: Uint8Array, channels: 1 | 2) {
  const bytesPerFrame = channels * Int16Array.BYTES_PER_ELEMENT;
  if (data.byteLength === 0 || data.byteLength > PCM_MAX_CHUNK_BYTES) {
    throw new Error(
      `PCM chunks must contain between 1 and ${PCM_MAX_CHUNK_BYTES} bytes.`,
    );
  }
  if (!Number.isInteger(data.byteLength) || data.byteLength % bytesPerFrame) {
    throw new Error(
      'PCM chunks must contain complete interleaved little-endian Int16 frames.',
    );
  }
}

/** Generate an aligned little-endian Int16 tone chunk for the native proof. */
export function createToneChunk({
  amplitude = 0.2,
  channels,
  frameCount,
  frequencyHz,
  sampleRate,
  startFrame,
}: ToneChunkOptions): Uint8Array {
  validatePcmFormat({ channels, sampleRate });
  if (!Number.isInteger(frameCount) || frameCount <= 0) {
    throw new Error('Tone frameCount must be a positive integer.');
  }
  if (!Number.isFinite(frequencyHz) || frequencyHz <= 0) {
    throw new Error('Tone frequencyHz must be positive.');
  }
  if (!Number.isInteger(startFrame) || startFrame < 0) {
    throw new Error('Tone startFrame must be a non-negative integer.');
  }
  if (!Number.isFinite(amplitude) || amplitude <= 0 || amplitude > 1) {
    throw new Error('Tone amplitude must be greater than 0 and at most 1.');
  }

  const bytesPerFrame = channels * Int16Array.BYTES_PER_ELEMENT;
  const bytes = new Uint8Array(frameCount * bytesPerFrame);
  const view = new DataView(bytes.buffer);
  for (let frame = 0; frame < frameCount; frame += 1) {
    const phase =
      (2 * Math.PI * frequencyHz * (startFrame + frame)) / sampleRate;
    const sample = Math.round(Math.sin(phase) * amplitude * 32_767);
    for (let channel = 0; channel < channels; channel += 1) {
      view.setInt16((frame * channels + channel) * 2, sample, true);
    }
  }
  return bytes;
}
