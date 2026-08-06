import { createToneChunk } from '@/native/pcm-player-contract';
import { pcmStreamPlayer, type PcmPlaybackEvent } from '@/native/pcm-player';

const STREAM_SAMPLE_RATE = 24_000;
const RESTART_SAMPLE_RATE = 48_000;
const CHUNK_DURATION_MS = 20;
const SILENT_PREROLL_MS = 250;
const TONE_DURATION_MS = 400;
const TONE_GAP_MS = 60;
const TONE_EDGE_MS = 12;
const SILENT_POSTROLL_MS = 100;
const CANCELLATION_DURATION_MS = 800;
const FIRST_CHUNK_TIMEOUT_MS = 2_000;

export type PcmPlaybackProofPhase =
  | 'cancelling'
  | 'draining'
  | 'failed'
  | 'idle'
  | 'passed'
  | 'restarting'
  | 'stopping'
  | 'streaming';

export interface PcmPlaybackProofState {
  cancellation: 'pending' | 'stopped';
  drainedFrames: number;
  error?: string;
  expectedFrames: number;
  firstChunkLatencyMs?: number;
  formatRestart: 'pending' | 'passed';
  phase: PcmPlaybackProofPhase;
  underrunCount: number;
}

const INITIAL_STATE: PcmPlaybackProofState = {
  cancellation: 'pending',
  drainedFrames: 0,
  expectedFrames: 0,
  formatRestart: 'pending',
  phase: 'idle',
  underrunCount: 0,
};

export class PcmPlaybackProof {
  private attempt = 0;
  private listeners = new Set<(state: PcmPlaybackProofState) => void>();
  private state = INITIAL_STATE;

  getState = () => this.state;

