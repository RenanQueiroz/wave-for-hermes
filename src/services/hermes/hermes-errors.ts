export type HermesErrorKind =
  | 'authentication'
  | 'cancelled'
  | 'configuration'
  | 'network'
  | 'not_found'
  | 'protocol'
  | 'rate_limited'
  | 'server'
  | 'timeout'
  | 'unsupported';

interface HermesClientErrorOptions {
  cause?: unknown;
  code?: string;
  kind: HermesErrorKind;
  retryable?: boolean;
  status?: number;
}

const MAX_ERROR_MESSAGE_LENGTH = 512;

export class HermesClientError extends Error {
  readonly code?: string;
  readonly kind: HermesErrorKind;
  readonly retryable: boolean;
  readonly status?: number;

  constructor(message: string, options: HermesClientErrorOptions) {
    super(message, { cause: options.cause });
    this.name = 'HermesClientError';
    this.code = options.code;
    this.kind = options.kind;
    this.retryable = options.retryable ?? false;
    this.status = options.status;
  }
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function redactHermesErrorText(value: unknown, secrets: readonly string[] = []) {
  let text = typeof value === 'string' ? value : 'Hermes request failed';

  for (const secret of secrets) {
    if (secret) {
      text = text.replace(new RegExp(escapeRegExp(secret), 'g'), '[REDACTED]');
    }
  }

  text = text
    .replace(/\bBearer\s+[^\s,;"']+/gi, 'Bearer [REDACTED]')
    .replace(
      /\b(authorization|api[_-]?server[_-]?key|api[_-]?key|token|secret)\b(\s*[:=]\s*)[^\s,;"']+/gi,
      '$1$2[REDACTED]',
    )
    .replace(/[\r\n\t]+/g, ' ')
    .trim();

  if (!text) {
    return 'Hermes request failed';
  }

  return text.slice(0, MAX_ERROR_MESSAGE_LENGTH);
}
