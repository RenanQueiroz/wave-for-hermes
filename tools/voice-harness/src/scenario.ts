/**
 * Harness scenarios: the scripted behavior of the fake gateway.
 *
 * A scenario is trusted local test input (loaded through the localhost-only
 * control listener), so validation is shape-normalizing rather than
 * adversarial — unknown fields are dropped, wrong types fall back to
 * defaults. Scenarios are data, never code.
 */

export interface HarnessTurnFrame {
  /** Milliseconds to wait before emitting this frame. */
  delayMs?: number;
  payload?: Record<string, unknown>;
  type: string;
}

export interface HarnessTurnScript {
  /**
   * Explicit gateway frames to play for this turn. When present, `reply` is
   * ignored and the script owns the whole turn including its terminal frame.
   */
  frames?: HarnessTurnFrame[];
  /** Convenience: stream this text as deltas and complete the turn with it. */
  reply?: string;
  /** Per-frame pacing for the generated `reply` frames. */
  replyDelayMs?: number;
}

export interface HarnessRedirectScript {
  /** Respond with a JSON-RPC error instead of a result. */
  errorCode?: number;
  errorMessage?: string;
  status?: 'queued' | 'redirected' | 'rejected';
}

export interface HarnessSpeechScript {
  /** Cap for the synthesized audio of one `{"text"}` frame. */
  maxMsPerText?: number;
  /** `fallback` answers `{"type":"fallback"}`; `stream` sends PCM. */
  mode?: 'fallback' | 'stream';
  /** Synthesized audio length per narration character. */
  msPerChar?: number;
  sampleRate?: number;
}

export interface HarnessTranscribeScript {
  delayMs?: number;
  /** Fail the next transcription with this HTTP status. */
  failWith?: number;
}

/** One scripted OpenAI-Realtime model behavior, executed in order. */
export type HarnessRealtimeStep =
  | { delayMs: number; type: 'delay' }
  | { text: string; type: 'assistant_speech' }
  | {
      arguments: Record<string, unknown> | string;
      callId?: string;
      name: string;
      type: 'function_call';
    }
  | { itemId?: string; transcript: string; type: 'user_speech' }
  | { type: 'wait_function_result' }
  | { type: 'wait_response_create' };

export interface HarnessRealtimeScript {
  /** Steps for the next Realtime sideband connection; FIFO per call. */
  script?: HarnessRealtimeStep[];
}

export interface HarnessScenario {
  audioCapabilities?: { stt: boolean; tts: boolean };
  /** FIFO of scripted Realtime calls (one entry per sideband connection). */
  realtimeCalls?: HarnessRealtimeScript[];
  /** FIFO of `session.redirect` outcomes; default is `redirected`. */
  redirects?: HarnessRedirectScript[];
  speech?: HarnessSpeechScript;
  transcribe?: HarnessTranscribeScript;
  /** FIFO of transcripts served by `/api/audio/transcribe`. */
  transcripts?: string[];
  /** FIFO of turn scripts consumed by `prompt.submit`. */
  turns?: HarnessTurnScript[];
}

export const DEFAULT_TRANSCRIPT = 'Hello from the harness.';

const MAX_TEXT_CHARS = 32_000;
const MAX_LIST_ENTRIES = 256;
const MAX_FRAMES_PER_TURN = 512;
const MAX_DELAY_MS = 60_000;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function boundedText(value: unknown): string | undefined {
  return typeof value === 'string' ? value.slice(0, MAX_TEXT_CHARS) : undefined;
}

function boundedDelay(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.min(Math.floor(value), MAX_DELAY_MS)
    : undefined;
}

function normalizeFrame(value: unknown): HarnessTurnFrame | undefined {
  const record = asRecord(value);
  const type = typeof record?.type === 'string' ? record.type : undefined;
  if (!record || !type) return undefined;
  const delayMs = boundedDelay(record.delayMs);
  const payload = asRecord(record.payload);
  return {
    type,
    ...(delayMs === undefined ? {} : { delayMs }),
    ...(payload === undefined ? {} : { payload }),
  };
}

function normalizeTurn(value: unknown): HarnessTurnScript {
  const record = asRecord(value) ?? {};
  const frames = Array.isArray(record.frames)
    ? record.frames
        .slice(0, MAX_FRAMES_PER_TURN)
        .flatMap((frame) => normalizeFrame(frame) ?? [])
    : undefined;
  const reply = boundedText(record.reply);
  const replyDelayMs = boundedDelay(record.replyDelayMs);
  return {
    ...(frames === undefined ? {} : { frames }),
    ...(reply === undefined ? {} : { reply }),
    ...(replyDelayMs === undefined ? {} : { replyDelayMs }),
  };
}

function normalizeRedirect(value: unknown): HarnessRedirectScript {
  const record = asRecord(value) ?? {};
  const status =
    record.status === 'queued' ||
    record.status === 'redirected' ||
    record.status === 'rejected'
      ? record.status
      : undefined;
  const errorCode =
    typeof record.errorCode === 'number' && Number.isInteger(record.errorCode)
      ? record.errorCode
      : undefined;
  const errorMessage = boundedText(record.errorMessage);
  return {
    ...(errorCode === undefined ? {} : { errorCode }),
    ...(errorMessage === undefined ? {} : { errorMessage }),
    ...(status === undefined ? {} : { status }),
  };
}

