import {
  AudioContext,
  AudioManager,
  type AudioBufferQueueSourceNode,
  type AudioEventSubscription,
  type GainNode,
} from 'react-native-audio-api';
import { AppState, Platform, type NativeEventSubscription } from 'react-native';

import {
  decodeInterleavedInt16Pcm,
  PCM_MAX_QUEUED_SECONDS,
  StreamingPcmResampler,
  type ResampledPcmBlock,
  type PcmFormat,
  validatePcmChunk,
  validatePcmFormat,
} from '@/native/pcm-player-contract';

// Queue enough audio to absorb ordinary React Native scheduling stalls while
// still beginning playback well before a complete Hermes response arrives.
const PRIME_DURATION_MS = 600;
const NATIVE_BUFFER_DURATION_MS = 600;
const DRAIN_GRACE_MS = 3_000;
const START_EDGE_FADE_MS = 15;
const STOP_EDGE_FADE_MS = 15;
const STOP_SILENCE_HOLD_MS = 40;
const AUDIO_CONTEXT_IDLE_TIMEOUT_MS = 5_000;
const BACKGROUND_CONFIRMATION_MS = 250;

export type PcmPlaybackState = 'buffering' | 'draining' | 'idle' | 'playing';

export type PcmPlaybackOutcome =
  | 'backgrounded'
  | 'destroyed'
  | 'drained'
  | 'failed'
  | 'interrupted'
  | 'stopped';

export interface PcmPlaybackCompletion {
  outcome: PcmPlaybackOutcome;
  playedFrames: number;
  underrunCount: number;
  writtenFrames: number;
}

export interface PcmPlaybackEvent {
  channels: number;
  playedFrames: number;
  queuedDurationMs: number;
  reason?: PcmPlaybackOutcome;
  sampleRate: number;
  state: PcmPlaybackState;
  underrunCount: number;
  writtenFrames: number;
}

interface PcmPlaybackSubscription {
  remove(): void;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

interface PendingPcmChunk {
  bytes: Uint8Array<ArrayBuffer>;
  offset: number;
}

interface PcmPlaybackSession {
  appStateSubscription?: NativeEventSubscription;
  bufferFrames: Map<string, number>;
  cleanupPromise?: Promise<PcmPlaybackCompletion>;
  context: AudioContext;
  drainTimer?: ReturnType<typeof setTimeout>;
  failureMessage?: string;
  finishDeferred: Deferred<PcmPlaybackCompletion>;
  finishing: boolean;
  format: PcmFormat;
  gain: GainNode;
  gainRampEndsAt?: number;
  gainRampStartedAt?: number;
  interruptionSubscription?: AudioEventSubscription;
  pendingByteLength: number;
  pendingChunks: PendingPcmChunk[];
  playedFrames: number;
  queuedFrames: number;
  resampler: StreamingPcmResampler;
  source: AudioBufferQueueSourceNode;
  started: boolean;
  state: Exclude<PcmPlaybackState, 'idle'>;
  underrunCount: number;
  writtenFrames: number;
}

class PcmStreamPlayer {
  private context: AudioContext | undefined;
  private contextBackgroundTimer: ReturnType<typeof setTimeout> | undefined;
  private contextClosePromise: Promise<void> | undefined;
  private contextIdleAppStateSubscription: NativeEventSubscription | undefined;
  private contextIdleTimer: ReturnType<typeof setTimeout> | undefined;
  private interruptionObservationActive = false;
  private listeners = new Set<(event: PcmPlaybackEvent) => void>();
  private retiredStoppedSessions = new Set<PcmPlaybackSession>();
  private session: PcmPlaybackSession | undefined;
  private starting = false;

