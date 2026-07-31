import { z } from 'zod';

import { WaveIdentifierSchema, WaveResponseMetadataSchema } from './common.ts';

export const WAVE_MAX_REALTIME_SDP_LENGTH = 48_000;
export const WAVE_MAX_ASK_HERMES_INSTRUCTION_LENGTH = 8_000;
export const WAVE_MAX_ASK_HERMES_ANSWER_LENGTH = 24_000;

export const WaveRealtimeSdpSchema = z
  .string()
  .min(1)
  .max(WAVE_MAX_REALTIME_SDP_LENGTH)
  .refine(
    (value) => value.startsWith('v=0\r\n') || value.startsWith('v=0\n'),
    'Expected a WebRTC SDP description.',
  );

export const WaveStartRealtimeCallRequestSchema = z
  .object({
    sdpOffer: WaveRealtimeSdpSchema,
  })
  .strict();

export const WaveRealtimeCallSchema = z
  .object({
    expiresAt: z.iso.datetime({ offset: true }),
    id: WaveIdentifierSchema,
    sdpAnswer: WaveRealtimeSdpSchema,
  })
  .strict();

export const WaveStartRealtimeCallResponseSchema =
  WaveResponseMetadataSchema.extend({
    call: WaveRealtimeCallSchema,
  }).strict();

export const WaveEndRealtimeCallResponseSchema =
  WaveResponseMetadataSchema.extend({
    callId: WaveIdentifierSchema,
    status: z.literal('ended'),
  }).strict();

export const WaveAskHermesArgumentsSchema = z
  .object({
    instruction: z
      .string()
      .trim()
      .min(1)
      .max(WAVE_MAX_ASK_HERMES_INSTRUCTION_LENGTH),
  })
  .strict();

export const WaveAskHermesToolErrorCodeSchema = z.enum([
  'busy',
  'cancelled',
  'invalid_arguments',
  'timeout',
  'unauthorized',
  'unknown_tool',
  'upstream_unavailable',
]);

export const WaveAskHermesToolResultSchema = z.discriminatedUnion('ok', [
  z
    .object({
      answer: z.string().min(1).max(WAVE_MAX_ASK_HERMES_ANSWER_LENGTH),
      ok: z.literal(true),
      truncated: z.boolean(),
    })
    .strict(),
  z
    .object({
      error: z
        .object({
          code: WaveAskHermesToolErrorCodeSchema,
          message: z.string().trim().min(1).max(300),
          retryable: z.boolean(),
        })
        .strict(),
      ok: z.literal(false),
    })
    .strict(),
]);

export type WaveAskHermesArguments = z.infer<
  typeof WaveAskHermesArgumentsSchema
>;
export type WaveAskHermesToolErrorCode = z.infer<
  typeof WaveAskHermesToolErrorCodeSchema
>;
export type WaveAskHermesToolResult = z.infer<
  typeof WaveAskHermesToolResultSchema
>;
export type WaveEndRealtimeCallResponse = z.infer<
  typeof WaveEndRealtimeCallResponseSchema
>;
export type WaveRealtimeCall = z.infer<typeof WaveRealtimeCallSchema>;
export type WaveStartRealtimeCallRequest = z.infer<
  typeof WaveStartRealtimeCallRequestSchema
>;
export type WaveStartRealtimeCallResponse = z.infer<
  typeof WaveStartRealtimeCallResponseSchema
>;
