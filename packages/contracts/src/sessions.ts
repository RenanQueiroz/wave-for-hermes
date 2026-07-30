import { z } from 'zod';

import {
  WaveIdentifierSchema,
  WaveIsoDateTimeSchema,
  WaveResponseMetadataSchema,
} from './common.ts';

export const WaveCompatibilityResponseSchema =
  WaveResponseMetadataSchema.extend({
    compatible: z.boolean(),
    missingEndpoints: z.array(z.string().trim().min(1).max(100)).max(100),
    missingFeatures: z.array(z.string().trim().min(1).max(100)).max(100),
  }).strict();

export const WaveSessionSummarySchema = z
  .object({
    id: WaveIdentifierSchema,
    lastActiveAt: WaveIsoDateTimeSchema.optional(),
    messageCount: z.number().int().nonnegative().optional(),
    preview: z.string().max(1_000).optional(),
    startedAt: WaveIsoDateTimeSchema.optional(),
    title: z.string().trim().min(1).max(300).optional(),
    toolCallCount: z.number().int().nonnegative().optional(),
  })
  .strict();

export const WaveSessionListResponseSchema =
  WaveResponseMetadataSchema.extend({
    sessions: z.array(WaveSessionSummarySchema).max(200),
  }).strict();

export const WaveImportSessionsRequestSchema = z.object({}).strict();

export const WaveCreateSessionRequestSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

export const WaveSessionResponseSchema = WaveResponseMetadataSchema.extend({
  session: WaveSessionSummarySchema,
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
    toolName: z.string().trim().min(1).max(100).optional(),
  })
  .strict();

export const WaveSessionHistoryResponseSchema =
  WaveResponseMetadataSchema.extend({
    messages: z.array(WaveConversationMessageSchema).max(10_000),
    sessionId: WaveIdentifierSchema,
  }).strict();

export const WaveStartTurnRequestSchema = z
  .object({
    input: z.string().trim().min(1).max(32_000),
  })
  .strict();

export const WaveCancelTurnResponseSchema =
  WaveResponseMetadataSchema.extend({
    status: z.literal('cancellation_requested'),
    turnId: WaveIdentifierSchema,
  }).strict();

export type WaveCompatibilityResponse = z.infer<
  typeof WaveCompatibilityResponseSchema
>;
export type WaveCancelTurnResponse = z.infer<
  typeof WaveCancelTurnResponseSchema
>;
export type WaveConversationMessage = z.infer<
  typeof WaveConversationMessageSchema
>;
export type WaveCreateSessionRequest = z.infer<
  typeof WaveCreateSessionRequestSchema
>;
export type WaveImportSessionsRequest = z.infer<
  typeof WaveImportSessionsRequestSchema
>;
export type WaveSessionHistoryResponse = z.infer<
  typeof WaveSessionHistoryResponseSchema
>;
export type WaveSessionListResponse = z.infer<
  typeof WaveSessionListResponseSchema
>;
export type WaveSessionResponse = z.infer<typeof WaveSessionResponseSchema>;
export type WaveSessionSummary = z.infer<typeof WaveSessionSummarySchema>;
export type WaveStartTurnRequest = z.infer<
  typeof WaveStartTurnRequestSchema
>;
