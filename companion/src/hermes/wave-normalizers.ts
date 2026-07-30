import { createHash, randomUUID } from 'node:crypto';

import {
  WAVE_API_VERSION,
  WaveConversationMessageSchema,
  WaveSessionSummarySchema,
  WaveTurnEventSchema,
  type WaveConversationMessage,
  type WaveSessionSummary,
  type WaveTurnEvent,
} from '@wave/contracts';

import type {
  HermesConversationMessage,
  HermesSessionSummary,
  HermesStreamEvent,
} from './hermes-types.ts';

export function normalizeHermesMessage(
  message: HermesConversationMessage,
): WaveConversationMessage {
  return WaveConversationMessageSchema.parse({
    content: message.content,
    ...(message.timestamp === undefined
      ? {}
      : { createdAt: timestampToIso(message.timestamp) }),
    ...(message.id ? { id: normalizeIdentifier(message.id, 'message') } : {}),
    role: message.role,
    ...(message.toolName
      ? { toolName: normalizeToolName(message.toolName) }
      : {}),
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

export class WaveTurnEventFactory {
  private readonly now: () => Date;
  private sequence = 0;
  private readonly sessionId: string;
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
                messageId: normalizeIdentifier(
                  event.messageId,
                  'message',
                ),
              }
            : {}),
          status: event.status,
          ...(event.toolName
            ? { toolName: normalizeToolName(event.toolName) }
            : {}),
          type: 'tool.status',
        });
    }
  }

  createError(
    code: 'cancelled' | 'timeout' | 'upstream_incompatible' | 'upstream_unavailable',
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
          toolName?: string;
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

function timestampToIso(value: number) {
  const milliseconds = Math.abs(value) < 1_000_000_000_000 ? value * 1_000 : value;
  const date = new Date(milliseconds);
  if (!Number.isFinite(date.getTime())) {
    throw new Error('Hermes returned an invalid timestamp.');
  }
  return date.toISOString();
}
