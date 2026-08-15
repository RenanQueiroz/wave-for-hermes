/**
 * Hermes v0.20 clause-streamed speech: one per-reply WebSocket session.
 *
 * Protocol (verified against the upstream `speak_stream_ws` handler at
 * `v2026.8.13`): the client opens `/api/audio/speak-stream?ticket=<single-use>`
 * and sends `{"text": "..."}` frames as assistant narration arrives,
 * `{"done": true}` when the reply is complete, and `{"stop": true}` (or a
 * plain disconnect) as barge-in. The server answers either
 * `{"type": "fallback"}` — no chunked TTS provider, use buffered
 * `/api/audio/speak` — or `{"type": "start", "sample_rate": N, "channels": 1}`
 * followed by binary little-endian Int16 PCM frames and a final
 * `{"type": "end"}`. Binary frames are not sample-aligned; the odd tail of a
 * frame is carried into the next one.
 *
 * This module owns the transport contract from AGENTS.md Stage 4b: bounded
 * inbound frames, explicit timeouts, one playback owner, the admission ledger
 * with its six-second high-water mark under the player's 12-second hard
 * capacity, and the non-replaying fallback decision. It never retries,
 * reconnects, or replays an ambiguously failed socket. The injected playback
 * owner receives only validated audio bytes — never a URL, token, provider
 * identifier, or transcript.
 */

/** Six seconds of admitted-but-unplayed audio; below the player's 12 s cap. */
export const SPEECH_STREAM_HIGH_WATER_MS = 6_000;
/** Admission slice so pacing decisions stay fine-grained under the high water. */
const ADMISSION_SLICE_MS = 1_000;
/**
 * Un-admitted audio the ledger will hold while the player drains. A healthy
 * provider synthesizes clause bursts near real time; a producer that outruns
 * playback by a full minute is runaway and fails the stream deterministically.
 */
export const SPEECH_STREAM_MAX_PENDING_MS = 60_000;
/** Hard per-session audio bound; far above any reply Wave feeds for speech. */
export const SPEECH_STREAM_MAX_SESSION_AUDIO_MS = 900_000;
/** One inbound binary frame; matches the playback owner's chunk bound. */
export const SPEECH_STREAM_MAX_BINARY_FRAME_BYTES = 512 * 1024;
/** Inbound control frames are tiny JSON; anything larger is a violation. */
const MAX_INBOUND_CONTROL_CHARS = 4_096;
/** Total narration characters fed to one session; excess is not spoken. */
export const SPEECH_STREAM_MAX_TEXT_CHARS = 16_000;

// The protocol accepts exactly the playback owner's format envelope. The
// bounds are deliberately restated here: this module owns the wire contract,
// the native player revalidates its own contract at start/write time.
const MIN_SAMPLE_RATE = 8_000;
const MAX_SAMPLE_RATE = 48_000;

const DEFAULT_TIMEOUTS = {
  /** Connect + upgrade + the server's start-or-fallback decision. */
  connectToStartMs: 20_000,
  /** Synthesis tail after `done` is model work, like buffered speech. */
  doneToEndMs: 90_000,
  /** Grace beyond the remaining audio duration for the final drain. */
  drainGraceMs: 30_000,
};

export type GatewaySpeechStreamTimeouts = typeof DEFAULT_TIMEOUTS;

export interface GatewaySpeechFormat {
  channels: 1 | 2;
  sampleRate: number;
}

/**
 * How the session ended, which is also the caller's fallback authority:
 * `unspoken` proves no streamed audio ever became audible, so synthesizing
 * the complete reply through buffered `/api/audio/speak` cannot repeat
 * anything. `incomplete` means audio was audible and no clause boundary can
 * be proven, so the reply must stay text-only — never re-spoken.
 */
export type GatewaySpeechStreamResult =
  | { outcome: 'completed' }
  | { outcome: 'incomplete' }
  | { outcome: 'skipped' }
  | { outcome: 'unspoken'; reason: 'error' | 'fallback' };

