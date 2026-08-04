/**
 * Gateway voice mode: the pure decision logic.
 *
 * The cycle is listen → transcribe → think → speak → listen. Unlike Realtime
 * this is half-duplex: the gateway transcribes a finished recording, the
 * transcript runs as a normal turn, and the reply is spoken back, with the
 * microphone closed while Wave speaks. Keeping the decisions here (rather
 * than in the screen) makes silence detection and stop words testable without
 * a microphone.
 */

export type GatewayVoicePhase =
  'idle' | 'listening' | 'transcribing' | 'thinking' | 'speaking';

/** Utterances shorter than this are treated as noise, not speech. */
export const MIN_UTTERANCE_MS = 500;
/** Silence that ends an utterance. */
export const SILENCE_HOLD_MS = 1_200;
/**
 * Consecutive above-threshold samples before the silence countdown resets.
 * Real speech always sustains across polls; an isolated peak (a rustle, a
 * distant noise — Android meters peaks) must not restart the whole hold,
 * which is what made auto-send feel slow "sometimes" on the Pixel.
 */
export const SUSTAINED_SPEECH_SAMPLES = 2;
/** A single utterance never runs longer than this. */
export const MAX_UTTERANCE_MS = 60_000;
/**
 * Metering is in dBFS (0 loud, -160 silent), but the two platforms measure
 * different things: iOS reports average power while Android reports the PEAK
 * amplitude since the previous poll (`MediaRecorder.maxAmplitude`), which
 * sits far above average for the same room — quiet-room peaks on a real
 * Pixel read -30..-20 dBFS, above any fixed threshold that still detects iOS
 * speech. So "speaking" is judged against a rolling noise floor instead of a
 * constant: the minimum level over the recent window, plus a margin. On iOS a
 * -50 dBFS floor yields the same -40 dBFS cut-off the fixed threshold used.
 */
export const SPEECH_MARGIN_DB = 10;
/** Rolling window for the noise floor: 5 s at the 250 ms sample interval. */
export const FLOOR_WINDOW_SAMPLES = 20;
/** Levels this quiet are never speech, however low the floor sits. */
export const MIN_SPEECH_DBFS = -55;

export { isVoiceStopCommand } from './voice-stop-command.ts';

/** The current speaking cut-off implied by the tracker's noise floor. */
export function utteranceSpeechThreshold(tracker: UtteranceTracker): number {
  const floor =
    tracker.recentLevels.length === 0
      ? MIN_SPEECH_DBFS - SPEECH_MARGIN_DB
      : Math.min(...tracker.recentLevels);
  return Math.max(floor + SPEECH_MARGIN_DB, MIN_SPEECH_DBFS);
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
  /** Recent metering samples (dBFS, newest last) for the rolling floor. */
  recentLevels: number[];
  /** Consecutive above-threshold samples ending at the newest one. */
  speakingStreak: number;
}

export const initialUtteranceTracker: UtteranceTracker = {
  heardSpeech: false,
  recentLevels: [],
  silentForMs: 0,
  speakingStreak: 0,
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
  const recentLevels = [...tracker.recentLevels, sample.level].slice(
    -FLOOR_WINDOW_SAMPLES,
  );
  const speaking =
    sample.level > utteranceSpeechThreshold({ ...tracker, recentLevels });
  const speakingStreak = speaking ? tracker.speakingStreak + 1 : 0;
  const sustained = speakingStreak >= SUSTAINED_SPEECH_SAMPLES;
  // The countdown measures silence AFTER speech. The first heard speech
  // discards any leading silence (else the opening word of an utterance
  // that followed a long quiet would submit itself instantly); sustained
  // speech keeps resetting it; an isolated blip mid-pause merely holds it,
  // so a stray peak — Android meters peaks — cannot restart the whole hold.
  const firstSpeech = speaking && !tracker.heardSpeech;
  const next: UtteranceTracker = {
    heardSpeech: tracker.heardSpeech || speaking,
    recentLevels,
    silentForMs:
      sustained || firstSpeech
        ? 0
        : speaking
          ? tracker.silentForMs
          : tracker.silentForMs + sampleIntervalMs,
    speakingStreak,
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
      return 'Tap Skip to cut the reply short.';
    default:
      return 'Tap start to talk with your Hermes agent.';
  }
}
