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

export interface HarnessModelScript {
  /** `config.get` values by key (for example `reasoning`, `fast`). */
  config?: Record<string, string>;
  /** Raw `model.options` result payload, served verbatim. */
  options?: Record<string, unknown>;
}

export interface HarnessScenario {
  audioCapabilities?: { stt: boolean; tts: boolean };
  /** Overrides for the `model.options` catalog and `config.get` values. */
  models?: HarnessModelScript;
  /** FIFO of scripted Realtime calls (one entry per sideband connection). */
  realtimeCalls?: HarnessRealtimeScript[];
  /** FIFO of `session.redirect` outcomes; default is `redirected`. */
  redirects?: HarnessRedirectScript[];
  /**
   * Seed the session store on scenario load — a fixture for drawer paging
   * and fling-performance checks. Sessions get spread `last_active`
   * timestamps so date sections vary.
   */
  seedSessions?: HarnessSessionSeed;
  /** Seed named conversations with deterministic history for UI showcases. */
  seedConversations?: HarnessConversationSeed[];
  speech?: HarnessSpeechScript;
  transcribe?: HarnessTranscribeScript;
  /** FIFO of transcripts served by `/api/audio/transcribe`. */
  transcripts?: string[];
  /** FIFO of turn scripts consumed by `prompt.submit`. */
  turns?: HarnessTurnScript[];
}

export interface HarnessConversationMessageSeed {
  content: string;
  role: 'assistant' | 'user';
}

export interface HarnessConversationSeed {
  /** Age of the conversation's newest message, relative to scenario load. */
  ageHours?: number;
  messages?: HarnessConversationMessageSeed[];
  pinned?: boolean;
  /** Raw gateway source identifier, such as `gateway`, `cron`, or `slack`. */
  source?: string;
  title: string;
}

export interface HarnessSessionSeed {
  count: number;
  messagesPerSession?: number;
  /** Pin every Nth seeded session (1 pins all). */
  pinnedEvery?: number;
  titlePrefix?: string;
}

const MAX_SEEDED_SESSIONS = 1_000;
const MAX_SEEDED_MESSAGES = 10;
const MAX_SEEDED_CONVERSATION_MESSAGES = 100;
const MAX_SEEDED_AGE_HOURS = 24 * 365 * 10;

export const DEFAULT_TRANSCRIPT = 'Hello from the harness.';

/**
 * Default `model.options` catalog, mirroring the deployed gateway's wire
 * shape as consumed by `src/services/gateway/gateway-models.ts`. Scenarios
 * override it with `models.options`.
 */
export const DEFAULT_MODEL_OPTIONS: Record<string, unknown> = {
  model: 'gpt-5.6-sol',
  provider: 'openai',
  providers: [
    {
      authenticated: true,
      capabilities: {
        'gpt-5.6-luna': { reasoning: true },
        'gpt-5.6-sol': { reasoning: true },
        'gpt-5.6-terra': { reasoning: true },
      },
      featured_models: ['gpt-5.6-sol'],
      is_current: true,
      models: ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'],
      name: 'OpenAI',
      slug: 'openai',
    },
    {
      authenticated: true,
      capabilities: {
        'claude-opus-5': { reasoning: true },
        'claude-sonnet-5': { reasoning: true },
      },
      featured_models: ['claude-opus-5'],
      is_current: false,
      models: ['claude-opus-5', 'claude-sonnet-5'],
      name: 'Anthropic',
      slug: 'anthropic',
    },
  ],
};

/** Default `config.get` values; scenarios override with `models.config`. */
export const DEFAULT_MODEL_CONFIG: Record<string, string> = {
  fast: 'normal',
  reasoning: 'xhigh',
};

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

function boundedNonnegativeNumber(
  value: unknown,
  max: number,
): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.min(value, max)
    : undefined;
}

function normalizeConversationSeed(
  value: unknown,
): HarnessConversationSeed | undefined {
  const record = asRecord(value);
  const title = boundedText(record?.title)?.trim();
  if (!record || !title) return undefined;
  const ageHours = boundedNonnegativeNumber(
    record.ageHours,
    MAX_SEEDED_AGE_HOURS,
  );
  const source = boundedText(record.source)?.trim();
  const messages: HarnessConversationMessageSeed[] | undefined = Array.isArray(
    record.messages,
  )
    ? record.messages
        .slice(0, MAX_SEEDED_CONVERSATION_MESSAGES)
        .flatMap((message) => {
          const messageRecord = asRecord(message);
          const content = boundedText(messageRecord?.content);
          const role = messageRecord?.role;
          return content !== undefined &&
            (role === 'assistant' || role === 'user')
            ? [{ content, role }]
            : [];
        })
    : undefined;
  return {
    title: title.slice(0, 300),
    ...(ageHours === undefined ? {} : { ageHours }),
    ...(messages === undefined ? {} : { messages }),
    ...(record.pinned === true ? { pinned: true } : {}),
    ...(source ? { source: source.slice(0, 100) } : {}),
  };
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

  const models = asRecord(record.models);
  if (models) {
    const options = asRecord(models.options);
    const configRecord = asRecord(models.config);
    const config = configRecord
      ? Object.fromEntries(
          Object.entries(configRecord).flatMap(([key, value]) => {
            const bounded = boundedText(value);
            return bounded === undefined ? [] : [[key.slice(0, 100), bounded]];
          }),
        )
      : undefined;
    scenario.models = {
      ...(config === undefined ? {} : { config }),
      ...(options === undefined ? {} : { options }),
    };
  }

  const seed = asRecord(record.seedSessions);
  if (seed && typeof seed.count === 'number' && seed.count > 0) {
    scenario.seedSessions = {
      count: Math.min(Math.floor(seed.count), MAX_SEEDED_SESSIONS),
      ...(typeof seed.messagesPerSession === 'number' &&
      seed.messagesPerSession >= 1
        ? {
            messagesPerSession: Math.min(
              Math.floor(seed.messagesPerSession),
              MAX_SEEDED_MESSAGES,
            ),
          }
        : {}),
      ...(typeof seed.pinnedEvery === 'number' && seed.pinnedEvery >= 1
        ? { pinnedEvery: Math.floor(seed.pinnedEvery) }
        : {}),
      ...(typeof seed.titlePrefix === 'string'
        ? { titlePrefix: seed.titlePrefix.slice(0, 100) }
        : {}),
    };
  }

  if (Array.isArray(record.seedConversations)) {
    scenario.seedConversations = record.seedConversations
      .slice(0, MAX_LIST_ENTRIES)
      .flatMap((conversation) => normalizeConversationSeed(conversation) ?? []);
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
    // v0.20.5 pushes live usage snapshots mid-turn; clients without a status
    // bar must ignore them without disturbing the transcript.
    {
      payload: {
        usage: {
          calls: 1,
          input: 64,
          output: reply.length,
          total: 64 + reply.length,
        },
      },
      type: 'session.usage',
    },
    { payload: { status: 'complete', text: reply }, type: 'message.complete' },
  ];
}

function splitReply(reply: string): string[] {
  if (reply.length <= 24) return reply ? [reply] : [];
  const midpoint = Math.ceil(reply.length / 2);
  return [reply.slice(0, midpoint), reply.slice(midpoint)];
}