  async start(format: PcmFormat) {
    validatePcmFormat(format);
    if (this.session || this.starting) {
      throw new Error('A PCM playback session is already active.');
    }
    if (AppState.currentState === 'background') {
      throw new Error('PCM playback cannot start while Wave is backgrounded.');
    }
    this.starting = true;

    let context: AudioContext;
    try {
      // Let Oboe/Core Audio open at the device's preferred output rate. Wave
      // resamples each bounded buffer before enqueueing instead of asking
      // Android's output stream to run at (for Hermes) 24 kHz.
      context = await this.acquireContext();
      AudioManager.setAudioSessionOptions({
        iosCategory: 'playback',
        iosMode: 'spokenAudio',
        iosOptions: ['allowAirPlay', 'allowBluetoothA2DP'],
        iosNotifyOthersOnDeactivation: true,
      });
      if (!this.interruptionObservationActive) {
        AudioManager.observeAudioInterruptions('gainTransient');
        this.interruptionObservationActive = true;
      }
    } catch (error) {
      this.stopInterruptionObservation();
      this.starting = false;
      throw error;
    }

    let source: AudioBufferQueueSourceNode;
    let gain: GainNode;
    try {
      source = context.createBufferQueueSource({
        pitchCorrection: false,
      });
      gain = context.createGain();
      gain.gain.value = 0;
      source.connect(gain);
      gain.connect(context.destination);
    } catch (error) {
      await this.closeContext(context);
      this.starting = false;
      throw error;
    }

    const finishDeferred = deferred<PcmPlaybackCompletion>();
    const session: PcmPlaybackSession = {
      bufferFrames: new Map<string, number>(),
      context,
      finishDeferred,
      finishing: false,
      format: { ...format },
      gain,
      pendingByteLength: 0,
      pendingChunks: [],
      playedFrames: 0,
      queuedFrames: 0,
      resampler: new StreamingPcmResampler(
        format.sampleRate,
        context.sampleRate,
      ),
      source,
      started: false,
      state: 'buffering' as const,
      underrunCount: 0,
      writtenFrames: 0,
    };

    source.onBufferEnded = (event) => this.handleBufferEnded(session, event);
    session.appStateSubscription = AppState.addEventListener(
      'change',
      (nextState) => {
        if (nextState === 'background' || nextState === 'inactive') {
          void this.completeSession(session, 'backgrounded');
        }
      },
    );
    session.interruptionSubscription = AudioManager.addSystemEventListener(
      'interruption',
      (event) => {
        if (event.type === 'began') {
          void this.completeSession(session, 'interrupted');
        }
      },
    );

    this.session = session;
    this.starting = false;
    this.emitSession(session);
  }

  write(data: Uint8Array) {
    const session = this.requireSession();
    if (session.finishing) {
      throw new Error('The PCM playback session is already draining.');
    }

    validatePcmChunk(data, session.format.channels);
    const frames =
      data.byteLength /
      (session.format.channels * Int16Array.BYTES_PER_ELEMENT);
    const maximumQueuedFrames =
      session.format.sampleRate * PCM_MAX_QUEUED_SECONDS;
    if (session.queuedFrames + frames > maximumQueuedFrames) {
      throw new Error('The PCM playback queue exceeded its bounded capacity.');
    }

    session.pendingChunks.push({
      bytes: new Uint8Array(data),
      offset: 0,
    });
    session.pendingByteLength += data.byteLength;
    session.queuedFrames += frames;
    session.writtenFrames += frames;

    try {
      this.flushPendingBatches(session, false);
    } catch (error) {
      void this.completeSession(session, 'failed', normalizeError(error));
      throw error;
    }

    if (session.started && session.state === 'buffering') {
      session.state = 'playing';
    } else if (
      !session.started &&
      session.queuedFrames >= this.primeFrames(session)
    ) {
      this.beginPlayback(session);
    }
    this.emitSession(session);
  }

  async finish(): Promise<PcmPlaybackCompletion> {
    const session = this.requireSession();
    if (session.finishing) {
      throw new Error('The PCM playback session is already draining.');
    }

    try {
      this.flushPendingBatches(session, true);
      this.enqueueResampledBuffer(session, session.resampler.finish());
    } catch (error) {
      await this.completeSession(session, 'failed', normalizeError(error));
      throw error;
    }

    session.finishing = true;
    session.state = 'draining';
    if (session.writtenFrames === session.playedFrames) {
      return this.completeSession(session, 'drained');
    }

    if (!session.started) this.beginPlayback(session);
    const remainingDurationMs =
      (session.queuedFrames / session.format.sampleRate) * 1_000;
    session.drainTimer = setTimeout(
      () => {
        void this.completeSession(
          session,
          'failed',
          'PCM playback did not drain within its bounded deadline.',
        );
      },
      Math.ceil(remainingDurationMs) + DRAIN_GRACE_MS,
    );
    this.emitSession(session);

    const completion = await session.finishDeferred.promise;
    if (completion.outcome === 'failed') {
      throw new Error(session.failureMessage ?? 'PCM playback failed.');
    }
    return completion;
  }

