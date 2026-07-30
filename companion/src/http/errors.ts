import type { WaveErrorCode } from '@wave/contracts';

import { HermesClientError } from '../hermes/hermes-errors.ts';

interface WaveHttpErrorOptions {
  code: WaveErrorCode;
  retryable?: boolean;
  statusCode: number;
}

export class WaveHttpError extends Error {
  readonly code: WaveErrorCode;
  readonly retryable: boolean;
  readonly statusCode: number;

  constructor(message: string, options: WaveHttpErrorOptions) {
    super(message);
    this.name = 'WaveHttpError';
    this.code = options.code;
    this.retryable = options.retryable ?? false;
    this.statusCode = options.statusCode;
  }
}

export function normalizeHermesError(error: HermesClientError) {
  switch (error.kind) {
    case 'cancelled':
      return new WaveHttpError('The Hermes turn was cancelled.', {
        code: 'cancelled',
        statusCode: 409,
      });
    case 'not_found':
      return new WaveHttpError('The requested Hermes session was not found.', {
        code: 'not_found',
        statusCode: 404,
      });
    case 'protocol':
    case 'unsupported':
      return new WaveHttpError(
        'The Hermes API Server is incompatible with this Wave Companion.',
        {
          code: 'upstream_incompatible',
          statusCode: 502,
        },
      );
    case 'timeout':
      return new WaveHttpError('Hermes did not respond before the timeout.', {
        code: 'timeout',
        retryable: true,
        statusCode: 504,
      });
    case 'authentication':
    case 'configuration':
    case 'network':
    case 'rate_limited':
    case 'server':
      return new WaveHttpError(
        'The Hermes API Server is currently unavailable.',
        {
          code: 'upstream_unavailable',
          retryable: error.retryable,
          statusCode: 503,
        },
      );
  }
}