/** The socket surface the session drives; matches the platform WebSocket. */
export interface SpeechSocketLike {
  binaryType?: string;
  close(code?: number, reason?: string): void;
  onclose: ((event?: unknown) => void) | null;
  onerror: ((event?: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onopen: ((event?: unknown) => void) | null;
  send(data: string): void;
}

export interface SpeechPlaybackStatus {
  playedFrames: number;
  queuedDurationMs: number;
  reason?: string;
  state: 'buffering' | 'draining' | 'idle' | 'playing';
}

/**
 * Structural subset of the app's singleton PCM stream player. Injected so the
 * gateway module never imports native code and tests can observe admission.
 */
export interface SpeechPlaybackOwner {
  finish(): Promise<{ outcome: string }>;
  start(format: GatewaySpeechFormat): Promise<void>;
  stop(): Promise<unknown>;
  subscribe(listener: (event: SpeechPlaybackStatus) => void): {
    remove(): void;
  };
  write(chunk: Uint8Array): void;
}

export interface GatewaySpeechStream {
  /** Feed sanitized narration; silently capped, inert after finish/stop. */
  appendText(text: string): void;
  /** The reply text is complete; the server may finish synthesis. */
  finishText(): void;
  /** Resolves exactly once with the terminal outcome. Never rejects. */
  result(): Promise<GatewaySpeechStreamResult>;
  /** Barge-in / teardown: stop audio now and end the session as `skipped`. */
  stop(): void;
}

export interface GatewaySpeechStreamOptions {
  /** Mints the credential and returns a connecting socket. Called once. */
  connect(): Promise<SpeechSocketLike>;
  player: SpeechPlaybackOwner;
  timeouts?: Partial<GatewaySpeechStreamTimeouts>;
}

interface PendingChunk {
  bytes: Uint8Array;
  offset: number;
}

/** A session that resolves `unspoken` without dialing; used by the cache. */
export function createUnavailableSpeechStream(
  reason: 'error' | 'fallback',
): GatewaySpeechStream {
  const result: GatewaySpeechStreamResult = { outcome: 'unspoken', reason };
  return {
    appendText: () => undefined,
    finishText: () => undefined,
    result: () => Promise.resolve(result),
    stop: () => undefined,
  };
}

export function createGatewaySpeechStream(
  options: GatewaySpeechStreamOptions,
): GatewaySpeechStream {
  return new GatewaySpeechStreamSession(options);
}

class GatewaySpeechStreamSession implements GatewaySpeechStream {
  private readonly player: SpeechPlaybackOwner;
  private readonly timeouts: GatewaySpeechStreamTimeouts;

  private socket: SpeechSocketLike | undefined;
  private socketOpen = false;
  private readonly outboundQueue: string[] = [];

  private format: GatewaySpeechFormat | undefined;
  private carry: Uint8Array | undefined;
  private readonly pendingChunks: PendingChunk[] = [];
  private pendingFrames = 0;
  private receivedFrames = 0;
  private admittedFrames = 0;
  private playedFrames = 0;

  private playerPhase: 'finishing' | 'idle' | 'started' | 'starting' = 'idle';
  private playerSubscription: { remove(): void } | undefined;
  private becameAudible = false;

  private fedTextChars = 0;
  private doneSent = false;
  private serverEnded = false;

  private startTimer: ReturnType<typeof setTimeout> | undefined;
  private doneTimer: ReturnType<typeof setTimeout> | undefined;
  private drainTimer: ReturnType<typeof setTimeout> | undefined;

  private terminal: GatewaySpeechStreamResult | undefined;
  private resolveResult!: (result: GatewaySpeechStreamResult) => void;
  private readonly resultPromise: Promise<GatewaySpeechStreamResult>;

  constructor(options: GatewaySpeechStreamOptions) {
    this.player = options.player;
    this.timeouts = { ...DEFAULT_TIMEOUTS, ...options.timeouts };
    this.resultPromise = new Promise((resolve) => {
      this.resolveResult = resolve;
    });
    this.playerSubscription = this.player.subscribe((event) =>
      this.handlePlayerEvent(event),
    );
    this.startTimer = setTimeout(() => {
      this.fail('The gateway did not start streamed speech in time.');
    }, this.timeouts.connectToStartMs);
    void this.open(options.connect);
  }

  result(): Promise<GatewaySpeechStreamResult> {
    return this.resultPromise;
  }

  appendText(text: string): void {
    if (this.terminal || this.doneSent || !text) return;
    const remaining = SPEECH_STREAM_MAX_TEXT_CHARS - this.fedTextChars;
    if (remaining <= 0) return;
    const bounded = text.slice(0, remaining);
    this.fedTextChars += bounded.length;
    this.send({ text: bounded });
  }

  finishText(): void {
    if (this.terminal || this.doneSent) return;
    this.doneSent = true;
    this.send({ done: true });
    this.doneTimer = setTimeout(() => {
      this.fail('The gateway did not finish streamed speech in time.');
    }, this.timeouts.doneToEndMs);
  }

  stop(): void {
    if (this.terminal) return;
    try {
      if (this.socketOpen) this.socket?.send(JSON.stringify({ stop: true }));
    } catch {
      // The socket may already be dead; disconnect is also barge-in upstream.
    }
    this.settle({ outcome: 'skipped' });
  }

  // ---- socket ------------------------------------------------------------

  private async open(connect: () => Promise<SpeechSocketLike>) {
    let socket: SpeechSocketLike;
    try {
      socket = await connect();
    } catch {
      this.fail('Wave could not open the speech stream.');
      return;
    }
    if (this.terminal) {
      try {
        socket.close();
      } catch {
        // Already closed.
      }
      return;
    }
    this.socket = socket;
    try {
      socket.binaryType = 'arraybuffer';
    } catch {
      // Platforms without a configurable binaryType still deliver ArrayBuffers.
    }
    socket.onopen = () => {
      this.socketOpen = true;
      for (const frame of this.outboundQueue.splice(0)) {
        try {
          socket.send(frame);
        } catch {
          this.fail('Wave lost the speech stream.');
          return;
        }
      }
    };
    socket.onmessage = (message) => this.handleMessage(message.data);
    socket.onerror = () => this.handleSocketGone();
    socket.onclose = () => this.handleSocketGone();
  }

  private send(frame: Record<string, unknown>) {
    const serialized = JSON.stringify(frame);
    if (!this.socketOpen || !this.socket) {
      this.outboundQueue.push(serialized);
      return;
    }
    try {
      this.socket.send(serialized);
    } catch {
      this.fail('Wave lost the speech stream.');
    }
  }

  private handleSocketGone() {
    if (this.terminal) return;
    // After `end` the server closes its side; playback keeps draining and the
    // player completion decides the outcome. Any earlier close is a failure.
    if (this.serverEnded) return;
    if (this.format === undefined) {
      // An older gateway without the route refuses the upgrade here; the
      // reply is still safe to synthesize whole through the buffered path.
      this.fail('This gateway does not stream speech.');
      return;
    }
    this.fail('Wave lost the speech stream.');
  }

  private handleMessage(data: unknown) {
    if (this.terminal) return;
    if (typeof data === 'string') {
      this.handleControlFrame(data);
      return;
    }
    const bytes = toBytes(data);
    if (bytes === undefined) {
      this.fail('The speech stream sent an unsupported frame.');
      return;
    }
    this.handleBinaryFrame(bytes);
  }

  private handleControlFrame(data: string) {
    if (data.length > MAX_INBOUND_CONTROL_CHARS) {
      this.fail('The speech stream sent an oversized control frame.');
      return;
    }
    let frame: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(data);
      if (typeof parsed !== 'object' || parsed === null) throw new Error();
      frame = parsed as Record<string, unknown>;
    } catch {
      this.fail('The speech stream sent an unreadable control frame.');
      return;
    }
    switch (frame.type) {
      case 'start': {
        if (this.format !== undefined) {
          this.fail('The speech stream restarted unexpectedly.');
          return;
        }
        const format = readStartFormat(frame);
        if (!format) {
          this.fail('The speech stream announced an unsupported format.');
          return;
        }
        this.format = format;
        this.clearStartTimer();
        return;
      }
      case 'end': {
        this.serverEnded = true;
        if (this.doneTimer) clearTimeout(this.doneTimer);
        this.doneTimer = undefined;
        this.armDrainDeadline();
        this.maybeFinishPlayback();
        return;
      }
      case 'fallback': {
        // Sent only instead of `start` upstream. Defensively, audio already
        // admitted still forbids re-synthesis of the reply.
        if (this.receivedFrames > 0 || this.becameAudible) {
          this.fail('The speech stream fell back after audio started.');
          return;
        }
        this.settle({ outcome: 'unspoken', reason: 'fallback' });
        return;
      }
      default:
        // Unknown bounded control frames from future gateways stay ignored.
        return;
    }
  }

  private handleBinaryFrame(bytes: Uint8Array) {
    if (this.format === undefined) {
      this.fail('The speech stream sent audio before its format.');
      return;
    }
    if (bytes.byteLength > SPEECH_STREAM_MAX_BINARY_FRAME_BYTES) {
      this.fail('The speech stream sent an oversized audio frame.');
      return;
    }
    if (bytes.byteLength === 0) return;

    // Server frames are not sample-aligned: carry the incomplete interleaved
    // frame at the tail into the next chunk so the player only ever sees
    // whole little-endian Int16 frames.
    let combined: Uint8Array;
    if (this.carry && this.carry.byteLength > 0) {
      combined = new Uint8Array(this.carry.byteLength + bytes.byteLength);
      combined.set(this.carry, 0);
      combined.set(bytes, this.carry.byteLength);
    } else {
      combined = new Uint8Array(bytes);
    }
    const bytesPerFrame = this.format.channels * 2;
    const alignedBytes =
      combined.byteLength - (combined.byteLength % bytesPerFrame);
    this.carry =
      alignedBytes === combined.byteLength
        ? undefined
        : combined.subarray(alignedBytes);
    if (alignedBytes === 0) return;

    const frames = alignedBytes / bytesPerFrame;
    const maxSessionFrames = this.msToFrames(
      SPEECH_STREAM_MAX_SESSION_AUDIO_MS,
    );
    const maxPendingFrames = this.msToFrames(SPEECH_STREAM_MAX_PENDING_MS);
    if (this.receivedFrames + frames > maxSessionFrames) {
      this.fail('The speech stream exceeded its bounded audio length.');
      return;
    }
    if (this.pendingFrames + frames > maxPendingFrames) {
      // The producer outran playback by the whole pending bound. Admitting
      // more would grow without limit; failing here is the deterministic
      // non-replaying path required by Stage 4b.
      this.fail('The speech stream outran playback beyond its bound.');
      return;
    }

    this.receivedFrames += frames;
    this.pendingFrames += frames;
    this.pendingChunks.push({
      bytes: combined.subarray(0, alignedBytes),
      offset: 0,
    });
    this.pump();
  }

  // ---- admission ledger ---------------------------------------------------

  /**
   * Admit pending audio into the player only while the admitted-but-unplayed
   * duration stays under the six-second high-water mark. Played-frame counts
   * come from the player's own status reports, so admission resumes exactly
   * as audible playback drains. Slices are bounded so one admission decision
   * never spans more than a second of audio.
   */
  private pump() {
    if (this.terminal || this.format === undefined) return;
    if (this.playerPhase === 'idle') {
      if (this.pendingFrames === 0) return;
      this.playerPhase = 'starting';
      this.player.start(this.format).then(
        () => {
          if (this.terminal) return;
          this.playerPhase = 'started';
          this.playedFrames = 0;
          this.pump();
        },
        () => {
          this.playerPhase = 'idle';
          this.fail('Wave could not start streamed playback.');
        },
      );
      return;
    }
    if (this.playerPhase !== 'started') return;

    const highWaterFrames = this.msToFrames(SPEECH_STREAM_HIGH_WATER_MS);
    const sliceFrames = this.msToFrames(ADMISSION_SLICE_MS);
    while (this.pendingFrames > 0) {
      const queuedFrames = this.admittedFrames - this.playedFrames;
      const headroom = highWaterFrames - queuedFrames;
      if (headroom <= 0) return;
      const takeFrames = Math.min(headroom, sliceFrames, this.pendingFrames);
      const chunk = this.takePendingFrames(takeFrames);
      try {
        this.player.write(chunk);
      } catch {
        // The player's own hard bounds are the second deterministic limit.
        this.fail('Streamed playback rejected an audio frame.');
        return;
      }
      this.admittedFrames += takeFrames;
    }
    this.maybeFinishPlayback();
  }

  private takePendingFrames(frames: number): Uint8Array {
    const bytesPerFrame = (this.format?.channels ?? 1) * 2;
    const byteLength = frames * bytesPerFrame;
    const output = new Uint8Array(byteLength);
    let outputOffset = 0;
    while (outputOffset < byteLength) {
      const chunk = this.pendingChunks[0];
      if (!chunk) {
        throw new Error('The speech stream ledger became inconsistent.');
      }
      const available = chunk.bytes.byteLength - chunk.offset;
      const copyLength = Math.min(available, byteLength - outputOffset);
      output.set(
        chunk.bytes.subarray(chunk.offset, chunk.offset + copyLength),
        outputOffset,
      );
      chunk.offset += copyLength;
      outputOffset += copyLength;
      if (chunk.offset === chunk.bytes.byteLength) this.pendingChunks.shift();
    }
    this.pendingFrames -= frames;
    return output;
  }

  // ---- playback lifecycle -------------------------------------------------

  private handlePlayerEvent(event: SpeechPlaybackStatus) {
    if (this.terminal) return;
    // The player is an app-wide singleton: events observed before this
    // session's own start (a previous session's teardown) must not seed the
    // ledger with foreign frame counts.
    if (this.playerPhase === 'idle' || this.playerPhase === 'starting') return;
    this.playedFrames = event.playedFrames;
    if (event.state === 'playing' || event.state === 'draining') {
      this.becameAudible = true;
    }
    if (
      event.state === 'idle' &&
      event.reason !== undefined &&
      this.playerPhase === 'started'
    ) {
      // The player ended on its own: a background transition, an OS audio
      // interruption, or a native failure. `finish`/`stop` initiated by this
      // session settle through their own awaits instead.
      this.playerPhase = 'idle';
      if (event.reason === 'drained') {
        this.settle({ outcome: 'completed' });
      } else {
        this.fail('Streamed playback ended early.');
      }
      return;
    }
    this.pump();
  }

  private maybeFinishPlayback() {
    if (this.terminal || !this.serverEnded || this.pendingFrames > 0) return;
    if (this.playerPhase === 'starting' || this.playerPhase === 'finishing') {
      return;
    }
    if (this.playerPhase === 'idle' || this.admittedFrames === 0) {
      // The server finished without producing audio (an empty or fully
      // filtered reply). There is nothing to drain and nothing to fall back
      // to; the reply simply is not spoken.
      const started = this.playerPhase !== 'idle';
      this.settle({ outcome: 'completed' });
      if (started) void this.player.stop().catch(() => undefined);
      return;
    }
    this.playerPhase = 'finishing';
    this.player.finish().then(
      (completion) => {
        if (this.terminal) return;
        if (completion.outcome === 'drained') {
          this.settle({ outcome: 'completed' });
        } else {
          this.fail('Streamed playback ended early.');
        }
      },
      () => {
        this.fail('Streamed playback failed while draining.');
      },
    );
  }

  private armDrainDeadline() {
    if (this.drainTimer || this.format === undefined) return;
    // `receivedFrames` already counts pending audio: received = admitted + pending.
    const remainingFrames = this.receivedFrames - this.playedFrames;
    const remainingMs = Math.ceil(
      (Math.max(0, remainingFrames) / this.format.sampleRate) * 1_000,
    );
    this.drainTimer = setTimeout(() => {
      this.fail('Streamed playback did not drain in time.');
    }, remainingMs + this.timeouts.drainGraceMs);
  }

  // ---- terminal states ----------------------------------------------------

  /**
   * Every failure resolves through the audibility proof: audio that was never
   * audible keeps the complete-reply buffered fallback safe; anything after
   * first sound stays text-only because no spoken clause boundary is provable.
   */
  private fail(_message: string) {
    this.settle(
      this.becameAudible
        ? { outcome: 'incomplete' }
        : { outcome: 'unspoken', reason: 'error' },
    );
  }

  private settle(result: GatewaySpeechStreamResult) {
    if (this.terminal) return;
    this.terminal = result;
    this.clearStartTimer();
    if (this.doneTimer) clearTimeout(this.doneTimer);
    this.doneTimer = undefined;
    if (this.drainTimer) clearTimeout(this.drainTimer);
    this.drainTimer = undefined;
    this.playerSubscription?.remove();
    this.playerSubscription = undefined;
    this.pendingChunks.length = 0;
    this.pendingFrames = 0;
    this.carry = undefined;
    if (this.playerPhase !== 'idle' && result.outcome !== 'completed') {
      void this.player.stop().catch(() => undefined);
    }
    this.playerPhase = 'idle';
    const socket = this.socket;
    this.socket = undefined;
    if (socket) {
      socket.onclose = null;
      socket.onerror = null;
      socket.onmessage = null;
      socket.onopen = null;
      try {
        socket.close(1000, 'wave speech finished');
      } catch {
        // Already closed.
      }
    }
    this.resolveResult(result);
  }

  private clearStartTimer() {
    if (this.startTimer) clearTimeout(this.startTimer);
    this.startTimer = undefined;
  }

  private msToFrames(ms: number): number {
    const sampleRate = this.format?.sampleRate ?? MAX_SAMPLE_RATE;
    return Math.ceil((sampleRate * ms) / 1_000);
  }
}

function readStartFormat(
  frame: Record<string, unknown>,
): GatewaySpeechFormat | undefined {
  // The measured gateway always includes both fields; Hermes Desktop tolerates
  // their absence with the same defaults, and Wave matches that behavior.
  const sampleRate =
    frame.sample_rate === undefined ? 24_000 : frame.sample_rate;
  const channels = frame.channels === undefined ? 1 : frame.channels;
  if (
    typeof sampleRate !== 'number' ||
    !Number.isInteger(sampleRate) ||
    sampleRate < MIN_SAMPLE_RATE ||
    sampleRate > MAX_SAMPLE_RATE
  ) {
    return undefined;
  }
  if (channels !== 1 && channels !== 2) return undefined;
  return { channels, sampleRate };
}

function toBytes(data: unknown): Uint8Array | undefined {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) {
    const view = data as ArrayBufferView;
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  }
  return undefined;
}