  subscribe(listener: (state: PcmPlaybackProofState) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async start() {
    const attempt = ++this.attempt;
    await pcmStreamPlayer.stop().catch(() => undefined);
    if (attempt !== this.attempt) return;

    const firstPlaying = deferred<PcmPlaybackEvent>();
    let firstWriteStartedAt: number | undefined;
    let observedFirstChunkLatencyMs: number | undefined;
    let drainedFrames = 0;
    const subscription = pcmStreamPlayer.subscribe((event) => {
      if (attempt !== this.attempt) return;
      if (event.state === 'playing' && firstWriteStartedAt !== undefined) {
        observedFirstChunkLatencyMs ??= Math.round(
          performance.now() - firstWriteStartedAt,
        );
        firstPlaying.resolve(event);
      }
    });

    this.replaceState({ ...INITIAL_STATE, phase: 'streaming' });
    try {
      await pcmStreamPlayer.start({
        channels: 1,
        sampleRate: STREAM_SAMPLE_RATE,
      });
      if (attempt !== this.attempt) return;

      const framesPerChunk = (STREAM_SAMPLE_RATE * CHUNK_DURATION_MS) / 1_000;
      const bytesPerChunk = framesPerChunk * Int16Array.BYTES_PER_ELEMENT;
      const proofPcm = createProofToneSequence();
      const expectedFrames = proofPcm.byteLength / Int16Array.BYTES_PER_ELEMENT;
      this.patchState({ expectedFrames });

      firstWriteStartedAt = performance.now();
      let writtenChunkCount = 0;
      for (let byteOffset = 0; byteOffset < proofPcm.byteLength;) {
        if (attempt !== this.attempt) return;
        const nextByteOffset = Math.min(
          byteOffset + bytesPerChunk,
          proofPcm.byteLength,
        );
        pcmStreamPlayer.write(proofPcm.subarray(byteOffset, nextByteOffset));
        byteOffset = nextByteOffset;
        writtenChunkCount += 1;
        if (byteOffset < proofPcm.byteLength) {
          // Pace against an absolute producer clock so enqueue work and timer
          // jitter do not accumulate into a feed slower than the promised 2x.
          const nextChunkAt =
            firstWriteStartedAt + writtenChunkCount * (CHUNK_DURATION_MS / 2);
          await delay(Math.max(0, nextChunkAt - performance.now()));
        }
      }

      const firstEvent = await withTimeout(
        firstPlaying.promise,
        FIRST_CHUNK_TIMEOUT_MS,
      );
      const firstChunkLatencyMs = observedFirstChunkLatencyMs;
      if (firstChunkLatencyMs === undefined) {
        throw new Error(
          'The native player did not report first-chunk latency.',
        );
      }
      if (firstEvent.writtenFrames <= 0) {
        throw new Error(
          'The native player did not acknowledge its first PCM frames.',
        );
      }

      this.patchState({ firstChunkLatencyMs, phase: 'draining' });
      const completion = await pcmStreamPlayer.finish();
      drainedFrames = completion.playedFrames;
      if (Number.isInteger(completion.underrunCount)) {
        this.patchState({
          drainedFrames,
          underrunCount: completion.underrunCount,
        });
      }
      if (
        completion.outcome !== 'drained' ||
        completion.writtenFrames !== expectedFrames ||
        drainedFrames !== expectedFrames
      ) {
        throw new Error(
          `PCM drain mismatch: expected ${expectedFrames} frames, observed ${drainedFrames} (${completion.outcome}).`,
        );
      }
      if (!Number.isInteger(completion.underrunCount)) {
        throw new Error(
          'The installed native PCM player is out of date. Rebuild the development client and retry.',
        );
      }
      if (completion.underrunCount !== 0) {
        throw new Error(
          `PCM playback starved ${completion.underrunCount} time(s) while audio was being fed.`,
        );
      }

      this.patchState({
        drainedFrames,
        formatRestart: 'pending',
        phase: 'restarting',
        underrunCount: completion.underrunCount,
      });
      await pcmStreamPlayer.start({
        channels: 1,
        sampleRate: RESTART_SAMPLE_RATE,
      });
      if (attempt !== this.attempt) return;
      const cancellationFramesPerChunk =
        (RESTART_SAMPLE_RATE * CHUNK_DURATION_MS) / 1_000;
      const cancellationBytesPerChunk =
        cancellationFramesPerChunk * Int16Array.BYTES_PER_ELEMENT;
      const cancellationPcm = createWindowedTone({
        amplitude: 0.1,
        durationMs: CANCELLATION_DURATION_MS,
        frequencyHz: 330,
        sampleRate: RESTART_SAMPLE_RATE,
      });
      for (
        let byteOffset = 0;
        byteOffset < cancellationPcm.byteLength;
        byteOffset += cancellationBytesPerChunk
      ) {
        pcmStreamPlayer.write(
          cancellationPcm.subarray(
            byteOffset,
            Math.min(
              byteOffset + cancellationBytesPerChunk,
              cancellationPcm.byteLength,
            ),
          ),
        );
      }
      await waitForPlaybackStart();
      await delay(150);
      this.patchState({ formatRestart: 'passed', phase: 'cancelling' });
      const stopCompletion = await pcmStreamPlayer.stop();
      const status = await pcmStreamPlayer.getStatus();
      if (status.state !== 'idle' || stopCompletion?.outcome !== 'stopped') {
        throw new Error(
          'PCM cancellation did not return the native player to idle.',
        );
      }

      if (attempt !== this.attempt) return;
      this.replaceState({
        cancellation: 'stopped',
        drainedFrames,
        expectedFrames,
        firstChunkLatencyMs,
        formatRestart: 'passed',
        phase: 'passed',
        underrunCount: completion.underrunCount,
      });
    } catch (error) {
      if (attempt !== this.attempt) return;
      await pcmStreamPlayer.stop().catch(() => undefined);
      this.patchState({ error: normalizeError(error), phase: 'failed' });
    } finally {
      subscription.remove();
    }
  }

  stop() {
    const attempt = ++this.attempt;
    if (this.state.phase !== 'idle') {
      this.patchState({ phase: 'stopping' });
    }
    void pcmStreamPlayer.stop().finally(() => {
      if (attempt === this.attempt) this.replaceState(INITIAL_STATE);
    });
  }

  private patchState(patch: Partial<PcmPlaybackProofState>) {
    this.replaceState({ ...this.state, ...patch });
  }

  private replaceState(state: PcmPlaybackProofState) {
    this.state = state;
    for (const listener of this.listeners) listener(state);
  }
}

function createProofToneSequence() {
  const frequencies = [440, 660, 880];
  const silentPrerollFrames = Math.round(
    (STREAM_SAMPLE_RATE * SILENT_PREROLL_MS) / 1_000,
  );
  const toneFrames = Math.round(
    (STREAM_SAMPLE_RATE * TONE_DURATION_MS) / 1_000,
  );
  const toneGapFrames = Math.round((STREAM_SAMPLE_RATE * TONE_GAP_MS) / 1_000);
  const silentPostrollFrames = Math.round(
    (STREAM_SAMPLE_RATE * SILENT_POSTROLL_MS) / 1_000,
  );
  const totalFrames =
    silentPrerollFrames +
    toneFrames * frequencies.length +
    toneGapFrames * (frequencies.length - 1) +
    silentPostrollFrames;
  const pcm = new Uint8Array(totalFrames * Int16Array.BYTES_PER_ELEMENT);
  let byteOffset = silentPrerollFrames * Int16Array.BYTES_PER_ELEMENT;
  for (const [index, frequencyHz] of frequencies.entries()) {
    const tone = createWindowedTone({
      amplitude: 0.1,
      durationMs: TONE_DURATION_MS,
      frequencyHz,
      sampleRate: STREAM_SAMPLE_RATE,
    });
    pcm.set(tone, byteOffset);
    byteOffset += tone.byteLength;
    if (index < frequencies.length - 1) {
      byteOffset += toneGapFrames * Int16Array.BYTES_PER_ELEMENT;
    }
  }
  return pcm;
}

function createWindowedTone({
  amplitude,
  durationMs,
  frequencyHz,
  sampleRate,
}: {
  amplitude: number;
  durationMs: number;
  frequencyHz: number;
  sampleRate: number;
}) {
  const tone = createToneChunk({
    amplitude,
    channels: 1,
    frameCount: Math.round((sampleRate * durationMs) / 1_000),
    frequencyHz,
    sampleRate,
    startFrame: 0,
  });
  const frameCount = tone.byteLength / Int16Array.BYTES_PER_ELEMENT;
  const edgeFrames = Math.min(
    Math.round((sampleRate * TONE_EDGE_MS) / 1_000),
    Math.floor(frameCount / 2),
  );
  const view = new DataView(tone.buffer, tone.byteOffset, tone.byteLength);

  for (let frame = 0; frame < frameCount; frame += 1) {
    const edgeDistance = Math.min(frame, frameCount - 1 - frame);
    if (edgeDistance >= edgeFrames) continue;
    const progress = edgeFrames <= 1 ? 0 : edgeDistance / (edgeFrames - 1);
    const gain = 0.5 - 0.5 * Math.cos(Math.PI * progress);
    const byteOffset = frame * Int16Array.BYTES_PER_ELEMENT;
    view.setInt16(
      byteOffset,
      Math.round(view.getInt16(byteOffset, true) * gain),
      true,
    );
  }
  return tone;
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error('PCM playback did not start in time.')),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function waitForPlaybackStart() {
  const deadline = performance.now() + FIRST_CHUNK_TIMEOUT_MS;
  while (performance.now() < deadline) {
    const status = await pcmStreamPlayer.getStatus();
    if (status.state === 'playing' || status.state === 'draining') return;
    await delay(10);
  }
  throw new Error('PCM playback did not restart at the new sample rate.');
}

function normalizeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message
      .replace(/[\r\n\t]+/g, ' ')
      .trim()
      .slice(0, 300) || 'PCM playback proof failed.'
  );
}
