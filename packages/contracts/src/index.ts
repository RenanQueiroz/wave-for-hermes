import { z } from 'zod';

export const WAVE_API_VERSION = 'v1' as const;
export const WAVE_COMPANION_SERVICE = 'wave-companion' as const;

export const WaveApiVersionSchema = z.literal(WAVE_API_VERSION);

export const WaveResponseMetadataSchema = z
  .object({
    apiVersion: WaveApiVersionSchema,
    requestId: z.string().trim().min(1).max(128).optional(),
  })
  .strict();

export const WaveFeatureAvailabilitySchema = z
  .object({
    chat: z.boolean(),
    pairing: z.boolean(),
    realtime: z.boolean(),
  })
  .strict();

export const WaveStatusResponseSchema = WaveResponseMetadataSchema.extend({
  features: WaveFeatureAvailabilitySchema,
  hermes: z
    .object({
      configured: z.boolean(),
    })
    .strict(),
  serverTime: z.iso.datetime({ offset: true }),
  service: z.literal(WAVE_COMPANION_SERVICE),
  serviceVersion: z.string().trim().regex(/^\d+\.\d+\.\d+$/),
  status: z.literal('ok'),
}).strict();

export type WaveStatusResponse = z.infer<typeof WaveStatusResponseSchema>;

export const WaveErrorCodeSchema = z.enum([
  'bad_request',
  'cancelled',
  'conflict',
  'forbidden',
  'internal',
  'not_found',
  'rate_limited',
  'timeout',
  'unauthorized',
  'upstream_incompatible',
  'upstream_unavailable',
]);

export const WaveErrorSchema = z
  .object({
    code: WaveErrorCodeSchema,
    correlationId: z.string().trim().min(1).max(128).optional(),
    message: z.string().trim().min(1).max(300),
    retryable: z.boolean(),
  })
  .strict();

export const WaveErrorResponseSchema = z
  .object({
    apiVersion: WaveApiVersionSchema,
    error: WaveErrorSchema,
  })
  .strict();

export type WaveError = z.infer<typeof WaveErrorSchema>;
export type WaveErrorCode = z.infer<typeof WaveErrorCodeSchema>;
export type WaveErrorResponse = z.infer<typeof WaveErrorResponseSchema>;

export const WaveEventEnvelopeSchema = z
  .object({
    apiVersion: WaveApiVersionSchema,
    eventId: z.string().trim().min(1).max(128),
    sequence: z.number().int().nonnegative(),
    timestamp: z.iso.datetime({ offset: true }),
    type: z.string().trim().min(1).max(100),
  })
  .strict();

export type WaveEventEnvelope = z.infer<typeof WaveEventEnvelopeSchema>;
