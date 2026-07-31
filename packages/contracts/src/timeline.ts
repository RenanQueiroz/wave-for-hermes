import { z } from 'zod';

import {
  WaveIdentifierSchema,
  WaveIsoDateTimeSchema,
  WaveResponseMetadataSchema,
} from './common.ts';
import { WaveAskHermesToolResultSchema } from './realtime.ts';
import { WaveConversationMessageSchema } from './sessions.ts';

export const WAVE_TIMELINE_DEFAULT_LIMIT = 100;
export const WAVE_TIMELINE_MAX_LIMIT = 200;

export const WaveTimelineMessageEntrySchema = z
  .object({
    id: WaveIdentifierSchema,
    message: WaveConversationMessageSchema.omit({ id: true }),
    source: z.enum(['hermes', 'wave']),
    turnId: WaveIdentifierSchema,
    type: z.literal('message'),
  })
  .strict();

export const WaveTimelineHandoffEntrySchema = z
  .object({
    completedAt: WaveIsoDateTimeSchema.optional(),
    createdAt: WaveIsoDateTimeSchema,
    id: WaveIdentifierSchema,
    instruction: z.string().trim().min(1).max(32_000),
    result: WaveAskHermesToolResultSchema.optional(),
    status: z.enum(['pending', 'completed', 'failed']),
    turnId: WaveIdentifierSchema,
    type: z.literal('handoff'),
  })
  .strict()
  .superRefine((entry, context) => {
    if (entry.status === 'pending' && entry.result !== undefined) {
      context.addIssue({
        code: 'custom',
        message: 'Pending handoffs cannot include a result.',
        path: ['result'],
      });
    }
    if (entry.status !== 'pending' && entry.result === undefined) {
      context.addIssue({
        code: 'custom',
        message: 'Settled handoffs require a result.',
        path: ['result'],
      });
    }
    if (entry.status === 'completed' && entry.result?.ok !== true) {
      context.addIssue({
        code: 'custom',
        message: 'Completed handoffs require a successful result.',
        path: ['result'],
      });
    }
    if (entry.status === 'failed' && entry.result?.ok !== false) {
      context.addIssue({
        code: 'custom',
        message: 'Failed handoffs require an error result.',
        path: ['result'],
      });
    }
  });

export const WaveTimelineEntrySchema = z.discriminatedUnion('type', [
  WaveTimelineMessageEntrySchema,
  WaveTimelineHandoffEntrySchema,
]);

export const WaveTimelineRequestSchema = z
  .object({
    before: WaveIdentifierSchema.optional(),
    limit: z
      .number()
      .int()
      .min(1)
      .max(WAVE_TIMELINE_MAX_LIMIT)
      .default(WAVE_TIMELINE_DEFAULT_LIMIT),
  })
  .strict();

export const WaveTimelineResponseSchema = WaveResponseMetadataSchema.extend({
  entries: z.array(WaveTimelineEntrySchema).max(WAVE_TIMELINE_MAX_LIMIT),
  hasMore: z.boolean(),
  limit: z.number().int().min(1).max(WAVE_TIMELINE_MAX_LIMIT),
  nextCursor: WaveIdentifierSchema.optional(),
  sessionId: WaveIdentifierSchema,
}).strict();

export type WaveTimelineEntry = z.infer<typeof WaveTimelineEntrySchema>;
export type WaveTimelineHandoffEntry = z.infer<
  typeof WaveTimelineHandoffEntrySchema
>;
export type WaveTimelineMessageEntry = z.infer<
  typeof WaveTimelineMessageEntrySchema
>;
export type WaveTimelineRequest = z.infer<typeof WaveTimelineRequestSchema>;
export type WaveTimelineResponse = z.infer<typeof WaveTimelineResponseSchema>;
