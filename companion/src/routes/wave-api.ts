import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import {
  WAVE_API_VERSION,
  WAVE_COMPANION_SERVICE,
  WaveCancelTurnResponseSchema,
  WaveCompatibilityResponseSchema,
  WaveCreateSessionRequestSchema,
  WaveDeleteSessionResponseSchema,
  WaveIdentifierSchema,
  WaveListSessionsRequestSchema,
  WaveScheduledJobListResponseSchema,
  WaveEndRealtimeCallResponseSchema,
  WaveRedeemPairingRequestSchema,
  WaveRedeemPairingResponseSchema,
  WaveSessionHistoryResponseSchema,
  WaveSessionListResponseSchema,
  WaveSessionResponseSchema,
  WaveStartRealtimeCallRequestSchema,
  WaveStartRealtimeCallResponseSchema,
  WaveStartTurnRequestSchema,
  WaveStatusResponseSchema,
  WaveTimelineRequestSchema,
  WaveTimelineResponseSchema,
  WaveUpdateSessionRequestSchema,
  type WaveErrorCode,
  type WaveTurnInput,
  type WaveTurnEvent,
} from '@wave/contracts';

import {
  createDeviceAuthenticator,
  requireAuthenticatedDevice,
} from '../auth/http-auth.ts';
import type { DeviceStore } from '../auth/device-store.ts';
import type { ActiveTurnRegistry } from '../chat/active-turns.ts';
import type { CompanionConfig } from '../config.ts';
import { HermesClientError } from '../hermes/hermes-errors.ts';
import type { HermesClient } from '../hermes/hermes-types.ts';
import {
  formatWaveSseEvent,
  normalizeHermesMessages,
  normalizeHermesScheduledJob,
  normalizeHermesSession,
  WaveTurnEventFactory,
} from '../hermes/wave-normalizers.ts';
import { normalizeHermesError, WaveHttpError } from '../http/errors.ts';
import type { InteractionStore } from '../interactions/interaction-store.ts';
import { createUnifiedTimeline } from '../interactions/timeline.ts';
import type { RealtimeCallRegistry } from '../realtime/realtime-call-registry.ts';

const SERVICE_VERSION = '0.1.0';
const SessionParamsSchema = z
  .object({
    sessionId: WaveIdentifierSchema,
  })
  .strict();
const SessionListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().nonnegative().max(1_000_000).default(0),
  })
  .strict();
const TimelineQuerySchema = z
  .object({
    before: WaveIdentifierSchema.optional(),
    limit: z.coerce.number().int().min(1).max(200).default(100),
  })
  .strict();
const TurnParamsSchema = SessionParamsSchema.extend({
  turnId: WaveIdentifierSchema,
}).strict();
const RealtimeCallParamsSchema = z
  .object({
    callId: WaveIdentifierSchema,
  })
  .strict();

interface WaveApiServices {
  deviceStore: DeviceStore;
  hermesClient: HermesClient;
  interactionStore: InteractionStore;
  realtimeCallRegistry?: RealtimeCallRegistry;
  turnRegistry: ActiveTurnRegistry;
}

interface RegisterWaveApiOptions {
  now?: () => Date;
}

