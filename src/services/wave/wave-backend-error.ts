/**
 * The normalized error every Wave backend surface throws. Extracted from the
 * retired companion client (stage 5): the gateway transport and query layers
 * keep classifying failures with the same kinds and retryability semantics.
 */
import type { WaveErrorCode } from '@wave/contracts';

export type WaveBackendFailureKind =
  WaveErrorCode | 'invalid_base_url' | 'invalid_response' | 'network';

interface WaveBackendErrorOptions {
  correlationId?: string;
  kind: WaveBackendFailureKind;
  retryable?: boolean;
  statusCode?: number;
}

export class WaveBackendError extends Error {
  readonly correlationId?: string;
  readonly kind: WaveBackendFailureKind;
  readonly retryable: boolean;
  readonly statusCode?: number;

  constructor(message: string, options: WaveBackendErrorOptions) {
    super(message);
    this.name = 'WaveBackendError';
    this.correlationId = options.correlationId;
    this.kind = options.kind;
    this.retryable = options.retryable ?? false;
    this.statusCode = options.statusCode;
  }
}
