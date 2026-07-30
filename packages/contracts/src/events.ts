import { z } from 'zod';

import {
  WaveApiVersionSchema,
  WaveErrorSchema,
  WaveIdentifierSchema,
  WaveIsoDateTimeSchema,
} from './common.ts';

const WaveTurnEventBaseShape = {
  apiVersion: WaveApiVersionSchema,
  eventId: z.string().trim().min(1).max(128),
  sequence: z.number().int().nonnegative(),
  sessionId: WaveIdentifierSchema,
  timestamp: WaveIsoDateTimeSchema,
  turnId: WaveIdentifierSchema,
};

export const WaveTurnStartedEventSchema = z
  .object({
    ...WaveTurnEventBaseShape,
    type: z.literal('turn.started'),
  })
  .strict();

export const WaveAssistantStartedEventSchema = z
  .object({
    ...WaveTurnEventBaseShape,
    messageId: WaveIdentifierSchema,
    type: z.literal('assistant.started'),
  })
  .strict();

export const WaveAssistantDeltaEventSchema = z
  .object({
    ...WaveTurnEventBaseShape,
    delta: z.string().min(1).max(32_000),
    messageId: WaveIdentifierSchema,
    type: z.literal('assistant.delta'),
  })
  .strict();

export const WaveToolStatusEventSchema = z
  .object({
    ...WaveTurnEventBaseShape,
    messageId: WaveIdentifierSchema.optional(),
    status: z.enum(['completed', 'failed', 'progress', 'started']),
    toolName: z.string().trim().min(1).max(100).optional(),
    type: z.literal('tool.status'),
  })
  .strict();

export const WaveAssistantCompletedEventSchema = z
  .object({
    ...WaveTurnEventBaseShape,
    content: z.string().max(1_000_000),
    interrupted: z.boolean(),
    messageId: WaveIdentifierSchema,
    partial: z.boolean(),
    type: z.literal('assistant.completed'),
  })
  .strict();

export const WaveTurnCompletedEventSchema = z
  .object({
    ...WaveTurnEventBaseShape,
    completed: z.boolean(),
    type: z.literal('turn.completed'),
  })
  .strict();

export const WaveTurnErrorEventSchema = z
  .object({
    ...WaveTurnEventBaseShape,
    error: WaveErrorSchema,
    type: z.literal('turn.error'),
  })
  .strict();

export const WaveTurnEventSchema = z.discriminatedUnion('type', [
  WaveTurnStartedEventSchema,
  WaveAssistantStartedEventSchema,
  WaveAssistantDeltaEventSchema,
  WaveToolStatusEventSchema,
  WaveAssistantCompletedEventSchema,
  WaveTurnCompletedEventSchema,
  WaveTurnErrorEventSchema,
]);

export type WaveTurnEvent = z.infer<typeof WaveTurnEventSchema>;
