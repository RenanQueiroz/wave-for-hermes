import { z } from 'zod';

import {
  WaveIdentifierSchema,
  WaveIsoDateTimeSchema,
  WaveResponseMetadataSchema,
} from './common.ts';

export const WaveScheduledJobSchema = z
  .object({
    createdAt: WaveIsoDateTimeSchema.optional(),
    enabled: z.boolean(),
    id: WaveIdentifierSchema,
    lastRunAt: WaveIsoDateTimeSchema.optional(),
    lastStatus: z.string().trim().min(1).max(100).optional(),
    name: z.string().trim().min(1).max(200),
    nextRunAt: WaveIsoDateTimeSchema.optional(),
    schedule: z.string().trim().min(1).max(300),
    state: z.string().trim().min(1).max(100),
  })
  .strict();

export const WaveScheduledJobListResponseSchema =
  WaveResponseMetadataSchema.extend({
    jobs: z.array(WaveScheduledJobSchema).max(10_000),
  }).strict();

export type WaveScheduledJob = z.infer<typeof WaveScheduledJobSchema>;
export type WaveScheduledJobListResponse = z.infer<
  typeof WaveScheduledJobListResponseSchema
>;