  async stop(): Promise<PcmPlaybackCompletion | undefined> {
    const session = this.session;
    if (!session) return undefined;
    return this.completeSession(session, 'stopped');
  }

  async getStatus(): Promise<PcmPlaybackEvent> {
    const session = this.session;
    return session ? this.statusForSession(session) : idleStatus();
  }

  subscribe(
    listener: (event: PcmPlaybackEvent) => void,
  ): PcmPlaybackSubscription {
    this.listeners.add(listener);
    return { remove: () => this.listeners.delete(listener) };
  }

  private flushPendingBatches(
    session: PcmPlaybackSession,
    includeRemainder: boolean,
  ) {
    const bytesPerFrame =
      session.format.channels * Int16Array.BYTES_PER_ELEMENT;
    const batchFrames = Math.ceil(
      (session.format.sampleRate * NATIVE_BUFFER_DURATION_MS) / 1_000,
    );
    const batchBytes = batchFrames * bytesPerFrame;

    while (session.pendingByteLength >= batchBytes) {
      this.enqueueNativeBuffer(
        session,
        this.takePendingBytes(session, batchBytes),
      );
    }
    if (includeRemainder && session.pendingByteLength > 0) {
      this.enqueueNativeBuffer(
        session,
        this.takePendingBytes(session, session.pendingByteLength),
      );
    }
  }

  private takePendingBytes(session: PcmPlaybackSession, byteLength: number) {
    const output = new Uint8Array(byteLength);
    let outputOffset = 0;

    while (outputOffset < byteLength) {
      const chunk = session.pendingChunks[0];
      if (!chunk) {
        throw new Error('The pending PCM queue became inconsistent.');
      }
      const available = chunk.bytes.byteLength - chunk.offset;
      const copyLength = Math.min(available, byteLength - outputOffset);
      output.set(
        chunk.bytes.subarray(chunk.offset, chunk.offset + copyLength),
        outputOffset,
      );
      chunk.offset += copyLength;
      outputOffset += copyLength;
      if (chunk.offset === chunk.bytes.byteLength) {
        session.pendingChunks.shift();
      }
    }

    session.pendingByteLength -= byteLength;
    return output;
  }

  private enqueueNativeBuffer(
    session: PcmPlaybackSession,
    bytes: Uint8Array<ArrayBuffer>,
  ) {
    const sourceChannelData = decodeInterleavedInt16Pcm(
      bytes,
      session.format.channels,
    );
    this.enqueueResampledBuffer(
      session,
      session.resampler.append(sourceChannelData),
    );
  }

  private enqueueResampledBuffer(
    session: PcmPlaybackSession,
    block: ResampledPcmBlock,
  ) {
    const { channelData, sourceFrames } = block;
    const nativeFrames = channelData[0].length;
    if (nativeFrames === 0) {
      if (sourceFrames !== 0) {
        throw new Error('PCM resampling produced no playable output.');
      }
      return;
    }
    const audioBuffer = session.context.createBuffer(
      session.format.channels,
      nativeFrames,
      session.context.sampleRate,
    );
    for (let channel = 0; channel < session.format.channels; channel += 1) {
      audioBuffer.copyToChannel(channelData[channel], channel);
    }

    const bufferId = session.source.enqueueBuffer(audioBuffer);
    session.bufferFrames.set(bufferId, sourceFrames);
  }

  private beginPlayback(session: PcmPlaybackSession) {
    if (this.session !== session || session.started) return;
    try {
      // 0.13.2's queue wrapper defaults offset to -1 even though its own
      // public validation rejects negative offsets. Make the intended start
      // of the first queued buffer explicit.
      const now = session.context.currentTime;
      const rampEndsAt = now + START_EDGE_FADE_MS / 1_000;
      session.gainRampStartedAt = now;
      session.gainRampEndsAt = rampEndsAt;
      session.gain.gain.setValueAtTime(0, now);
      session.gain.gain.linearRampToValueAtTime(1, rampEndsAt);
      session.source.start(0, 0);
      session.started = true;
      session.state = session.finishing ? 'draining' : 'playing';
    } catch (error) {
      const message = normalizeError(error);
      void this.completeSession(session, 'failed', message);
      throw error;
    }
  }

