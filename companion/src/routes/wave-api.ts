import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import {
  WAVE_API_VERSION,
  WAVE_COMPANION_SERVICE,
  WaveActiveTurnResponseSchema,
  WaveCancelTurnResponseSchema,
  WaveCompatibilityResponseSchema,
  WaveCreateSessionRequestSchema,
  WaveDeleteSessionResponseSchema,
  WaveDiagnosticsResponseSchema,
  WaveIdentifierSchema,
  WaveListSessionsRequestSchema,
  WaveScheduledJobListResponseSchema,
  WaveEndRealtimeCallResponseSchema,
  WaveRedeemPairingRequestSchema,
  WaveRedeemPairingResponseSchema,
  WaveResumeTurnStreamRequestSchema,
  WaveRevokeCurrentDeviceResponseSchema,
  WaveRealtimeVoiceIdSchema,
  WaveRealtimeVoiceListResponseSchema,
  WAVE_REALTIME_VOICE_SAMPLE_CONTENT_TYPE,
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
import type {
  ActiveTurnRegistry,
  TurnAttachment,
} from '../chat/active-turns.ts';
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
import { RealtimeProviderError } from '../realtime/realtime-provider.ts';
import type { RealtimeVoiceSampleSource } from '../realtime/realtime-voice-sampler.ts';

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
const VoiceSampleParamsSchema = z
  .object({
    voiceId: WaveRealtimeVoiceIdSchema,
  })
  .strict();

interface WaveApiServices {
  deviceStore: DeviceStore;
  hermesClient: HermesClient;
  interactionStore: InteractionStore;
  realtimeCallRegistry?: RealtimeCallRegistry;
  realtimeVoiceSampler?: RealtimeVoiceSampleSource;
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

  app.get(
    '/v1/diagnostics',
    { onRequest: authenticateDevice },
    async (request, reply) => {
      let hermes:
        | { status: 'compatible' }
        | {
            missingEndpoints: string[];
            missingFeatures: string[];
            status: 'incompatible';
          }
        | { status: 'unreachable' };
      try {
        const report = await services.hermesClient.probeCapabilities();
        hermes = report.supported
          ? { status: 'compatible' }
          : {
              missingEndpoints: report.missingEndpoints,
              missingFeatures: report.missingFeatures,
              status: 'incompatible',
            };
      } catch {
        hermes = { status: 'unreachable' };
      }

      return reply.send(
        WaveDiagnosticsResponseSchema.parse({
          ...responseMetadata(request),
          companion: {
            serviceVersion: SERVICE_VERSION,
            uptimeSeconds: Math.max(0, Math.floor(process.uptime())),
          },
          features: {
            chat: true,
            pairing: true,
            realtime: services.realtimeCallRegistry !== undefined,
          },
          generatedAt: now().toISOString(),
          hermes,
        }),
      );
    },
  );

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

  app.delete(
    '/v1/device',
    { onRequest: authenticateDevice },
    async (request, reply) => {
      const device = requireAuthenticatedDevice(request);
      services.deviceStore.revokeDevice(device.id);
      services.turnRegistry.abortDevice(device.id, 'cancelled');
      await services.realtimeCallRegistry?.abortDevice(device.id);
      return reply.send(
        WaveRevokeCurrentDeviceResponseSchema.parse({
          ...responseMetadata(request),
          deviceId: device.id,
          revoked: true,
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

  app.get(
    '/v1/realtime/voices',
    { onRequest: authenticateDevice },
    async (request, reply) => {
      const realtimeCallRegistry = requireRealtimeCallRegistry(
        services.realtimeCallRegistry,
      );
      return reply.send(
        WaveRealtimeVoiceListResponseSchema.parse({
          ...responseMetadata(request),
          ...realtimeCallRegistry.getVoiceCatalog(),
          ...(services.realtimeVoiceSampler
            ? { samplesVersion: services.realtimeVoiceSampler.samplesVersion }
            : {}),
        }),
      );
    },
  );

  app.get(
    '/v1/realtime/voices/:voiceId/sample',
    {
      config: {
        rateLimit: {
          max: 30,
          timeWindow: '1 minute',
        },
      },
      onRequest: authenticateDevice,
    },
    async (request, reply) => {
      const { voiceId } = VoiceSampleParamsSchema.parse(request.params);
      const realtimeCallRegistry = requireRealtimeCallRegistry(
        services.realtimeCallRegistry,
      );
      const sampler = requireRealtimeVoiceSampler(
        services.realtimeVoiceSampler,
      );
      const catalog = realtimeCallRegistry.getVoiceCatalog();
      if (!catalog.voices.some((voice) => voice.id === voiceId)) {
        throw new WaveHttpError(
          'The requested Wave voice is not available on this Gateway.',
          {
            code: 'not_found',
            statusCode: 404,
          },
        );
      }
      let sample: Buffer;
      try {
        sample = await sampler.getSample(voiceId);
      } catch (error) {
        throw normalizeSampleError(error);
      }
      return reply
        .header('content-type', WAVE_REALTIME_VOICE_SAMPLE_CONTENT_TYPE)
        .send(sample);
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
        ...(input.voiceId ? { voiceId: input.voiceId } : {}),
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
      if (!services.deviceStore.isDeviceActive(device.id)) {
        throw new WaveHttpError(
          'This Wave device is no longer authorized for Hermes.',
          {
            code: 'unauthorized',
            statusCode: 401,
          },
        );
      }
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

  app.get(
    '/v1/sessions/:sessionId/turns/active',
    { onRequest: authenticateDevice },
    async (request, reply) => {
      const device = requireAuthenticatedDevice(request);
      const { sessionId } = SessionParamsSchema.parse(request.params);
      const activeTurn = services.turnRegistry.activeTurnFor(
        device.id,
        sessionId,
      );
      return reply.send(
        WaveActiveTurnResponseSchema.parse({
          ...responseMetadata(request),
          activeTurn: activeTurn ?? null,
          sessionId,
        }),
      );
    },
  );

  app.get(
    '/v1/sessions/:sessionId/turns/:turnId/stream',
    { onRequest: authenticateDevice },
    async (request, reply) => {
      const device = requireAuthenticatedDevice(request);
      const { sessionId, turnId } = TurnParamsSchema.parse(request.params);
      const { after } = WaveResumeTurnStreamRequestSchema.parse(request.query);
      const record = services.turnRegistry.lookup(device.id, sessionId, turnId);
      if (!record) {
        throw new WaveHttpError('The Wave turn was not found.', {
          code: 'not_found',
          statusCode: 404,
        });
      }
      const frames = record.buffer.replayAfter(after);
      if (frames === undefined) {
        throw new WaveHttpError(
          'The Wave turn can no longer be replayed from that position.',
          {
            code: 'not_found',
            statusCode: 404,
          },
        );
      }
      // No awaits between the lookup above and the attachment handoff below:
      // the replay plus live takeover is atomic on the event loop, so no
      // emitted frame can fall between the buffer copy and the attachment.
      const attachment = createSseAttachment(reply);
      reply.raw.once('close', () =>
        services.turnRegistry.clearAttachment(turnId, attachment),
      );
      reply.hijack();
      reply.raw.writeHead(200, sseHeaders(turnId));
      for (const frame of frames) {
        attachment.write(frame);
      }
      if (record.state === 'completed') {
        attachment.end();
        return;
      }
      services.turnRegistry.setAttachment(turnId, attachment);
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

function requireRealtimeVoiceSampler(
  realtimeVoiceSampler: RealtimeVoiceSampleSource | undefined,
) {
  if (!realtimeVoiceSampler) {
    throw new WaveHttpError(
      'Voice previews are not available on this Wave Companion.',
      {
        code: 'upstream_unavailable',
        statusCode: 503,
      },
    );
  }
  return realtimeVoiceSampler;
}

function normalizeSampleError(error: unknown) {
  if (!(error instanceof RealtimeProviderError)) {
    return new WaveHttpError(
      'OpenAI Realtime could not generate the voice sample.',
      {
        code: 'upstream_unavailable',
        retryable: true,
        statusCode: 503,
      },
    );
  }
  switch (error.kind) {
    case 'rate_limited':
      return new WaveHttpError('OpenAI Realtime is rate limited.', {
        code: 'rate_limited',
        retryable: true,
        statusCode: 429,
      });
    case 'timeout':
      return new WaveHttpError(
        'OpenAI Realtime did not generate the voice sample before the timeout.',
        {
          code: 'timeout',
          retryable: true,
          statusCode: 504,
        },
      );
    case 'authentication':
    case 'protocol':
    case 'unavailable':
      return new WaveHttpError(
        'OpenAI Realtime could not generate the voice sample.',
        {
          code: 'upstream_unavailable',
          retryable: error.retryable,
          statusCode: 503,
        },
      );
  }
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
  // The initiating response is only the first attachment. Losing it detaches
  // the turn instead of aborting Hermes; the device can reattach through the
  // resume route while the turn runs and for the resume window afterwards.
  const attachment = createSseAttachment(reply);
  reply.raw.once('close', () =>
    turnRegistry.clearAttachment(turn.turnId, attachment),
  );
  reply.hijack();
  reply.raw.writeHead(200, sseHeaders(turn.turnId));
  turnRegistry.setAttachment(turn.turnId, attachment);
  await runTurn(config, hermesClient, turnRegistry, turn, input, now);
}

async function runTurn(
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
  const emit = (event: WaveTurnEvent) => {
    turnRegistry.record(turn.turnId, event.sequence, formatWaveSseEvent(event));
  };

  emit(events.createStarted());
  resetIdleTimer(true);

  try {
    for await (const event of hermesClient.streamChat(turn.sessionId, {
      input: toHermesChatContent(input),
      signal: turn.controller.signal,
    })) {
      resetIdleTimer(false);
      const normalized = events.fromHermes(event);
      if (normalized) {
        emit(normalized);
      }
      if (event.type === 'error') {
        break;
      }
    }
  } catch (error) {
    const failure = streamFailureEvent(events, turn.abortReason(), error);
    if (failure) {
      emit(failure);
    }
  } finally {
    if (idleTimer) {
      clearTimeout(idleTimer);
    }
    clearTimeout(totalTimer);
    turnRegistry.finish(turn.turnId);
  }
}

function sseHeaders(turnId: string) {
  return {
    'cache-control': 'no-store',
    connection: 'keep-alive',
    'content-type': 'text/event-stream; charset=utf-8',
    'x-accel-buffering': 'no',
    'x-wave-turn-id': turnId,
  };
}

function createSseAttachment(reply: FastifyReply): TurnAttachment {
  return {
    end: () => {
      if (canWrite(reply)) {
        reply.raw.end();
      }
    },
    write: (frame) => {
      if (canWrite(reply)) {
        reply.raw.write(frame);
      }
    },
  };
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

function canWrite(reply: FastifyReply) {
  return !reply.raw.destroyed && !reply.raw.writableEnded;
}

function responseMetadata(request: FastifyRequest) {
  return {
    apiVersion: WAVE_API_VERSION,
    requestId: request.id,
  };
}
