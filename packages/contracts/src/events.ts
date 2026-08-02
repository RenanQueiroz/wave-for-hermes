import { z } from 'zod';

import {
  WaveApiVersionSchema,
  WaveErrorSchema,
  WaveIdentifierSchema,
  WaveIsoDateTimeSchema,
} from './common.ts';
import { WaveToolDetailSchema } from './tool-details.ts';

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
    toolInput: WaveToolDetailSchema.optional(),
    toolName: z.string().trim().min(1).max(100).optional(),
    toolOutput: WaveToolDetailSchema.optional(),
    toolOutputIsPreview: z.boolean().optional(),
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

/**
 * A mid-turn prompt from the agent: it has paused the running turn and waits
 * for the user's decision (tool approval), an answer (clarify), or a
 * credential (secret/sudo — which Wave declines rather than collects).
 */
export const WavePromptRequestEventSchema = z
  .object({
    ...WaveTurnEventBaseShape,
    /** Whether a free-text answer is accepted (clarify always accepts one). */
    allowsFreeText: z.boolean(),
    /** Selectable responses, in display order. May be empty for free text. */
    choices: z.array(z.string().trim().min(1).max(100)).max(8),
    /** The command awaiting approval, as a bounded inert detail. */
    command: WaveToolDetailSchema.optional(),
    /** Short human description (approval pattern, e.g. "delete in root path"). */
    description: z.string().trim().min(1).max(300).optional(),
    kind: z.enum(['approval', 'clarify', 'secret', 'sudo']),
    messageId: WaveIdentifierSchema.optional(),
    /** Correlates the response; opaque to screens. */
    promptId: z.string().trim().min(1).max(128),
    /** The question being asked (clarify). */
    question: z.string().trim().min(1).max(2_000).optional(),
    type: z.literal('prompt.request'),
  })
  .strict();

/**
 * The prompt stopped waiting — answered from this device, answered elsewhere,
 * or expired server-side. Screens must clear the prompt UI either way.
 */
export const WavePromptResolvedEventSchema = z
  .object({
    ...WaveTurnEventBaseShape,
    promptId: z.string().trim().min(1).max(128),
    type: z.literal('prompt.resolved'),
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
  WavePromptRequestEventSchema,
  WavePromptResolvedEventSchema,
  WaveAssistantCompletedEventSchema,
  WaveTurnCompletedEventSchema,
  WaveTurnErrorEventSchema,
]);

export type WaveTurnEvent = z.infer<typeof WaveTurnEventSchema>;
