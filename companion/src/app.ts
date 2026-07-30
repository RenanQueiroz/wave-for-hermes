import {
  WAVE_API_VERSION,
  WAVE_COMPANION_SERVICE,
  WaveErrorResponseSchema,
  WaveStatusResponseSchema,
  type WaveErrorResponse,
  type WaveStatusResponse,
} from '@wave/contracts';
import Fastify, { type FastifyServerOptions } from 'fastify';

import type { CompanionConfig } from './config.ts';
import { HttpHermesClient } from './hermes/hermes-client.ts';

const SERVICE_VERSION = '0.1.0';

export interface BuildCompanionServerOptions {
  logger?: FastifyServerOptions['logger'];
  now?: () => Date;
}

export function buildCompanionServer(
  config: CompanionConfig,
  options: BuildCompanionServerOptions = {},
) {
  const now = options.now ?? (() => new Date());
  const hermesClient = new HttpHermesClient(config.hermes);
  const app = Fastify({
    logger: options.logger ?? false,
  });

  app.get('/v1/status', async (request, reply) => {
    const response: WaveStatusResponse = {
      apiVersion: WAVE_API_VERSION,
      features: {
        chat: false,
        pairing: false,
        realtime: false,
      },
      hermes: {
        configured: Boolean(hermesClient),
      },
      requestId: request.id,
      serverTime: now().toISOString(),
      service: WAVE_COMPANION_SERVICE,
      serviceVersion: SERVICE_VERSION,
      status: 'ok',
    };

    return reply
      .header('cache-control', 'no-store')
      .send(WaveStatusResponseSchema.parse(response));
  });

  app.setNotFoundHandler((request, reply) => {
    const response: WaveErrorResponse = {
      apiVersion: WAVE_API_VERSION,
      error: {
        code: 'not_found',
        correlationId: request.id,
        message: 'The requested Wave endpoint does not exist.',
        retryable: false,
      },
    };

    return reply.code(404).send(WaveErrorResponseSchema.parse(response));
  });

  app.setErrorHandler((_error, request, reply) => {
    request.log.error(
      { requestId: request.id },
      'Wave Companion request failed',
    );
    const response: WaveErrorResponse = {
      apiVersion: WAVE_API_VERSION,
      error: {
        code: 'internal',
        correlationId: request.id,
        message: 'Wave Companion could not complete the request.',
        retryable: false,
      },
    };

    return reply.code(500).send(WaveErrorResponseSchema.parse(response));
  });

  return app;
}
