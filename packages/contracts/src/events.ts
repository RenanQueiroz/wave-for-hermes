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

/** A completed assistant segment within a turn that is still running. */
export const WaveAssistantInterimEventSchema = z
  .object({
    ...WaveTurnEventBaseShape,
    content: z.string().trim().min(1).max(1_000_000),
    messageId: WaveIdentifierSchema,
    type: z.literal('assistant.interim'),
  })
  .strict();

/**
 * A bounded slice of the turn's reasoning trace. Emission is gated
 * server-side (`show_reasoning`); absence is normal. The client accumulates
 * deltas into one bounded inert trace per assistant message.
 */
export const WaveReasoningDeltaEventSchema = z
  .object({
    ...WaveTurnEventBaseShape,
    delta: z.string().min(1).max(32_000),
    messageId: WaveIdentifierSchema,
    type: z.literal('reasoning.delta'),
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
    /** The final text replaces the latest sealed preview segment. */
    replacesLastInterim: z.boolean().optional(),
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
    kind: z.enum(['approval', 'clarify', 'mcp-setup', 'secret', 'sudo']),
    messageId: WaveIdentifierSchema.optional(),
    /** Bounded MCP catalog/config name needed only to decline setup safely. */
    server: z.string().trim().min(1).max(200).optional(),
    /** Correlates the response; opaque to screens. */
    promptId: z.string().trim().min(1).max(128),
    /** The question being asked (clarify). */
    question: z.string().trim().min(1).max(2_000).optional(),
    type: z.literal('prompt.request'),
  })
  .strict()
  .superRefine((event, context) => {
    if (event.kind === 'mcp-setup' && !event.server) {
      context.addIssue({
        code: 'custom',
        message: 'MCP setup prompts require a bounded server name.',
        path: ['server'],
      });
    }
    if (event.kind !== 'mcp-setup' && event.server !== undefined) {
      context.addIssue({
        code: 'custom',
        message: 'Only MCP setup prompts may carry a server name.',
        path: ['server'],
      });
    }
  });

/** A live generated title for the durable conversation behind this turn. */
export const WaveSessionTitleUpdatedEventSchema = z
  .object({
    ...WaveTurnEventBaseShape,
    storedSessionId: WaveIdentifierSchema,
    title: z.string().trim().min(1).max(300),
    type: z.literal('session.title.updated'),
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

/** A reviewed, Wave-owned projection of an ephemeral Hermes lifecycle event. */
export const WaveActivityStatusEventSchema = z
  .object({
    ...WaveTurnEventBaseShape,
    status: z.enum([
      'compacting',
      'goal-complete',
      'goal-continuing',
      'goal-paused',
      'process-updated',
      'ready',
    ]),
    type: z.literal('activity.status'),
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
  WaveAssistantInterimEventSchema,
  WaveReasoningDeltaEventSchema,
  WaveToolStatusEventSchema,
  WavePromptRequestEventSchema,
  WavePromptResolvedEventSchema,
  WaveSessionTitleUpdatedEventSchema,
  WaveActivityStatusEventSchema,
  WaveAssistantCompletedEventSchema,
  WaveTurnCompletedEventSchema,
  WaveTurnErrorEventSchema,
]);

export type WaveTurnEvent = z.infer<typeof WaveTurnEventSchema>;
