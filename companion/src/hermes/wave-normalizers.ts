import { createHash, randomUUID } from 'node:crypto';

import {
  WAVE_TOOL_DETAIL_MAX_CHARS,
  WAVE_API_VERSION,
  WaveConversationMessageSchema,
  WaveScheduledJobSchema,
  WaveSessionSummarySchema,
  WaveTurnEventSchema,
  type WaveConversationMessage,
  type WaveSessionSummary,
  type WaveToolDetail,
  type WaveTurnEvent,
} from '@wave/contracts';

import type {
  HermesConversationMessage,
  HermesScheduledJob,
  HermesSessionSummary,
  HermesStreamEvent,
} from './hermes-types.ts';

const WAVE_TOOL_DETAIL_AGGREGATE_MAX_CHARS = 512_000;

export function normalizeHermesMessage(
  message: HermesConversationMessage,
  details: {
    hideToolContent?: boolean;
    toolInput?: WaveToolDetail;
    toolOutput?: WaveToolDetail;
    toolName?: string;
  } = {},
): WaveConversationMessage {
  const toolName = details.toolName ?? message.toolName;
  return WaveConversationMessageSchema.parse({
    content: details.hideToolContent ? '' : message.content,
    ...(message.timestamp === undefined
      ? {}
      : { createdAt: timestampToIso(message.timestamp) }),
    ...(message.id ? { id: normalizeIdentifier(message.id, 'message') } : {}),
    role: message.role,
    ...(details.toolInput ? { toolInput: details.toolInput } : {}),
    ...(toolName
      ? {
          toolName: normalizeToolName(toolName),
        }
      : {}),
    ...(details.toolOutput ? { toolOutput: details.toolOutput } : {}),
  });
}

export function normalizeHermesMessages(
  messages: HermesConversationMessage[],
): WaveConversationMessage[] {
  const toolCalls = new Map<string, { arguments?: string; name?: string }>();
  for (const message of messages) {
    for (const toolCall of message.toolCalls ?? []) {
      toolCalls.set(toolCall.id, toolCall);
    }
  }

  const budget = { remaining: WAVE_TOOL_DETAIL_AGGREGATE_MAX_CHARS };
  return messages.map((message) => {
    if (message.role !== 'tool') {
      return normalizeHermesMessage(message);
    }
    const toolCall = message.toolCallId
      ? toolCalls.get(message.toolCallId)
      : undefined;
    return normalizeHermesMessage(message, {
      hideToolContent: true,
      ...(toolCall?.arguments === undefined
        ? {}
        : { toolInput: normalizeToolDetail(toolCall.arguments, budget) }),
      toolName: message.toolName ?? toolCall?.name,
      toolOutput: normalizeToolDetail(message.content, budget),
    });
  });
}

export function normalizeHermesSession(
  session: HermesSessionSummary,
): WaveSessionSummary {
  return WaveSessionSummarySchema.parse({
    id: normalizeIdentifier(session.id, 'session'),
    ...(session.lastActive === undefined
      ? {}
      : { lastActiveAt: timestampToIso(session.lastActive) }),
    ...(session.messageCount === undefined
      ? {}
      : { messageCount: Math.max(0, Math.trunc(session.messageCount)) }),
    ...(session.preview ? { preview: session.preview } : {}),
    ...(session.startedAt === undefined
      ? {}
      : { startedAt: timestampToIso(session.startedAt) }),
    ...(session.title ? { title: session.title } : {}),
    ...(session.toolCallCount === undefined
      ? {}
      : { toolCallCount: Math.max(0, Math.trunc(session.toolCallCount)) }),
  });
}

export function normalizeHermesScheduledJob(job: HermesScheduledJob) {
  return WaveScheduledJobSchema.parse({
    ...(job.createdAt ? { createdAt: normalizeIsoDate(job.createdAt) } : {}),
    enabled: job.enabled,
    id: normalizeIdentifier(job.id, 'job'),
    ...(job.lastRunAt ? { lastRunAt: normalizeIsoDate(job.lastRunAt) } : {}),
    ...(job.lastStatus ? { lastStatus: job.lastStatus.slice(0, 100) } : {}),
    name: job.name.slice(0, 200),
    ...(job.nextRunAt ? { nextRunAt: normalizeIsoDate(job.nextRunAt) } : {}),
    schedule: job.schedule.slice(0, 300),
    state: job.state.slice(0, 100),
  });
}

export class WaveTurnEventFactory {
  private readonly now: () => Date;
  private sequence = 0;
  private readonly sessionId: string;
  private readonly toolDetailBudget = {
    remaining: WAVE_TOOL_DETAIL_AGGREGATE_MAX_CHARS,
  };
  private readonly turnId: string;

  constructor(
    sessionId: string,
    turnId: string,
    now: () => Date = () => new Date(),
  ) {
    this.sessionId = sessionId;
    this.turnId = turnId;
    this.now = now;
  }

  createStarted(): WaveTurnEvent {
    return this.create({
      type: 'turn.started',
    });
  }

