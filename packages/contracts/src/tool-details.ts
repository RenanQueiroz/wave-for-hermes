import { z } from 'zod';

export const WAVE_TOOL_DETAIL_MAX_CHARS = 64_000;

export const WaveToolDetailSchema = z
  .object({
    text: z.string().max(WAVE_TOOL_DETAIL_MAX_CHARS),
    truncated: z.boolean(),
  })
  .strict();

export type WaveToolDetail = z.infer<typeof WaveToolDetailSchema>;
