import { z } from 'zod';

import { WaveIdentifierSchema, WaveResponseMetadataSchema } from './common.ts';

export const WAVE_MAX_REALTIME_SDP_LENGTH = 48_000;
export const WAVE_MAX_ASK_HERMES_INSTRUCTION_LENGTH = 8_000;
export const WAVE_MAX_ASK_HERMES_ANSWER_LENGTH = 24_000;
export const WAVE_MAX_REALTIME_VOICE_SAMPLE_BYTES = 600_000;
export const WAVE_REALTIME_VOICE_SAMPLE_CONTENT_TYPE = 'audio/wav';
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

// Opaque token that changes only when the Gateway's voice output would sound
// different (in practice: when its Realtime model changes). Clients key their
// downloaded sample cache on it and must not interpret its contents.
export const WaveRealtimeVoiceSamplesVersionSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/);

export const WaveRealtimeVoiceOptionSchema = z
  .object({
    description: z.string().trim().min(1).max(160),
    id: WaveRealtimeVoiceIdSchema,
    label: z.string().trim().min(1).max(40),
  })
  .strict();

export const WaveRealtimeVoiceListResponseSchema =
  WaveResponseMetadataSchema.extend({
    defaultVoiceId: WaveRealtimeVoiceIdSchema,
    // Absent when the Gateway predates voice previews; clients hide previews.
    samplesVersion: WaveRealtimeVoiceSamplesVersionSchema.optional(),
    voices: z.array(WaveRealtimeVoiceOptionSchema).min(1).max(32),
  })
    .strict()
    .superRefine((value, context) => {
      const voiceIds = new Set(value.voices.map((voice) => voice.id));
      if (voiceIds.size !== value.voices.length) {
        context.addIssue({
          code: 'custom',
          message: 'Realtime voice identifiers must be unique.',
          path: ['voices'],
        });
      }
      if (!voiceIds.has(value.defaultVoiceId)) {
        context.addIssue({
          code: 'custom',
          message: 'The default Realtime voice must be available.',
          path: ['defaultVoiceId'],
        });
      }
    });

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
    voiceId: WaveRealtimeVoiceIdSchema.optional(),
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
export type WaveRealtimeVoiceId = z.infer<typeof WaveRealtimeVoiceIdSchema>;
export type WaveRealtimeVoiceListResponse = z.infer<
  typeof WaveRealtimeVoiceListResponseSchema
>;
export type WaveRealtimeVoiceOption = z.infer<
  typeof WaveRealtimeVoiceOptionSchema
>;
export type WaveStartRealtimeCallRequest = z.infer<
  typeof WaveStartRealtimeCallRequestSchema
>;
export type WaveStartRealtimeCallResponse = z.infer<
  typeof WaveStartRealtimeCallResponseSchema
>;
