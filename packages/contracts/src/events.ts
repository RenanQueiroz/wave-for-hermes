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

/** Bounds on one `todo.updated` snapshot. Hermes sends the whole list. */
export const WAVE_TODO_MAX_ITEMS = 64;
export const WAVE_TODO_CONTENT_MAX_CHARS = 300;
export const WAVE_PROMPT_MAX_CHOICES = 8;
export const WAVE_PROMPT_MAX_QUESTIONS = 16;

const WavePromptChoicesSchema = z
  .array(z.string().trim().min(1).max(100))
  .max(WAVE_PROMPT_MAX_CHOICES);

/**
 * One question of a batched (multi-question) clarify prompt. Hermes v0.20.5
 * asks several independent questions in one `clarify.request` and keys each
 * answer by the server-generated question id.
 */
export const WavePromptQuestionSchema = z
  .object({
    /** A previously accepted answer replayed on reconnect, if any. */
    answer: z.string().max(2_000).optional(),
    choices: WavePromptChoicesSchema,
    /** Several choices may be selected at once; only meaningful with choices. */
    multiSelect: z.boolean(),
    question: z.string().trim().min(1).max(2_000),
    /** Server-generated wire id; opaque to screens. */
    questionId: z.string().trim().min(1).max(128),
  })
  .strict()
  .refine((question) => !question.multiSelect || question.choices.length > 0, {
    message: 'Multi-select questions require choices.',
    path: ['multiSelect'],
  });

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
    choices: WavePromptChoicesSchema,
    /** The command awaiting approval, as a bounded inert detail. */
    command: WaveToolDetailSchema.optional(),
    /** Short human description (approval pattern, e.g. "delete in root path"). */
    description: z.string().trim().min(1).max(300).optional(),
    kind: z.enum(['approval', 'clarify', 'mcp-setup', 'secret', 'sudo']),
    messageId: WaveIdentifierSchema.optional(),
    /** Several `choices` may be selected at once (single-question clarify). */
    multiSelect: z.boolean().optional(),
    /** Bounded MCP catalog/config name needed only to decline setup safely. */
    server: z.string().trim().min(1).max(200).optional(),
    /** Correlates the response; opaque to screens. */
    promptId: z.string().trim().min(1).max(128),
    /** The question being asked (single-question clarify). */
    question: z.string().trim().min(1).max(2_000).optional(),
    /**
     * Batched clarify: every question is answered together and each answer is
     * keyed by its `questionId`. Replaces `question`/`choices` when present.
     */
    questions: z
      .array(WavePromptQuestionSchema)
      .min(1)
      .max(WAVE_PROMPT_MAX_QUESTIONS)
      .optional(),
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
    if (event.kind !== 'clarify' && event.questions !== undefined) {
      context.addIssue({
        code: 'custom',
        message: 'Only clarify prompts may carry a question batch.',
        path: ['questions'],
      });
    }
    if (event.kind !== 'clarify' && event.multiSelect !== undefined) {
      context.addIssue({
        code: 'custom',
        message: 'Only clarify prompts may be multi-select.',
        path: ['multiSelect'],
      });
    }
    if (event.multiSelect && event.choices.length === 0) {
      context.addIssue({
        code: 'custom',
        message: 'Multi-select prompts require choices.',
        path: ['multiSelect'],
      });
    }
    if (event.questions !== undefined) {
      if (event.question !== undefined || event.choices.length > 0) {
        context.addIssue({
          code: 'custom',
          message: 'A question batch replaces the single question and choices.',
          path: ['questions'],
        });
      }
      const ids = new Set(event.questions.map((entry) => entry.questionId));
      if (ids.size !== event.questions.length) {
        context.addIssue({
          code: 'custom',
          message: 'Question ids must be unique within a batch.',
          path: ['questions'],
        });
      }
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
      'loop-running',
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

/**
 * Which part of the stack failed, as Hermes v0.21 reports it on a terminal
 * error frame (`agent/error_surface.py`). Wave owns this list rather than
 * echoing whatever string arrives: an unrecognised layer is dropped at
 * normalization and the turn falls back to generic copy. Advisory only — it
 * selects wording, never behaviour, and never triggers a retry.
 */
export const WaveErrorLayerSchema = z.enum([
  'auth',
  'billing',
  'disk',
  'endpoint',
  'gateway',
  'provider',
  'runtime',
  'streaming',
]);

export const WaveErrorSurfaceSchema = z
  .object({
    /** Gateway-authored, bounded, inert. Shown only as a diagnostic detail. */
    code: z.string().trim().min(1).max(120).optional(),
    layer: WaveErrorLayerSchema,
    retryable: z.boolean().optional(),
  })
  .strict();

export const WaveTurnErrorEventSchema = z
  .object({
    ...WaveTurnEventBaseShape,
    error: WaveErrorSchema,
    surface: WaveErrorSurfaceSchema.optional(),
    type: z.literal('turn.error'),
  })
  .strict();

/**
 * One entry from Hermes's task list (`tools/todo_tool.py`). Content is
 * gateway-authored untrusted text: bounded and inert, rendered as plain text,
 * never markdown and never behaviour-driving.
 */
export const WaveTodoStatusSchema = z.enum([
  'cancelled',
  'completed',
  'in_progress',
  'pending',
]);

export const WaveTodoSchema = z
  .object({
    content: z.string().trim().min(1).max(WAVE_TODO_CONTENT_MAX_CHARS),
    id: z.string().trim().min(1).max(64),
    status: WaveTodoStatusSchema,
  })
  .strict();

/**
 * A full task-list snapshot (`todo.updated`). Hermes emits the whole list on
 * every change and stamps a monotonic `revision`, so a client reconciles by
 * replacing wholesale and rejecting anything older than what it holds — there
 * is no merge and no partial update to get wrong.
 */
export const WaveTodoSnapshotEventSchema = z
  .object({
    ...WaveTurnEventBaseShape,
    revision: z.number().int().nonnegative(),
    todos: z.array(WaveTodoSchema).max(WAVE_TODO_MAX_ITEMS),
    type: z.literal('todo.snapshot'),
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
  WaveTodoSnapshotEventSchema,
]);

export type WaveTurnEvent = z.infer<typeof WaveTurnEventSchema>;
export type WavePromptQuestion = z.infer<typeof WavePromptQuestionSchema>;
export type WaveErrorLayer = z.infer<typeof WaveErrorLayerSchema>;
export type WaveTodo = z.infer<typeof WaveTodoSchema>;
export type WaveTodoStatus = z.infer<typeof WaveTodoStatusSchema>;
export type WaveErrorSurface = z.infer<typeof WaveErrorSurfaceSchema>;
