import { z } from 'zod';

import { WaveIdentifierSchema, WaveResponseMetadataSchema } from './common.ts';

export const WAVE_MAX_REALTIME_SDP_LENGTH = 48_000;
export const WAVE_MAX_ASK_HERMES_INSTRUCTION_LENGTH = 8_000;
export const WAVE_MAX_ASK_HERMES_ANSWER_LENGTH = 24_000;
export const WAVE_MAX_CORRECT_HERMES_INSTRUCTION_LENGTH = 8_000;
export const WAVE_REALTIME_VOICE_IDS = [
  'alloy',
  'ash',
  'ballad',
  'cedar',
  'coral',
  'echo',
  'marin',
  'sage',
  'shimmer',
  'verse',
] as const;

export const WaveRealtimeVoiceIdSchema = z.enum(WAVE_REALTIME_VOICE_IDS);

export const WaveRealtimeSdpSchema = z
  .string()
  .min(1)
  .max(WAVE_MAX_REALTIME_SDP_LENGTH)
  .refine(
    (value) => value.startsWith('v=0\r\n') || value.startsWith('v=0\n'),
    'Expected a WebRTC SDP description.',
  );

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

/**
 * A correction for the one Hermes execution already bound to trusted Wave
 * call state. Model-selected identifiers and redirect modes are deliberately
 * absent, and strict parsing rejects them as extra fields.
 */
export const WaveCorrectHermesArgumentsSchema = z
  .object({
    instruction: z
      .string()
      .trim()
      .min(1)
      .max(WAVE_MAX_CORRECT_HERMES_INSTRUCTION_LENGTH),
  })
  .strict();

export const WaveCorrectHermesToolResultSchema = z.discriminatedUnion(
  'status',
  [
    z
      .object({
        ok: z.literal(true),
        status: z.enum(['queued', 'redirected']),
      })
      .strict(),
    z
      .object({
        message: z.string().trim().min(1).max(300),
        ok: z.literal(false),
        retryable: z.boolean(),
        status: z.enum(['nothing_active', 'rejected']),
      })
      .strict(),
  ],
);

export const WaveRealtimeToolResultSchema = z.union([
  WaveAskHermesToolResultSchema,
  WaveCorrectHermesToolResultSchema,
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
export type WaveCorrectHermesArguments = z.infer<
  typeof WaveCorrectHermesArgumentsSchema
>;
export type WaveCorrectHermesToolResult = z.infer<
  typeof WaveCorrectHermesToolResultSchema
>;
export type WaveEndRealtimeCallResponse = z.infer<
  typeof WaveEndRealtimeCallResponseSchema
>;
export type WaveRealtimeCall = z.infer<typeof WaveRealtimeCallSchema>;
export type WaveRealtimeVoiceId = z.infer<typeof WaveRealtimeVoiceIdSchema>;
export type WaveRealtimeToolResult = z.infer<
  typeof WaveRealtimeToolResultSchema
>;
export type WaveStartRealtimeCallResponse = z.infer<
  typeof WaveStartRealtimeCallResponseSchema
>;
