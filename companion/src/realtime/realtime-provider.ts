import type {
  WaveAskHermesToolResult,
  WaveRealtimeVoiceId,
} from '@wave/contracts';

export interface RealtimeFunctionCall {
  arguments: string;
  callId: string;
  name: string;
  userItemId?: string;
}

export interface RealtimeAssistantTranscript {
  handoffIds: string[];
  responseId: string;
  transcript: string;
  userItemId?: string;
}

export interface RealtimeUserTranscript {
  itemId: string;
  transcript: string;
}

export type RealtimeSidebandErrorKind =
  'authentication' | 'protocol' | 'rate_limited' | 'timeout' | 'unavailable';

export class RealtimeProviderError extends Error {
  readonly kind: RealtimeSidebandErrorKind;
  readonly retryable: boolean;

  constructor(
    message: string,
    options: {
      cause?: unknown;
      kind: RealtimeSidebandErrorKind;
      retryable?: boolean;
    },
  ) {
    super(
      message,
      options.cause === undefined
        ? undefined
        : {
            cause: options.cause,
          },
    );
    this.name = 'RealtimeProviderError';
    this.kind = options.kind;
    this.retryable = options.retryable ?? false;
  }
}

export interface RealtimeSideband {
  close(): void;
  onAssistantTranscript(
    listener: (transcript: RealtimeAssistantTranscript) => void,
  ): void;
  onClose(listener: () => void): void;
  onError(listener: (error: RealtimeProviderError) => void): void;
  onFunctionCall(listener: (call: RealtimeFunctionCall) => void): void;
  onUserItem(listener: (itemId: string) => void): void;
  onUserTranscript(
    listener: (transcript: RealtimeUserTranscript) => void,
  ): void;
  sendFunctionResult(
    callId: string,
    result: WaveAskHermesToolResult,
    handoffId?: string,
  ): boolean;
}

export interface RealtimeProviderCall {
  readonly sdpAnswer: string;
  readonly sideband: RealtimeSideband;
  end(): Promise<void>;
}

export interface RealtimeProvider {
  createCall(input: {
    safetyIdentifier: string;
    sdpOffer: string;
    signal?: AbortSignal;
    voice: WaveRealtimeVoiceId;
  }): Promise<RealtimeProviderCall>;
}