export function registerWaveApi(
  app: FastifyInstance,
  config: CompanionConfig,
  services: WaveApiServices,
  options: RegisterWaveApiOptions = {},
) {
  const now = options.now ?? (() => new Date());
  const authenticateDevice = createDeviceAuthenticator(services.deviceStore);

  app.decorateRequest('waveDevice', null);

  app.get('/v1/status', async (request, reply) => {
    return reply.send(
      WaveStatusResponseSchema.parse({
        ...responseMetadata(request),
        features: {
          chat: true,
          pairing: true,
          realtime: services.realtimeCallRegistry !== undefined,
        },
        hermes: {
          configured: true,
        },
        serverTime: now().toISOString(),
        service: WAVE_COMPANION_SERVICE,
        serviceVersion: SERVICE_VERSION,
        status: 'ok',
      }),
    );
  });

  app.post(
    '/v1/pairings/redeem',
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: '1 minute',
        },
      },
    },
    async (request, reply) => {
      const input = WaveRedeemPairingRequestSchema.parse(request.body);
      const redeemed = services.deviceStore.redeemPairingCode(
        input.code,
        input.deviceName,
      );
      if (!redeemed) {
        throw new WaveHttpError(
          'The pairing code is invalid or no longer available.',
          {
            code: 'unauthorized',
            statusCode: 401,
          },
        );
      }
      return reply.code(201).send(
        WaveRedeemPairingResponseSchema.parse({
          ...responseMetadata(request),
          ...redeemed,
        }),
      );
    },
  );

  app.get(
    '/v1/compatibility',
    { onRequest: authenticateDevice },
    async (request, reply) => {
      const report = await services.hermesClient.probeCapabilities();
      return reply.send(
        WaveCompatibilityResponseSchema.parse({
          ...responseMetadata(request),
          compatible: report.supported,
          missingEndpoints: report.missingEndpoints,
          missingFeatures: report.missingFeatures,
        }),
      );
    },
  );

  app.get(
    '/v1/operations/jobs',
    { onRequest: authenticateDevice },
    async (request, reply) => {
      const jobs = await services.hermesClient.listScheduledJobs({
        signal: request.signal,
      });
      return reply.send(
        WaveScheduledJobListResponseSchema.parse({
          ...responseMetadata(request),
          jobs: jobs.map(normalizeHermesScheduledJob),
        }),
      );
    },
  );

  app.get(
    '/v1/sessions',
    { onRequest: authenticateDevice },
    async (request, reply) => {
      const input = WaveListSessionsRequestSchema.parse(
        SessionListQuerySchema.parse(request.query),
      );
      const page = await services.hermesClient.listSessions(input);
      return reply.send(
        WaveSessionListResponseSchema.parse({
          ...responseMetadata(request),
          hasMore: page.hasMore,
          limit: page.limit,
          offset: page.offset,
          sessions: page.sessions.map(normalizeHermesSession),
        }),
      );
    },
  );

  app.post(
    '/v1/sessions',
    { onRequest: authenticateDevice },
    async (request, reply) => {
      const input = WaveCreateSessionRequestSchema.parse(request.body ?? {});
      const session = normalizeHermesSession(
        await services.hermesClient.createSession({
          ...(input.title ? { title: input.title } : {}),
        }),
      );
      return reply.code(201).send(
        WaveSessionResponseSchema.parse({
          ...responseMetadata(request),
          session,
        }),
      );
    },
  );

  app.patch(
    '/v1/sessions/:sessionId',
    { onRequest: authenticateDevice },
    async (request, reply) => {
      const { sessionId } = SessionParamsSchema.parse(request.params);
      const input = WaveUpdateSessionRequestSchema.parse(request.body);
      const session = normalizeHermesSession(
        await services.hermesClient.updateSession(sessionId, input),
      );
      return reply.send(
        WaveSessionResponseSchema.parse({
          ...responseMetadata(request),
          session,
        }),
      );
    },
  );

  app.delete(
    '/v1/sessions/:sessionId',
    { onRequest: authenticateDevice },
    async (request, reply) => {
      const { sessionId } = SessionParamsSchema.parse(request.params);
      if (!services.turnRegistry.reserveSessionDeletion(sessionId)) {
        throw new WaveHttpError(
          'End the active Hermes turn or live call before deleting this conversation.',
          {
            code: 'conflict',
            statusCode: 409,
          },
        );
      }
      const realtimeReserved =
        services.realtimeCallRegistry?.reserveSessionDeletion(sessionId) ??
        true;
      if (!realtimeReserved) {
        services.turnRegistry.releaseSessionDeletion(sessionId);
        throw new WaveHttpError(
          'End the active Hermes turn or live call before deleting this conversation.',
          {
            code: 'conflict',
            statusCode: 409,
          },
        );
      }
      try {
        const deleted = await services.hermesClient.deleteSession(sessionId);
        if (!deleted) {
          throw new WaveHttpError(
            'The requested Hermes session was not found.',
            {
              code: 'not_found',
              statusCode: 404,
            },
          );
        }
        services.interactionStore.deleteSession(sessionId);
        return reply.send(
          WaveDeleteSessionResponseSchema.parse({
            ...responseMetadata(request),
            deleted: true,
            sessionId,
          }),
        );
      } finally {
        services.turnRegistry.releaseSessionDeletion(sessionId);
        services.realtimeCallRegistry?.releaseSessionDeletion(sessionId);
      }
    },
  );

  app.get(
    '/v1/sessions/:sessionId/messages',
    { onRequest: authenticateDevice },
    async (request, reply) => {
      const { sessionId } = SessionParamsSchema.parse(request.params);
      const messages = normalizeHermesMessages(
        await services.hermesClient.getSessionMessages(sessionId),
      );
      return reply.send(
        WaveSessionHistoryResponseSchema.parse({
          ...responseMetadata(request),
          messages,
          sessionId,
        }),
      );
    },
  );

  app.get(
    '/v1/sessions/:sessionId/timeline',
    { onRequest: authenticateDevice },
    async (request, reply) => {
      const { sessionId } = SessionParamsSchema.parse(request.params);
      const page = WaveTimelineRequestSchema.parse(
        TimelineQuerySchema.parse(request.query),
      );
      const entries = createUnifiedTimeline({
        hermesMessages:
          await services.hermesClient.getSessionMessages(sessionId),
        interactionTurns: services.interactionStore.listSessionTurns(sessionId),
        sessionId,
      });
      const endIndex = page.before
        ? entries.findIndex((entry) => entry.id === page.before)
        : entries.length;
      if (endIndex < 0) {
        throw new WaveHttpError(
          'The Wave timeline cursor is no longer available.',
          {
            code: 'bad_request',
            statusCode: 400,
          },
        );
      }
      const startIndex = Math.max(0, endIndex - page.limit);
      const pageEntries = entries.slice(startIndex, endIndex);
      return reply.send(
        WaveTimelineResponseSchema.parse({
          ...responseMetadata(request),
          entries: pageEntries,
          hasMore: startIndex > 0,
          limit: page.limit,
          ...(startIndex > 0 && pageEntries[0]
            ? { nextCursor: pageEntries[0].id }
            : {}),
          sessionId,
        }),
      );
    },
  );

  app.post(
    '/v1/sessions/:sessionId/realtime/calls',
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: '1 minute',
        },
      },
      onRequest: authenticateDevice,
    },
    async (request, reply) => {
      const device = requireAuthenticatedDevice(request);
      const { sessionId } = SessionParamsSchema.parse(request.params);
      const input = WaveStartRealtimeCallRequestSchema.parse(request.body);
      const realtimeCallRegistry = requireRealtimeCallRegistry(
        services.realtimeCallRegistry,
      );
      const call = await realtimeCallRegistry.start({
        deviceId: device.id,
        sdpOffer: input.sdpOffer,
        sessionId,
      });
      return reply.code(201).send(
        WaveStartRealtimeCallResponseSchema.parse({
          ...responseMetadata(request),
          call,
        }),
      );
    },
  );

  app.post(
    '/v1/realtime/calls/:callId/end',
    { onRequest: authenticateDevice },
    async (request, reply) => {
      const device = requireAuthenticatedDevice(request);
      const { callId } = RealtimeCallParamsSchema.parse(request.params);
      const realtimeCallRegistry = requireRealtimeCallRegistry(
        services.realtimeCallRegistry,
      );
      await realtimeCallRegistry.end(device.id, callId);
      return reply.send(
        WaveEndRealtimeCallResponseSchema.parse({
          ...responseMetadata(request),
          callId,
          status: 'ended',
        }),
      );
    },
  );

  app.post(
    '/v1/sessions/:sessionId/turns',
    { onRequest: authenticateDevice },
    async (request, reply) => {
      const device = requireAuthenticatedDevice(request);
      const { sessionId } = SessionParamsSchema.parse(request.params);
      const input = WaveStartTurnRequestSchema.parse(request.body);
      await services.hermesClient.getSession(sessionId);
      const turn = services.turnRegistry.start(device.id, sessionId);
      await streamTurn(
        request,
        reply,
        config,
        services.hermesClient,
        services.turnRegistry,
        turn,
        input.input,
        now,
      );
    },
  );

  app.post(
    '/v1/sessions/:sessionId/turns/:turnId/cancel',
    { onRequest: authenticateDevice },
    async (request, reply) => {
      const device = requireAuthenticatedDevice(request);
      const { sessionId, turnId } = TurnParamsSchema.parse(request.params);
      if (!services.turnRegistry.cancel(device.id, sessionId, turnId)) {
        throw new WaveHttpError('The active Wave turn was not found.', {
          code: 'not_found',
          statusCode: 404,
        });
      }
      return reply.code(202).send(
        WaveCancelTurnResponseSchema.parse({
          ...responseMetadata(request),
          status: 'cancellation_requested',
          turnId,
        }),
      );
    },
  );
}

