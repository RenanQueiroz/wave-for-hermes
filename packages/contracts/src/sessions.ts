import { z } from 'zod';

import {
  WaveIdentifierSchema,
  WaveIsoDateTimeSchema,
  WaveResponseMetadataSchema,
} from './common.ts';
import { WaveToolDetailSchema } from './tool-details.ts';

export const WAVE_MAX_IMAGE_ATTACHMENT_BYTES = 4_000_000;
export const WAVE_MAX_REDIRECT_CHARS = 32_000;
export const WAVE_MAX_TEXT_ATTACHMENT_CHARS = 128_000;
export const WAVE_MAX_TURN_ATTACHMENTS = 4;
const WAVE_MAX_IMAGE_DATA_URL_CHARS = 5_400_128;
const WaveAttachmentNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine(
    (value) => !/[\u0000-\u001f\u007f]/.test(value),
    'Attachment names cannot contain control characters.',
  );

export const WaveSessionLiveStatusSchema = z.enum([
  'idle',
  'starting',
  'waiting',
  'working',
]);

/**
 * Wave-owned presentation categories for Hermes's open-ended `source` field.
 * New upstream identifiers must fall back to `other` rather than crossing the
 * protocol boundary or disappearing from the conversation list.
 */
export const WaveSessionSourceSchema = z.enum([
  'automation',
  'chat',
  'external',
  'other',
]);

export const WaveSessionSummarySchema = z
  .object({
    id: WaveIdentifierSchema,
    lastActiveAt: WaveIsoDateTimeSchema.optional(),
    liveStatus: WaveSessionLiveStatusSchema.default('idle'),
    messageCount: z.number().int().nonnegative().optional(),
    pinned: z.boolean().default(false),
    preview: z.string().max(1_000).optional(),
    source: WaveSessionSourceSchema.default('chat'),
    startedAt: WaveIsoDateTimeSchema.optional(),
    title: z.string().trim().min(1).max(300).optional(),
    toolCallCount: z.number().int().nonnegative().optional(),
  })
  .strict();

export const WaveSessionListResponseSchema = WaveResponseMetadataSchema.extend({
  hasMore: z.boolean(),
  limit: z.number().int().min(1).max(200),
  offset: z.number().int().nonnegative().max(1_000_000),
  sessions: z.array(WaveSessionSummarySchema).max(200),
}).strict();

export const WaveSessionResponseSchema = WaveResponseMetadataSchema.extend({
  session: WaveSessionSummarySchema,
}).strict();

export const WaveDeleteSessionResponseSchema =
  WaveResponseMetadataSchema.extend({
    deleted: z.literal(true),
    sessionId: WaveIdentifierSchema,
  }).strict();

export const WaveConversationRoleSchema = z.enum([
  'assistant',
  'system',
  'tool',
  'unknown',
  'user',
]);

export const WaveConversationMessageSchema = z
  .object({
    content: z.string().max(1_000_000),
    createdAt: WaveIsoDateTimeSchema.optional(),
    id: WaveIdentifierSchema.optional(),
    role: WaveConversationRoleSchema,
    toolInput: WaveToolDetailSchema.optional(),
    toolName: z.string().trim().min(1).max(100).optional(),
    toolOutput: WaveToolDetailSchema.optional(),
  })
  .strict();

export const WaveSessionHistoryResponseSchema =
  WaveResponseMetadataSchema.extend({
    messages: z.array(WaveConversationMessageSchema).max(10_000),
    sessionId: WaveIdentifierSchema,
  }).strict();

export const WaveTurnTextPartSchema = z
  .object({
    text: z.string().trim().min(1).max(32_000),
    type: z.literal('text'),
  })
  .strict();