  fromHermes(event: HermesStreamEvent): WaveTurnEvent | undefined {
    switch (event.type) {
      case 'assistant.completed':
        return this.create({
          content: event.content,
          interrupted: event.interrupted,
          messageId: normalizeIdentifier(event.messageId, 'message'),
          partial: event.partial,
          type: 'assistant.completed',
        });
      case 'assistant.delta':
        return this.create({
          delta: event.delta,
          messageId: normalizeIdentifier(event.messageId, 'message'),
          type: 'assistant.delta',
        });
      case 'done':
      case 'run.started':
        return undefined;
      case 'error':
        return this.createError(
          'upstream_unavailable',
          'Hermes could not complete the turn.',
          true,
        );
      case 'message.started':
        return this.create({
          messageId: normalizeIdentifier(event.messageId, 'message'),
          type: 'assistant.started',
        });
      case 'run.completed':
        return this.create({
          completed: event.completed,
          type: 'turn.completed',
        });
      case 'tool':
        return this.create({
          ...(event.messageId
            ? {
                messageId: normalizeIdentifier(event.messageId, 'message'),
              }
            : {}),
          status: event.status,
          ...(event.toolInput === undefined
            ? {}
            : {
                toolInput: normalizeToolDetail(
                  event.toolInput,
                  this.toolDetailBudget,
                ),
              }),
          ...(event.toolName
            ? { toolName: normalizeToolName(event.toolName) }
            : {}),
          ...(event.toolOutput === undefined
            ? {}
            : {
                toolOutput: normalizeToolDetail(
                  event.toolOutput,
                  this.toolDetailBudget,
                ),
              }),
          ...(event.toolOutputIsPreview === undefined
            ? {}
            : { toolOutputIsPreview: event.toolOutputIsPreview }),
          type: 'tool.status',
        });
    }
  }

  createError(
    code:
      | 'cancelled'
      | 'timeout'
      | 'upstream_incompatible'
      | 'upstream_unavailable',
    message: string,
    retryable: boolean,
  ): WaveTurnEvent {
    return this.create({
      error: {
        code,
        message,
        retryable,
      },
      type: 'turn.error',
    });
  }

  private create(
    event:
      | { type: 'turn.started' }
      | {
          messageId: string;
          type: 'assistant.started';
        }
      | {
          delta: string;
          messageId: string;
          type: 'assistant.delta';
        }
      | {
          messageId?: string;
          status: 'completed' | 'failed' | 'progress' | 'started';
          toolInput?: WaveToolDetail;
          toolName?: string;
          toolOutput?: WaveToolDetail;
          toolOutputIsPreview?: boolean;
          type: 'tool.status';
        }
      | {
          content: string;
          interrupted: boolean;
          messageId: string;
          partial: boolean;
          type: 'assistant.completed';
        }
      | {
          completed: boolean;
          type: 'turn.completed';
        }
      | {
          error: {
            code:
              | 'cancelled'
              | 'timeout'
              | 'upstream_incompatible'
              | 'upstream_unavailable';
            message: string;
            retryable: boolean;
          };
          type: 'turn.error';
        },
  ): WaveTurnEvent {
    return WaveTurnEventSchema.parse({
      apiVersion: WAVE_API_VERSION,
      eventId: randomUUID(),
      sequence: this.sequence++,
      sessionId: this.sessionId,
      timestamp: this.now().toISOString(),
      turnId: this.turnId,
      ...event,
    });
  }
}

export function formatWaveSseEvent(event: WaveTurnEvent) {
  const validated = WaveTurnEventSchema.parse(event);
  return `id: ${validated.eventId}\nevent: ${validated.type}\ndata: ${JSON.stringify(validated)}\n\n`;
}

function normalizeIdentifier(value: string, namespace: string) {
  if (
    value.length > 0 &&
    value.length <= 256 &&
    !/[\u0000-\u001f\u007f/?#\\]/.test(value)
  ) {
    return value;
  }
  const digest = createHash('sha256').update(value).digest('hex');
  return `${namespace}-${digest}`;
}

function normalizeToolName(value: string) {
  const normalized = value
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 100);
  return normalized || 'Hermes tool';
}

function normalizeToolDetail(
  value: string,
  budget: { remaining: number },
): WaveToolDetail {
  const available = Math.max(
    0,
    Math.min(WAVE_TOOL_DETAIL_MAX_CHARS, budget.remaining),
  );
  const text = value.slice(0, available);
  budget.remaining -= text.length;
  return {
    text,
    truncated: text.length < value.length,
  };
}

function timestampToIso(value: number) {
  const milliseconds =
    Math.abs(value) < 1_000_000_000_000 ? value * 1_000 : value;
  const date = new Date(milliseconds);
  if (!Number.isFinite(date.getTime())) {
    throw new Error('Hermes returned an invalid timestamp.');
  }
  return date.toISOString();
}

function normalizeIsoDate(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new Error('Hermes returned an invalid date.');
  }
  return date.toISOString();
}
