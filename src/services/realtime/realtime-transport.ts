export const WAVE_MAX_REALTIME_EVENT_BYTES = 64 * 1024;
export const WAVE_MAX_REALTIME_TRANSCRIPT_LENGTH = 24_000;

export type RealtimeConnectionState =
  | 'connected'
  | 'connecting'
  | 'disconnected'
  | 'failed';

export type RealtimeActivity =
  | 'assistant_speaking'
  | 'listening'
  | 'user_speaking';

export type RealtimeTransportEvent =
  | {
      state: RealtimeConnectionState;
      type: 'connection';
    }
  | {
      activity: RealtimeActivity;
      type: 'activity';
    }
  | {
      count: number;
      type: 'remote_audio_tracks';
    }
  | {
      final: boolean;
      role: 'assistant' | 'user';
      text: string;
      type: 'transcript';
    }
  | {
      error: RealtimeTransportError;
      type: 'error';
    };

export interface PrepareRealtimeTransportOptions {
  onEvent(event: RealtimeTransportEvent): void;
  signal: AbortSignal;
}

export interface PreparedRealtimeTransport {
  readonly sdpOffer: string;
  close(): void;
  connect(sdpAnswer: string, signal: AbortSignal): Promise<void>;
  setMicrophoneEnabled(enabled: boolean): void;
}

export interface RealtimeTransport {
  prepare(
    options: PrepareRealtimeTransportOptions,
  ): Promise<PreparedRealtimeTransport>;
}

export type RealtimeTransportErrorKind =
  | 'cancelled'
  | 'connection'
  | 'media_permission'
  | 'media_unavailable'
  | 'protocol'
  | 'timeout';

export class RealtimeTransportError extends Error {
  readonly kind: RealtimeTransportErrorKind;
  readonly retryable: boolean;

  constructor(
    message: string,
    options: {
      kind: RealtimeTransportErrorKind;
      retryable?: boolean;
    },
  ) {
    super(message);
    this.name = 'RealtimeTransportError';
    this.kind = options.kind;
    this.retryable = options.retryable ?? false;
  }
}

export function parseRealtimeServerEvent(
  value: unknown,
): RealtimeTransportEvent | undefined {
  if (
    typeof value !== 'string' ||
    byteLength(value) > WAVE_MAX_REALTIME_EVENT_BYTES
  ) {
    return protocolError();
  }

  let payload: unknown;
  try {
    payload = JSON.parse(value);
  } catch {
    return protocolError();
  }
  if (!isRecord(payload) || !isBoundedType(payload.type)) {
    return protocolError();
  }

  switch (payload.type) {
    case 'input_audio_buffer.speech_started':
      return { activity: 'user_speaking', type: 'activity' };
    case 'input_audio_buffer.speech_stopped':
      return { activity: 'listening', type: 'activity' };
    case 'output_audio_buffer.started':
      return { activity: 'assistant_speaking', type: 'activity' };
    case 'output_audio_buffer.cleared':
    case 'output_audio_buffer.stopped':
      return { activity: 'listening', type: 'activity' };
    case 'conversation.item.input_audio_transcription.completed':
      return transcriptEvent(payload.transcript, 'user', true);
    case 'response.output_audio_transcript.delta':
      return transcriptEvent(payload.delta, 'assistant', false);
    case 'response.output_audio_transcript.done':
      return transcriptEvent(payload.transcript, 'assistant', true);
    case 'error':
      return {
        error: new RealtimeTransportError(
          'The Realtime service reported an error.',
          {
            kind: 'protocol',
            retryable: true,
          },
        ),
        type: 'error',
      };
    default:
      // Realtime is an extensible event stream. Ignore well-formed events this
      // client does not need instead of coupling the mobile bundle to every
      // provider event variant.
      return undefined;
  }
}

function byteLength(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

function isBoundedType(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 100 &&
    /^[a-z0-9._-]+$/.test(value)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function protocolError(): RealtimeTransportEvent {
  return {
    error: new RealtimeTransportError(
      'The Realtime service sent an invalid event.',
      {
        kind: 'protocol',
      },
    ),
    type: 'error',
  };
}

function transcriptEvent(
  value: unknown,
  role: 'assistant' | 'user',
  final: boolean,
): RealtimeTransportEvent {
  if (
    typeof value !== 'string' ||
    value.length > WAVE_MAX_REALTIME_TRANSCRIPT_LENGTH
  ) {
    return protocolError();
  }
  return {
    final,
    role,
    text: value,
    type: 'transcript',
  };
}