export const WaveTurnImagePartSchema = z
  .object({
    dataUrl: z
      .string()
      .max(WAVE_MAX_IMAGE_DATA_URL_CHARS)
      .regex(/^data:image\/(?:jpeg|png|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/)
      .refine((value) => {
        const encoded = value.slice(value.indexOf(',') + 1);
        if (encoded.length % 4 !== 0) return false;
        const padding = encoded.endsWith('==')
          ? 2
          : encoded.endsWith('=')
            ? 1
            : 0;
        const decodedBytes = Math.floor((encoded.length * 3) / 4) - padding;
        return (
          decodedBytes > 0 && decodedBytes <= WAVE_MAX_IMAGE_ATTACHMENT_BYTES
        );
      }, 'The image attachment is invalid or too large.'),
    mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
    name: WaveAttachmentNameSchema,
    type: z.literal('image'),
  })
  .strict()
  .refine(
    (part) => part.dataUrl.startsWith(`data:${part.mimeType};base64,`),
    'The image MIME type does not match its data URL.',
  );

export const WaveTurnTextFilePartSchema = z
  .object({
    mimeType: z.string().trim().min(1).max(100),
    name: WaveAttachmentNameSchema,
    text: z.string().min(1).max(WAVE_MAX_TEXT_ATTACHMENT_CHARS),
    type: z.literal('text_file'),
  })
  .strict();

export const WaveTurnInputPartSchema = z.discriminatedUnion('type', [
  WaveTurnTextPartSchema,
  WaveTurnImagePartSchema,
  WaveTurnTextFilePartSchema,
]);

export const WaveTurnInputSchema = z.union([
  z.string().trim().min(1).max(32_000),
  z
    .array(WaveTurnInputPartSchema)
    .min(1)
    .max(WAVE_MAX_TURN_ATTACHMENTS + 1)
    .superRefine((parts, context) => {
      if (
        parts.filter((part) => part.type !== 'text').length >
        WAVE_MAX_TURN_ATTACHMENTS
      ) {
        context.addIssue({
          code: 'custom',
          message: 'Too many attachments.',
        });
      }
      if (!parts.some((part) => part.type === 'text')) {
        context.addIssue({
          code: 'custom',
          message: 'Attachment turns require a message.',
        });
      }
    }),
]);

export const WaveCancelTurnResponseSchema = WaveResponseMetadataSchema.extend({
  status: z.literal('cancellation_requested'),
  turnId: WaveIdentifierSchema,
}).strict();

/**
 * A text-only correction for the one active turn already bound by trusted
 * client state. Session and turn identifiers deliberately do not belong in
 * this model-controlled/user-entered payload.
 */
export const WaveRedirectTurnRequestSchema = z
  .object({
    text: z.string().trim().min(1).max(WAVE_MAX_REDIRECT_CHARS),
  })
  .strict();

export const WaveRedirectTurnResponseSchema = WaveResponseMetadataSchema.extend(
  {
    sessionId: WaveIdentifierSchema,
    status: z.enum(['queued', 'redirected', 'rejected']),
  },
).strict();

export const WaveActiveTurnResponseSchema = WaveResponseMetadataSchema.extend({
  activeTurn: z
    .object({
      latestSequence: z.number().int().min(-1).max(1_000_000),
      turnId: WaveIdentifierSchema,
    })
    .strict()
    .nullable(),
  lastActiveAt: WaveIsoDateTimeSchema.optional(),
  liveStatus: WaveSessionLiveStatusSchema,
  sessionId: WaveIdentifierSchema,
}).strict();

export type WaveActiveTurnResponse = z.infer<
  typeof WaveActiveTurnResponseSchema
>;
export type WaveCancelTurnResponse = z.infer<
  typeof WaveCancelTurnResponseSchema
>;
export type WaveConversationMessage = z.infer<
  typeof WaveConversationMessageSchema
>;
export type WaveDeleteSessionResponse = z.infer<
  typeof WaveDeleteSessionResponseSchema
>;
export type WaveRedirectTurnRequest = z.infer<
  typeof WaveRedirectTurnRequestSchema
>;
export type WaveRedirectTurnResponse = z.infer<
  typeof WaveRedirectTurnResponseSchema
>;
export type WaveSessionHistoryResponse = z.infer<
  typeof WaveSessionHistoryResponseSchema
>;
export type WaveSessionListResponse = z.infer<
  typeof WaveSessionListResponseSchema
>;
export type WaveSessionResponse = z.infer<typeof WaveSessionResponseSchema>;
export type WaveSessionSummary = z.infer<typeof WaveSessionSummarySchema>;
export type WaveSessionLiveStatus = z.infer<typeof WaveSessionLiveStatusSchema>;
export type WaveSessionSource = z.infer<typeof WaveSessionSourceSchema>;
export type WaveTurnInput = z.infer<typeof WaveTurnInputSchema>;
export type WaveTurnInputPart = z.infer<typeof WaveTurnInputPartSchema>;