  private handleBufferEnded(
    session: PcmPlaybackSession,
    event: { bufferId: string; isLastBufferInQueue: boolean },
  ) {
    if (this.session !== session) return;
    const frames = session.bufferFrames.get(event.bufferId);
    if (frames === undefined) return;

    session.bufferFrames.delete(event.bufferId);
    session.queuedFrames = Math.max(0, session.queuedFrames - frames);
    session.playedFrames += frames;

    if (
      session.finishing &&
      session.queuedFrames === 0 &&
      session.playedFrames === session.writtenFrames
    ) {
      void this.completeSession(session, 'drained');
      return;
    }

    if (!session.finishing && event.isLastBufferInQueue) {
      session.underrunCount += 1;
      if (session.pendingByteLength > 0) {
        try {
          this.flushPendingBatches(session, true);
          session.state = 'playing';
        } catch (error) {
          void this.completeSession(session, 'failed', normalizeError(error));
          return;
        }
      } else {
        session.state = 'buffering';
      }
    }
    this.emitSession(session);
  }

  private completeSession(
    session: PcmPlaybackSession,
    outcome: PcmPlaybackOutcome,
    failureMessage?: string,
  ): Promise<PcmPlaybackCompletion> {
    if (session.cleanupPromise) return session.cleanupPromise;
    session.failureMessage = failureMessage;
    session.cleanupPromise = this.cleanupSession(session, outcome);
    return session.cleanupPromise;
  }

  private async cleanupSession(
    session: PcmPlaybackSession,
    outcome: PcmPlaybackOutcome,
  ): Promise<PcmPlaybackCompletion> {
    if (session.drainTimer) clearTimeout(session.drainTimer);
    session.appStateSubscription?.remove();
    session.interruptionSubscription?.remove();

    if (outcome === 'stopped' && session.started) {
      try {
        const now = session.context.currentTime;
        const rampStartedAt = session.gainRampStartedAt ?? now;
        const rampEndsAt = session.gainRampEndsAt ?? rampStartedAt;
        const currentGain =
          rampEndsAt <= rampStartedAt || now >= rampEndsAt
            ? 1
            : Math.max(
                0,
                Math.min(
                  1,
                  (now - rampStartedAt) / (rampEndsAt - rampStartedAt),
                ),
              );
        session.gain.gain.cancelScheduledValues(now);
        session.gain.gain.setValueAtTime(currentGain, now);
        session.gain.gain.linearRampToValueAtTime(
          0,
          now + STOP_EDGE_FADE_MS / 1_000,
        );
        // Keep the graph alive at zero gain for more than one ordinary Android
        // mixer period. Android queue nodes stay muted until the retained
        // context closes after its bounded idle window.
        await delay(STOP_EDGE_FADE_MS + STOP_SILENCE_HOLD_MS);
      } catch {
        // A rejected ramp falls back to the deterministic stop below.
      }
    }

    session.source.onBufferEnded = null;

    const retireStoppedSource =
      Platform.OS === 'android' && outcome === 'stopped' && session.started;
    if (session.started && !retireStoppedSource) {
      try {
        session.source.stop();
      } catch {
        // The native source may already have stopped after consuming its queue.
      }
    }
    if (retireStoppedSource) {
      this.retiredStoppedSessions.add(session);
    } else {
      try {
        session.source.clearBuffers();
        session.source.disconnect();
        session.gain.disconnect();
      } catch {
        // The bounded context teardown remains authoritative if disconnection fails.
      }
    }
    session.pendingChunks = [];
    session.pendingByteLength = 0;

    if (this.session === session) this.session = undefined;
    if (outcome === 'drained' || outcome === 'stopped') {
      this.releaseContextWhenIdle(session.context);
    } else {
      await this.closeContext(session.context);
    }

    const completion = {
      outcome,
      playedFrames: session.playedFrames,
      underrunCount: session.underrunCount,
      writtenFrames: session.writtenFrames,
    } satisfies PcmPlaybackCompletion;

    this.emit({
      channels: session.format.channels,
      playedFrames: session.playedFrames,
      queuedDurationMs: 0,
      reason: outcome,
      sampleRate: session.format.sampleRate,
      state: 'idle',
      underrunCount: session.underrunCount,
      writtenFrames: session.writtenFrames,
    });
    session.finishDeferred.resolve(completion);
    return completion;
  }

