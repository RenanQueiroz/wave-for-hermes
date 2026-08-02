/**
 * Gateway voice mode: the pure decision logic.
 *
 * The cycle is listen → transcribe → think → speak → listen. Unlike Realtime
 * this is half-duplex: the gateway transcribes a finished recording, the
 * transcript runs as a normal turn, and the reply is spoken back. Keeping the
 * decisions here (rather than in the screen) makes silence detection, stop
 * words, and barge-in testable without a microphone.
 */

export type GatewayVoicePhase =
  'idle' | 'listening' | 'transcribing' | 'thinking' | 'speaking';

/** Utterances shorter than this are treated as noise, not speech. */
export const MIN_UTTERANCE_MS = 500;
/** Silence that ends an utterance. */
export const SILENCE_HOLD_MS = 1_500;
/** A single utterance never runs longer than this. */
export const MAX_UTTERANCE_MS = 60_000;
/**
 * Metering is in dBFS (0 loud, -160 silent). Anything below this counts as
 * silence; well under normal speech and above room tone on both platforms.
 */
export const SILENCE_THRESHOLD_DBFS = -40;

const STOP_WORDS = [
  'stop',
  'stop listening',
  'stop wave',
  'wave stop',
  'cancel',
  'never mind',
  'nevermind',
  'exit voice',
  'end voice',
  'quiet',
];

/**
 * True when the transcript is a bare command to leave voice mode rather than
 * something to send to Hermes. Only an exact match (modulo punctuation and
 * case) counts — "stop the deployment" is a real instruction.
 */
export function isVoiceStopCommand(transcript: string): boolean {
  const normalized = transcript
    .toLowerCase()
    .replace(/[.!?,;:]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return STOP_WORDS.includes(normalized);
}

export interface UtteranceSample {
  /** Metering level in dBFS, when the platform reports it. */
  level?: number;
  /** Milliseconds since the recording started. */
  elapsedMs: number;
}

export interface UtteranceTracker {
  /** ms of continuous silence observed at the end of the recording. */
  silentForMs: number;
  /** Whether any sample has exceeded the speech threshold. */
  heardSpeech: boolean;
}

export const initialUtteranceTracker: UtteranceTracker = {
  heardSpeech: false,
  silentForMs: 0,
};

export type UtteranceDecision =
  { reason: 'max_duration' | 'silence'; type: 'submit' } | { type: 'continue' };

/**
 * Fold one metering sample into the tracker and decide whether the utterance
 * is over. Without metering (a platform that reports none), only the maximum
 * duration can end it — the user's explicit stop is then the normal path.
 */
export function observeUtterance(
  tracker: UtteranceTracker,
  sample: UtteranceSample,
  sampleIntervalMs: number,
): { decision: UtteranceDecision; tracker: UtteranceTracker } {
  if (sample.elapsedMs >= MAX_UTTERANCE_MS) {
    return {
      decision: { reason: 'max_duration', type: 'submit' },
      tracker,
    };
  }
  if (sample.level === undefined) {
    return { decision: { type: 'continue' }, tracker };
  }
  const speaking = sample.level > SILENCE_THRESHOLD_DBFS;
  const next: UtteranceTracker = {
    heardSpeech: tracker.heardSpeech || speaking,
    silentForMs: speaking ? 0 : tracker.silentForMs + sampleIntervalMs,
  };
  // Silence only ends an utterance that actually contained speech, and only
  // after the recording is long enough to be worth transcribing.
  if (
    next.heardSpeech &&
    next.silentForMs >= SILENCE_HOLD_MS &&
    sample.elapsedMs >= MIN_UTTERANCE_MS
  ) {
    return { decision: { reason: 'silence', type: 'submit' }, tracker: next };
  }
  return { decision: { type: 'continue' }, tracker: next };
}

/**
 * Barge-in: while Wave is speaking, the mic keeps listening and loud-enough
 * input interrupts playback. The threshold is deliberately higher than the
 * silence threshold so the device's own playback bleeding into the mic does
 * not interrupt itself.
 */
export const BARGE_IN_THRESHOLD_DBFS = -25;

export function shouldBargeIn(level: number | undefined): boolean {
  return level !== undefined && level > BARGE_IN_THRESHOLD_DBFS;
}

const MIME_TYPE_BY_EXTENSION: Record<string, string> = {
  '.caf': 'audio/x-caf',
  '.m4a': 'audio/mp4',
  '.mp4': 'audio/mp4',
  '.wav': 'audio/wav',
};

/**
 * The upload MIME type for a recording URI. The recorder's container differs
 * by platform (m4a/caf), and the gateway rejects anything that is not audio.
 */
export function mimeTypeForRecording(uri: string): string {
  const withoutQuery = uri.split('?')[0] ?? uri;
  const dot = withoutQuery.lastIndexOf('.');
  const extension = dot === -1 ? '' : withoutQuery.slice(dot).toLowerCase();
  return MIME_TYPE_BY_EXTENSION[extension] ?? 'audio/m4a';
}

/** What the user sees for each phase. */
export function voicePhaseTitle(phase: GatewayVoicePhase): string {
  switch (phase) {
    case 'listening':
      return 'Listening';
    case 'transcribing':
      return 'Got it';
    case 'thinking':
      return 'Working on it';
    case 'speaking':
      return 'Speaking';
    default:
      return 'Voice mode';
  }
}

export function voicePhaseDescription(phase: GatewayVoicePhase): string {
  switch (phase) {
    case 'listening':
      return 'Say what you need. Wave sends it when you pause.';
    case 'transcribing':
      return 'Turning your words into a message…';
    case 'thinking':
      return 'Hermes is working on your request.';
    case 'speaking':
      return 'Start talking any time to interrupt.';
    default:
      return 'Tap start to talk with your Hermes agent.';
  }
}
