import { createToneChunk } from '@/native/pcm-player-contract';
import { pcmStreamPlayer, type PcmPlaybackEvent } from '@/native/pcm-player';

const STREAM_SAMPLE_RATE = 24_000;
const RESTART_SAMPLE_RATE = 48_000;
const CHUNK_DURATION_MS = 20;
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
}

const INITIAL_STATE: PcmPlaybackProofState = {
  cancellation: 'pending',
  drainedFrames: 0,
  expectedFrames: 0,
  formatRestart: 'pending',
  phase: 'idle',
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
      const chunksPerTone = 20;
      const frequencies = [440, 660, 880];
      const expectedFrames =
        framesPerChunk * chunksPerTone * frequencies.length;
      this.patchState({ expectedFrames });

      let startFrame = 0;
      for (const frequencyHz of frequencies) {
        for (let chunk = 0; chunk < chunksPerTone; chunk += 1) {
          if (attempt !== this.attempt) return;
          const data = createToneChunk({
            channels: 1,
            frameCount: framesPerChunk,
            frequencyHz,
            sampleRate: STREAM_SAMPLE_RATE,
            startFrame,
          });
          if (firstWriteStartedAt === undefined) {
            firstWriteStartedAt = performance.now();
          }
          await pcmStreamPlayer.write(data);
          startFrame += framesPerChunk;
          // Feed twice as fast as playback to exercise a real bounded queue
          // without relying on a complete generated file.
          await delay(CHUNK_DURATION_MS / 2);
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
      if (
        completion.outcome !== 'drained' ||
        completion.writtenFrames !== expectedFrames ||
        drainedFrames !== expectedFrames
      ) {
        throw new Error(
          `PCM drain mismatch: expected ${expectedFrames} frames, observed ${drainedFrames} (${completion.outcome}).`,
        );
      }

      this.patchState({
        drainedFrames,
        formatRestart: 'pending',
        phase: 'restarting',
      });
      await pcmStreamPlayer.start({
        channels: 1,
        sampleRate: RESTART_SAMPLE_RATE,
      });
      if (attempt !== this.attempt) return;
      const cancellationAudio = createToneChunk({
        channels: 1,
        frameCount: RESTART_SAMPLE_RATE * 2,
        frequencyHz: 330,
        sampleRate: RESTART_SAMPLE_RATE,
        startFrame: 0,
      });
      const pendingWrite = pcmStreamPlayer
        .write(cancellationAudio)
        .catch(() => undefined);
      await delay(150);
      this.patchState({ formatRestart: 'passed', phase: 'cancelling' });
      const stopCompletion = await pcmStreamPlayer.stop();
      await pendingWrite;
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

function normalizeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message
      .replace(/[\r\n\t]+/g, ' ')
      .trim()
      .slice(0, 300) || 'PCM playback proof failed.'
  );
}