  private async acquireContext() {
    this.cancelIdleContextClose();
    if (this.context) return this.context;
    if (this.contextClosePromise) await this.contextClosePromise;

    const context = new AudioContext();
    this.context = context;
    return context;
  }

  private releaseContextWhenIdle(context: AudioContext) {
    if (this.context !== context) return;
    this.cancelIdleContextClose();

    const closeIfIdle = () => {
      if (!this.session) void this.closeContext(context);
    };
    this.contextIdleTimer = setTimeout(
      closeIfIdle,
      AUDIO_CONTEXT_IDLE_TIMEOUT_MS,
    );
    this.contextIdleAppStateSubscription = AppState.addEventListener(
      'change',
      (nextState) => {
        if (nextState !== 'background' && nextState !== 'inactive') return;
        if (this.contextBackgroundTimer) {
          clearTimeout(this.contextBackgroundTimer);
        }
        this.contextBackgroundTimer = setTimeout(() => {
          this.contextBackgroundTimer = undefined;
          if (AppState.currentState !== 'active') closeIfIdle();
        }, BACKGROUND_CONFIRMATION_MS);
      },
    );
  }

  private cancelIdleContextClose() {
    if (this.contextBackgroundTimer) {
      clearTimeout(this.contextBackgroundTimer);
    }
    this.contextBackgroundTimer = undefined;
    if (this.contextIdleTimer) clearTimeout(this.contextIdleTimer);
    this.contextIdleTimer = undefined;
    this.contextIdleAppStateSubscription?.remove();
    this.contextIdleAppStateSubscription = undefined;
  }

  private async closeContext(context: AudioContext) {
    if (this.context !== context) return;
    this.cancelIdleContextClose();
    this.context = undefined;

    const closePromise = (async () => {
      await context.close().catch(() => undefined);
      for (const session of this.retiredStoppedSessions) {
        if (session.context === context) {
          this.retiredStoppedSessions.delete(session);
        }
      }
      this.stopInterruptionObservation();
      await AudioManager.setAudioSessionActivity(false).catch(() => undefined);
    })();
    this.contextClosePromise = closePromise;
    await closePromise;
    if (this.contextClosePromise === closePromise) {
      this.contextClosePromise = undefined;
    }
  }

  private stopInterruptionObservation() {
    if (!this.interruptionObservationActive) return;
    AudioManager.observeAudioInterruptions(false);
    this.interruptionObservationActive = false;
  }

  private emitSession(session: PcmPlaybackSession) {
    this.emit(this.statusForSession(session));
  }

  private emit(event: PcmPlaybackEvent) {
    for (const listener of this.listeners) listener(event);
  }

  private primeFrames(session: PcmPlaybackSession) {
    return Math.ceil((session.format.sampleRate * PRIME_DURATION_MS) / 1_000);
  }

  private requireSession() {
    const session = this.session;
    if (!session) throw new Error('No PCM playback session is active.');
    return session;
  }

  private statusForSession(session: PcmPlaybackSession): PcmPlaybackEvent {
    return {
      channels: session.format.channels,
      playedFrames: session.playedFrames,
      queuedDurationMs: Math.round(
        (session.queuedFrames / session.format.sampleRate) * 1_000,
      ),
      sampleRate: session.format.sampleRate,
      state: session.state,
      underrunCount: session.underrunCount,
      writtenFrames: session.writtenFrames,
    };
  }
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function idleStatus(): PcmPlaybackEvent {
  return {
    channels: 0,
    playedFrames: 0,
    queuedDurationMs: 0,
    sampleRate: 0,
    state: 'idle',
    underrunCount: 0,
    writtenFrames: 0,
  };
}

function normalizeError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/** One native owner prevents overlapping gateway speech sessions. */
export const pcmStreamPlayer = new PcmStreamPlayer();