function normalizeRealtimeStep(
  value: unknown,
): HarnessRealtimeStep | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  switch (record.type) {
    case 'delay': {
      const delayMs = boundedDelay(record.delayMs);
      return delayMs === undefined ? undefined : { delayMs, type: 'delay' };
    }
    case 'assistant_speech': {
      const text = boundedText(record.text);
      return text === undefined
        ? undefined
        : { text, type: 'assistant_speech' };
    }
    case 'function_call': {
      const name = boundedText(record.name);
      if (!name) return undefined;
      const args =
        typeof record.arguments === 'string'
          ? record.arguments.slice(0, MAX_TEXT_CHARS)
          : (asRecord(record.arguments) ?? {});
      const callId = boundedText(record.callId);
      return {
        arguments: args,
        name,
        type: 'function_call',
        ...(callId === undefined ? {} : { callId }),
      };
    }
    case 'user_speech': {
      const transcript = boundedText(record.transcript);
      if (transcript === undefined) return undefined;
      const itemId = boundedText(record.itemId);
      return {
        transcript,
        type: 'user_speech',
        ...(itemId === undefined ? {} : { itemId }),
      };
    }
    case 'wait_function_result':
      return { type: 'wait_function_result' };
    case 'wait_response_create':
      return { type: 'wait_response_create' };
    default:
      return undefined;
  }
}

function normalizeRealtimeScript(value: unknown): HarnessRealtimeScript {
  const record = asRecord(value) ?? {};
  const script = Array.isArray(record.script)
    ? record.script
        .slice(0, MAX_FRAMES_PER_TURN)
        .flatMap((step) => normalizeRealtimeStep(step) ?? [])
    : undefined;
  return script === undefined ? {} : { script };
}

export function normalizeScenario(value: unknown): HarnessScenario {
  const record = asRecord(value) ?? {};
  const scenario: HarnessScenario = {};

  const capabilities = asRecord(record.audioCapabilities);
  if (capabilities) {
    scenario.audioCapabilities = {
      stt: capabilities.stt !== false,
      tts: capabilities.tts !== false,
    };
  }

  if (Array.isArray(record.transcripts)) {
    scenario.transcripts = record.transcripts
      .slice(0, MAX_LIST_ENTRIES)
      .flatMap((entry) => {
        const text = boundedText(entry);
        return text === undefined ? [] : [text];
      });
  }

  if (Array.isArray(record.turns)) {
    scenario.turns = record.turns.slice(0, MAX_LIST_ENTRIES).map(normalizeTurn);
  }

  if (Array.isArray(record.redirects)) {
    scenario.redirects = record.redirects
      .slice(0, MAX_LIST_ENTRIES)
      .map(normalizeRedirect);
  }

  if (Array.isArray(record.realtimeCalls)) {
    scenario.realtimeCalls = record.realtimeCalls
      .slice(0, MAX_LIST_ENTRIES)
      .map(normalizeRealtimeScript);
  }

  const speech = asRecord(record.speech);
  if (speech) {
    const mode =
      speech.mode === 'fallback' || speech.mode === 'stream'
        ? speech.mode
        : undefined;
    const sampleRate =
      typeof speech.sampleRate === 'number' &&
      Number.isInteger(speech.sampleRate) &&
      speech.sampleRate >= 8_000 &&
      speech.sampleRate <= 48_000
        ? speech.sampleRate
        : undefined;
    const msPerChar = boundedDelay(speech.msPerChar);
    const maxMsPerText = boundedDelay(speech.maxMsPerText);
    scenario.speech = {
      ...(maxMsPerText === undefined ? {} : { maxMsPerText }),
      ...(mode === undefined ? {} : { mode }),
      ...(msPerChar === undefined ? {} : { msPerChar }),
      ...(sampleRate === undefined ? {} : { sampleRate }),
    };
  }

  const transcribe = asRecord(record.transcribe);
  if (transcribe) {
    const delayMs = boundedDelay(transcribe.delayMs);
    const failWith =
      typeof transcribe.failWith === 'number' &&
      Number.isInteger(transcribe.failWith) &&
      transcribe.failWith >= 400 &&
      transcribe.failWith <= 599
        ? transcribe.failWith
        : undefined;
    scenario.transcribe = {
      ...(delayMs === undefined ? {} : { delayMs }),
      ...(failWith === undefined ? {} : { failWith }),
    };
  }

  return scenario;
}

/** Frames generated for a `reply`-style turn script. */
export function replyFrames(
  reply: string,
  delayMs: number | undefined,
): HarnessTurnFrame[] {
  const step = delayMs === undefined ? {} : { delayMs };
  const pieces = splitReply(reply);
  return [
    { type: 'message.start' },
    ...pieces.map((piece) => ({
      payload: { text: piece },
      type: 'message.delta',
      ...step,
    })),
    { payload: { status: 'complete', text: reply }, type: 'message.complete' },
  ];
}

function splitReply(reply: string): string[] {
  if (reply.length <= 24) return reply ? [reply] : [];
  const midpoint = Math.ceil(reply.length / 2);
  return [reply.slice(0, midpoint), reply.slice(midpoint)];
}
