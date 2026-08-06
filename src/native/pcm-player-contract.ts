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
 * native playback adapter. Hermes v0.20 currently advertises mono Int16 PCM,
 * while two channels remain accepted for explicit format/restart testing.
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

/** Convert bounded interleaved little-endian Int16 PCM into Web Audio's planar float shape. */
export function decodeInterleavedInt16Pcm(
  data: Uint8Array,
  channels: 1 | 2,
): Float32Array<ArrayBuffer>[] {
  validatePcmChunk(data, channels);
  const frameCount =
    data.byteLength / (channels * Int16Array.BYTES_PER_ELEMENT);
  const channelData: Float32Array<ArrayBuffer>[] = Array.from(
    { length: channels },
    () => new Float32Array(frameCount),
  );
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const byteOffset =
        (frame * channels + channel) * Int16Array.BYTES_PER_ELEMENT;
      channelData[channel][frame] = view.getInt16(byteOffset, true) / 32_768;
    }
  }

  return channelData;
}

export interface ResampledPcmBlock {
  channelData: Float32Array<ArrayBuffer>[];
  sourceFrames: number;
}

/**
 * Linear PCM resampler that preserves interpolation across streamed buffers.
 * It retains only the final source frame needed to bridge the next buffer.
 */
export class StreamingPcmResampler {
  private accountedSourceFrames = 0;
  private channelCount: number | undefined;
  private emittedTargetFrames = 0;
  private finished = false;
  private lastSamples: Float32Array<ArrayBuffer> | undefined;
  private readonly sourceSampleRate: number;
  private readonly targetSampleRate: number;
  private totalSourceFrames = 0;

  constructor(sourceSampleRate: number, targetSampleRate: number) {
    validateResamplingRate(sourceSampleRate);
    validateResamplingRate(targetSampleRate);
    this.sourceSampleRate = sourceSampleRate;
    this.targetSampleRate = targetSampleRate;
  }

  append(channelData: Float32Array<ArrayBuffer>[]): ResampledPcmBlock {
    if (this.finished) {
      throw new Error('PCM resampling has already finished.');
    }
    const sourceFrameCount = validatePlanarPcm(channelData, this.channelCount);
    this.channelCount ??= channelData.length;

    const absoluteStart = this.totalSourceFrames;
    const availableLastIndex = absoluteStart + sourceFrameCount - 1;
    const endTargetFrame = targetFramesBeforeSourceIndex(
      availableLastIndex,
      this.sourceSampleRate,
      this.targetSampleRate,
    );
    const output = this.renderRange(
      channelData,
      absoluteStart,
      this.emittedTargetFrames,
      endTargetFrame,
    );

    this.emittedTargetFrames = endTargetFrame;
    this.totalSourceFrames += sourceFrameCount;
    this.lastSamples = Float32Array.from(
      channelData.map((channel) => channel[sourceFrameCount - 1]),
    );

    const accountableSourceFrames = Math.min(
      this.totalSourceFrames,
      Math.floor(
        (this.emittedTargetFrames * this.sourceSampleRate) /
          this.targetSampleRate,
      ),
    );
    const newlyAccountedFrames =
      accountableSourceFrames - this.accountedSourceFrames;
    this.accountedSourceFrames = accountableSourceFrames;

    return { channelData: output, sourceFrames: newlyAccountedFrames };
  }

  finish(): ResampledPcmBlock {
    if (this.finished) {
      throw new Error('PCM resampling has already finished.');
    }
    this.finished = true;
    if (!this.lastSamples || this.channelCount === undefined) {
      throw new Error('PCM resampling cannot finish before receiving audio.');
    }

    const endTargetFrame = Math.max(
      this.emittedTargetFrames,
      Math.round(
        (this.totalSourceFrames * this.targetSampleRate) /
          this.sourceSampleRate,
      ),
    );
    const finalChannels = Array.from(
      { length: this.channelCount },
      (_, channel) => new Float32Array([this.lastSamples![channel]]),
    );
    const output = this.renderRange(
      finalChannels,
      this.totalSourceFrames,
      this.emittedTargetFrames,
      endTargetFrame,
      true,
    );
    const newlyAccountedFrames =
      this.totalSourceFrames - this.accountedSourceFrames;
    this.accountedSourceFrames = this.totalSourceFrames;
    this.emittedTargetFrames = endTargetFrame;

    return { channelData: output, sourceFrames: newlyAccountedFrames };
  }