function requireRealtimeCallRegistry(
  realtimeCallRegistry: RealtimeCallRegistry | undefined,
) {
  if (!realtimeCallRegistry) {
    throw new WaveHttpError(
      'OpenAI Realtime is not configured for this Wave Companion.',
      {
        code: 'upstream_unavailable',
        statusCode: 503,
      },
    );
  }
  return realtimeCallRegistry;
}

async function streamTurn(
  request: FastifyRequest,
  reply: FastifyReply,
  config: CompanionConfig,
  hermesClient: HermesClient,
  turnRegistry: ActiveTurnRegistry,
  turn: ReturnType<ActiveTurnRegistry['start']>,
  input: WaveTurnInput,
  now: () => Date,
) {
  const events = new WaveTurnEventFactory(turn.sessionId, turn.turnId, now);
  let idleTimer: NodeJS.Timeout | undefined;
  const totalTimer = setTimeout(
    () => turn.abort('total_timeout'),
    config.hermesTotalTimeoutMs,
  );
  const resetIdleTimer = (firstEvent: boolean) => {
    if (idleTimer) {
      clearTimeout(idleTimer);
    }
    idleTimer = setTimeout(
      () => turn.abort(firstEvent ? 'first_event_timeout' : 'idle_timeout'),
      firstEvent
        ? config.hermesFirstEventTimeoutMs
        : config.hermesIdleTimeoutMs,
    );
  };
  const onClose = () => {
    if (!reply.raw.writableEnded) {
      turn.abort('client_disconnected');
    }
  };

  reply.raw.once('close', onClose);
  reply.hijack();
  reply.raw.writeHead(200, {
    'cache-control': 'no-store',
    connection: 'keep-alive',
    'content-type': 'text/event-stream; charset=utf-8',
    'x-accel-buffering': 'no',
  });
  writeEvent(reply, events.createStarted());
  resetIdleTimer(true);

  try {
    for await (const event of hermesClient.streamChat(turn.sessionId, {
      input: toHermesChatContent(input),
      signal: turn.controller.signal,
    })) {
      resetIdleTimer(false);
      const normalized = events.fromHermes(event);
      if (normalized) {
        writeEvent(reply, normalized);
      }
      if (event.type === 'error') {
        break;
      }
    }
  } catch (error) {
    const failure = streamFailureEvent(events, turn.abortReason(), error);
    if (failure && canWrite(reply)) {
      writeEvent(reply, failure);
    }
  } finally {
    if (idleTimer) {
      clearTimeout(idleTimer);
    }
    clearTimeout(totalTimer);
    reply.raw.off('close', onClose);
    turnRegistry.finish(turn.turnId);
    if (canWrite(reply)) {
      reply.raw.end();
    }
  }
}

