import type { FastifyRequest, FastifyServerOptions } from 'fastify';

const REDACTED_LOG_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'request.headers.authorization',
  'request.headers.cookie',
];

export function createCompanionLoggerOptions(
  level: string,
): Exclude<FastifyServerOptions['logger'], boolean | undefined> {
  return {
    level,
    redact: {
      censor: '[REDACTED]',
      paths: REDACTED_LOG_PATHS,
    },
    serializers: {
      req: serializeCompanionRequest,
    },
  };
}

export function serializeCompanionRequest(request: FastifyRequest) {
  return {
    method: request.method,
  };
}
