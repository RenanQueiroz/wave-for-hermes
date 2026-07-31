import rateLimit from '@fastify/rate-limit';
import {
  WAVE_API_VERSION,
  WAVE_MAX_REQUEST_BODY_BYTES,
  WaveErrorResponseSchema,
  type WaveErrorResponse,
} from '@wave/contracts';
import Fastify, { type FastifyReply, type FastifyServerOptions } from 'fastify';
import { ZodError } from 'zod';

import type { DeviceStore } from './auth/device-store.ts';
import { SqliteDeviceStore } from './auth/sqlite-device-store.ts';
import { ActiveTurnRegistry } from './chat/active-turns.ts';
import type { CompanionConfig } from './config.ts';
import { HttpHermesClient } from './hermes/hermes-client.ts';
import { HermesClientError } from './hermes/hermes-errors.ts';
import type { HermesClient } from './hermes/hermes-types.ts';
import { normalizeHermesError, WaveHttpError } from './http/errors.ts';
import type { InteractionStore } from './interactions/interaction-store.ts';
import { OpenAIRealtimeProvider } from './realtime/openai-realtime-provider.ts';
import { RealtimeCallRegistry } from './realtime/realtime-call-registry.ts';
import {
  RealtimeVoiceSampler,
  type RealtimeVoiceSampleSource,
} from './realtime/realtime-voice-sampler.ts';
import { registerWaveApi } from './routes/wave-api.ts';

export interface BuildCompanionServerOptions {
  deviceStore?: DeviceStore;
  hermesClient?: HermesClient;
  interactionStore?: InteractionStore;
  logger?: FastifyServerOptions['logger'];
  now?: () => Date;
  realtimeCallRegistry?: RealtimeCallRegistry;
  realtimeVoiceSampler?: RealtimeVoiceSampleSource;
  turnRegistry?: ActiveTurnRegistry;
}

export function buildCompanionServer(
  config: CompanionConfig,
  options: BuildCompanionServerOptions = {},
) {
  const ownsDeviceStore = options.deviceStore === undefined;
  const deviceStore =
    options.deviceStore ?? new SqliteDeviceStore(config.databasePath);
  const hermesClient =
    options.hermesClient ?? new HttpHermesClient(config.hermes);
  const interactionStore =
    options.interactionStore ??
    (deviceStore instanceof SqliteDeviceStore ? deviceStore : undefined);
  if (!interactionStore) {
    throw new Error(
      'A custom device store requires a companion interaction store.',
    );
  }
  const turnRegistry =
    options.turnRegistry ?? new ActiveTurnRegistry(config.maxActiveTurns);
  const realtimeCallRegistry =
    options.realtimeCallRegistry ??
    (config.openAI
      ? new RealtimeCallRegistry(
          {
            callTtlMs: config.realtimeCallTtlMs,
            defaultVoiceId: config.openAI.voice,
            maxActiveCalls: config.maxActiveRealtimeCalls,
            toolTimeoutMs: config.realtimeToolTimeoutMs,
          },
          {
            deviceStore,
            hermesClient,
            interactionStore,
            provider: new OpenAIRealtimeProvider(config.openAI),
          },
        )
      : undefined);
  const realtimeVoiceSampler =
    options.realtimeVoiceSampler ??
    (config.openAI ? new RealtimeVoiceSampler(config.openAI) : undefined);
  const app = Fastify({
    bodyLimit: WAVE_MAX_REQUEST_BODY_BYTES,
    logger: options.logger ?? false,
    requestTimeout: 15_000,
  });

  app.register(rateLimit, {
    global: true,
    max: 120,
    timeWindow: '1 minute',
  });

  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('cache-control', 'no-store');
    reply.header('x-wave-request-id', request.id);
    return payload;
  });

  app.addHook('preClose', async () => {
    turnRegistry.abortAll('server_shutdown');
    await realtimeCallRegistry?.abortAll();
  });

  if (ownsDeviceStore) {
    app.addHook('onClose', async () => {
      deviceStore.close();
    });
  }

  app.after(() => {
    registerWaveApi(
      app,
      config,
      {
        deviceStore,
        hermesClient,
        interactionStore,
        realtimeCallRegistry,
        realtimeVoiceSampler,
        turnRegistry,
      },
      {
        ...(options.now ? { now: options.now } : {}),
      },
    );
  });

  app.setNotFoundHandler((request, reply) => {
    return sendWaveError(
      request.id,
      reply,
      new WaveHttpError('The requested Wave endpoint does not exist.', {
        code: 'not_found',
        statusCode: 404,
      }),
    );
  });

  app.setErrorHandler((error, request, reply) => {
    const normalized = normalizeRequestError(error);
    if (normalized.code === 'internal') {
      request.log.error(
        { requestId: request.id },
        'Wave Companion request failed',
      );
    }
    return sendWaveError(request.id, reply, normalized);
  });

  return app;
}

function normalizeRequestError(error: unknown) {
  if (error instanceof WaveHttpError) {
    return error;
  }
  if (error instanceof HermesClientError) {
    return normalizeHermesError(error);
  }
  if (error instanceof ZodError) {
    return new WaveHttpError('The Wave request is invalid.', {
      code: 'bad_request',
      statusCode: 400,
    });
  }
  if (
    typeof error === 'object' &&
    error !== null &&
    'statusCode' in error &&
    error.statusCode === 429
  ) {
    return new WaveHttpError('The Wave request rate limit was exceeded.', {
      code: 'rate_limited',
      retryable: true,
      statusCode: 429,
    });
  }
  if (
    typeof error === 'object' &&
    error !== null &&
    'statusCode' in error &&
    (error.statusCode === 400 ||
      error.statusCode === 413 ||
      error.statusCode === 415)
  ) {
    return new WaveHttpError(
      error.statusCode === 413
        ? 'The Wave request body is too large.'
        : 'The Wave request is invalid.',
      {
        code: 'bad_request',
        statusCode: error.statusCode,
      },
    );
  }
  return new WaveHttpError('Wave Companion could not complete the request.', {
    code: 'internal',
    statusCode: 500,
  });
}

function sendWaveError(
  requestId: string,
  reply: FastifyReply,
  error: WaveHttpError,
) {
  const response: WaveErrorResponse = {
    apiVersion: WAVE_API_VERSION,
    error: {
      code: error.code,
      correlationId: requestId,
      message: error.message,
      retryable: error.retryable,
    },
  };
  if (error.statusCode === 401) {
    reply.header('www-authenticate', 'Bearer');
  }
  return reply
    .code(error.statusCode)
    .send(WaveErrorResponseSchema.parse(response));
}