function toHermesChatContent(input: WaveTurnInput) {
  if (typeof input === 'string') return input;
  return input.flatMap((part) => {
    switch (part.type) {
      case 'text':
        return [{ text: part.text, type: 'text' as const }];
      case 'image':
        return [
          {
            text: `[Attached image: ${part.name}]`,
            type: 'text' as const,
          },
          {
            image_url: {
              detail: 'auto' as const,
              url: part.dataUrl,
            },
            type: 'image_url' as const,
          },
        ];
      case 'text_file':
        return [
          {
            text:
              `[Attached text file: ${part.name} (${part.mimeType})]\n\n` +
              part.text,
            type: 'text' as const,
          },
        ];
    }
  });
}

function streamFailureEvent(
  events: WaveTurnEventFactory,
  reason: ReturnType<ReturnType<ActiveTurnRegistry['start']>['abortReason']>,
  error: unknown,
) {
  switch (reason) {
    case 'client_disconnected':
      return undefined;
    case 'cancelled':
      return events.createError(
        'cancelled',
        'The Wave turn was cancelled.',
        false,
      );
    case 'first_event_timeout':
    case 'idle_timeout':
    case 'total_timeout':
      return events.createError(
        'timeout',
        'Hermes did not respond before the turn timeout.',
        true,
      );
    case 'server_shutdown':
      return events.createError(
        'upstream_unavailable',
        'Wave Companion is shutting down.',
        true,
      );
    case undefined: {
      const normalized =
        error instanceof HermesClientError
          ? normalizeHermesError(error)
          : new WaveHttpError('Hermes could not complete the turn.', {
              code: 'upstream_unavailable',
              retryable: true,
              statusCode: 503,
            });
      return events.createError(
        asStreamErrorCode(normalized.code),
        normalized.message,
        normalized.retryable,
      );
    }
  }
}

function asStreamErrorCode(
  code: WaveErrorCode,
): 'cancelled' | 'timeout' | 'upstream_incompatible' | 'upstream_unavailable' {
  switch (code) {
    case 'cancelled':
    case 'timeout':
    case 'upstream_incompatible':
    case 'upstream_unavailable':
      return code;
    default:
      return 'upstream_unavailable';
  }
}

function writeEvent(reply: FastifyReply, event: WaveTurnEvent) {
  if (canWrite(reply)) {
    reply.raw.write(formatWaveSseEvent(event));
  }
}

function canWrite(reply: FastifyReply) {
  return !reply.raw.destroyed && !reply.raw.writableEnded;
}

function responseMetadata(request: FastifyRequest) {
  return {
    apiVersion: WAVE_API_VERSION,
    requestId: request.id,
  };
}
