import type { WaveAskHermesToolResult } from '@wave/contracts';

export interface RealtimeFunctionCall {
  arguments: string;
  callId: string;
  name: string;
}

export type RealtimeSidebandErrorKind =
  | 'authentication'
  | 'protocol'
  | 'rate_limited'
  | 'timeout'
  | 'unavailable';

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
    super(message, options.cause === undefined ? undefined : {
      cause: options.cause,
    });
    this.name = 'RealtimeProviderError';
    this.kind = options.kind;
    this.retryable = options.retryable ?? false;
  }
}

export interface RealtimeSideband {
  close(): void;
  onClose(listener: () => void): void;
  onError(listener: (error: RealtimeProviderError) => void): void;
  onFunctionCall(listener: (call: RealtimeFunctionCall) => void): void;
  sendFunctionResult(
    callId: string,
    result: WaveAskHermesToolResult,
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
  }): Promise<RealtimeProviderCall>;
}