  private renderRange(
    channelData: Float32Array<ArrayBuffer>[],
    absoluteStart: number,
    startTargetFrame: number,
    endTargetFrame: number,
    clampToLastSample = false,
  ) {
    const outputFrameCount = endTargetFrame - startTargetFrame;
    const output = channelData.map(() => new Float32Array(outputFrameCount));
    const availableLastIndex = absoluteStart + channelData[0].length - 1;

    for (
      let targetFrame = startTargetFrame;
      targetFrame < endTargetFrame;
      targetFrame += 1
    ) {
      const sourceNumerator = targetFrame * this.sourceSampleRate;
      const lowerIndex = Math.floor(sourceNumerator / this.targetSampleRate);
      const upperIndex = lowerIndex + 1;
      const fraction =
        (sourceNumerator % this.targetSampleRate) / this.targetSampleRate;
      const outputIndex = targetFrame - startTargetFrame;

      for (let channel = 0; channel < channelData.length; channel += 1) {
        const lower = this.sampleAt(
          channelData[channel],
          channel,
          lowerIndex,
          absoluteStart,
          availableLastIndex,
          clampToLastSample,
        );
        const upper = this.sampleAt(
          channelData[channel],
          channel,
          upperIndex,
          absoluteStart,
          availableLastIndex,
          clampToLastSample,
        );
        output[channel][outputIndex] = lower + fraction * (upper - lower);
      }
    }

    return output;
  }

  private sampleAt(
    channelData: Float32Array<ArrayBuffer>,
    channel: number,
    absoluteIndex: number,
    absoluteStart: number,
    availableLastIndex: number,
    clampToLastSample: boolean,
  ) {
    if (absoluteIndex === absoluteStart - 1 && this.lastSamples) {
      return this.lastSamples[channel];
    }
    if (clampToLastSample && absoluteIndex > availableLastIndex) {
      return channelData[channelData.length - 1];
    }
    const relativeIndex = absoluteIndex - absoluteStart;
    const sample = channelData[relativeIndex];
    if (sample === undefined) {
      throw new Error('The streaming PCM resampler lost buffer continuity.');
    }
    return sample;
  }
}

/** Resample one complete bounded planar buffer into the target rate. */
export function resamplePlanarPcm(
  channelData: Float32Array<ArrayBuffer>[],
  sourceSampleRate: number,
  targetSampleRate: number,
): Float32Array<ArrayBuffer>[] {
  validateResamplingRate(sourceSampleRate);
  validateResamplingRate(targetSampleRate);
  validatePlanarPcm(channelData);
  if (sourceSampleRate === targetSampleRate) return channelData;

  const resampler = new StreamingPcmResampler(
    sourceSampleRate,
    targetSampleRate,
  );
  const streamed = resampler.append(channelData).channelData;
  const tail = resampler.finish().channelData;
  return streamed.map((channel, index) => {
    const combined = new Float32Array(channel.length + tail[index].length);
    combined.set(channel);
    combined.set(tail[index], channel.length);
    return combined;
  });
}

function validateResamplingRate(sampleRate: number) {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new Error('PCM resampling rates must be finite and positive.');
  }
}

function validatePlanarPcm(
  channelData: Float32Array<ArrayBuffer>[],
  expectedChannels?: number,
) {
  const sourceFrameCount = channelData[0]?.length ?? 0;
  if (
    sourceFrameCount === 0 ||
    channelData.some((channel) => channel.length !== sourceFrameCount)
  ) {
    throw new Error(
      'PCM resampling requires non-empty channels with equal frame counts.',
    );
  }
  if (
    expectedChannels !== undefined &&
    channelData.length !== expectedChannels
  ) {
    throw new Error('PCM resampling channel count changed mid-stream.');
  }
  return sourceFrameCount;
}

function targetFramesBeforeSourceIndex(
  sourceIndex: number,
  sourceSampleRate: number,
  targetSampleRate: number,
) {
  return Math.ceil((sourceIndex * targetSampleRate) / sourceSampleRate);
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
