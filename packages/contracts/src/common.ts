import { z } from 'zod';

export const WAVE_API_VERSION = 'v1' as const;

export const WaveApiVersionSchema = z.literal(WAVE_API_VERSION);
export const WaveIdentifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .regex(/^[^\u0000-\u001f\u007f/?#\\]+$/);
export const WaveIsoDateTimeSchema = z.iso.datetime({ offset: true });

export const WaveResponseMetadataSchema = z
  .object({
    apiVersion: WaveApiVersionSchema,
    requestId: z.string().trim().min(1).max(128).optional(),
  })
  .strict();

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

export type WaveError = z.infer<typeof WaveErrorSchema>;
export type WaveErrorCode = z.infer<typeof WaveErrorCodeSchema>;
