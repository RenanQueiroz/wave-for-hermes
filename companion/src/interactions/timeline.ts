import { createHash } from 'node:crypto';

import {
  WaveTimelineEntrySchema,
  type WaveTimelineEntry,
} from '@wave/contracts';

import { normalizeHermesMessages } from '../hermes/wave-normalizers.ts';
import type { HermesConversationMessage } from '../hermes/hermes-types.ts';
import type { InteractionTurnRecord } from './interaction-store.ts';

interface OrderedTimelineEntry {
  entry: WaveTimelineEntry;
  order: number;
  timestamp?: string;
}

const HERMES_CORRELATION_MAX_DELTA_SECONDS = 5;

export function createUnifiedTimeline(input: {
  hermesMessages: HermesConversationMessage[];
  interactionTurns: InteractionTurnRecord[];
  sessionId: string;
}) {
  const suppressedHermesIndexes = findSuppressedHermesIndexes(
    input.hermesMessages,
    input.interactionTurns,
  );
  const normalizedHermesMessages = normalizeHermesMessages(
    input.hermesMessages,
  );
  const ordered: OrderedTimelineEntry[] = [];
  let order = 0;
  let hermesTurnId: string | undefined;

  normalizedHermesMessages.forEach((message, index) => {
    if (suppressedHermesIndexes.has(index)) {
      return;
    }
    const upstreamMessage = input.hermesMessages[index];
    if (!hermesTurnId || message.role === 'user' || message.role === 'system') {
      hermesTurnId = createWaveTimelineId(
        input.sessionId,
        'hermes_turn',
        upstreamMessage?.id ?? String(index),
      );
    }
    const { id: _internalMessageId, ...normalizedMessage } = message;
    const entry = WaveTimelineEntrySchema.parse({
      id: createWaveTimelineId(
        input.sessionId,
        'hermes_message',
        upstreamMessage?.id ?? String(index),
      ),
      message: normalizedMessage,
      source: 'hermes',
      turnId: hermesTurnId,
      type: 'message',
    });
    ordered.push({
      entry,
      order,
      timestamp: message.createdAt,
    });
    order += 1;
  });

  for (const turn of input.interactionTurns) {
    if (turn.userTranscript) {
      const entry = WaveTimelineEntrySchema.parse({
        id: createWaveTimelineId(turn.id, 'wave_user', turn.id),
        message: {
          content: turn.userTranscript,
          createdAt: turn.createdAt,
          role: 'user',
        },
        source: 'wave',
        turnId: turn.id,
        type: 'message',
      });
      ordered.push({
        entry,
        order,
        timestamp: turn.createdAt,
      });
      order += 1;
    }
    for (const storedEntry of turn.entries) {
      if (storedEntry.type === 'wave_message') {
        const entry = WaveTimelineEntrySchema.parse({
          id: storedEntry.id,
          message: {
            content: storedEntry.content,
            createdAt: storedEntry.createdAt,
            role: 'assistant',
          },
          source: 'wave',
          turnId: turn.id,
          type: 'message',
        });
        ordered.push({
          entry,
          order,
          timestamp: storedEntry.createdAt,
        });
      } else {
        const entry = WaveTimelineEntrySchema.parse({
          ...(storedEntry.completedAt
            ? { completedAt: storedEntry.completedAt }
            : {}),
          createdAt: storedEntry.createdAt,
          id: storedEntry.id,
          instruction: storedEntry.instruction,
          ...(storedEntry.result ? { result: storedEntry.result } : {}),
          status: storedEntry.status,
          turnId: turn.id,
          type: 'handoff',
        });
        ordered.push({
          entry,
          order,
          timestamp: storedEntry.createdAt,
        });
      }
      order += 1;
    }
  }

  ordered.sort((left, right) => {
    if (left.timestamp && right.timestamp) {
      const compared = left.timestamp.localeCompare(right.timestamp);
      if (compared !== 0) {
        return compared;
      }
    } else if (left.timestamp) {
      return 1;
    } else if (right.timestamp) {
      return -1;
    }
    return left.order - right.order;
  });
  return ordered.map(({ entry }) => entry);
}

function createWaveTimelineId(
  sessionId: string,
  kind: string,
  sourceIdentifier: string,
) {
  const digest = createHash('sha256')
    .update(sessionId, 'utf8')
    .update('\0')
    .update(kind, 'utf8')
    .update('\0')
    .update(sourceIdentifier, 'utf8')
    .digest('hex');
  return `timeline-${kind}-${digest}`;
}

function findSuppressedHermesIndexes(
  messages: HermesConversationMessage[],
  turns: InteractionTurnRecord[],
) {
  const indexes = new Set<number>();
  const terminalMessages = turns.flatMap((turn) =>
    turn.entries.flatMap((entry) =>
      entry.type === 'handoff' &&
      (entry.hermesAssistantMessageId ||
        entry.hermesAssistantMessageTimestamp !== undefined)
        ? [
            {
              id: entry.hermesAssistantMessageId,
              timestamp: entry.hermesAssistantMessageTimestamp,
            },
          ]
        : [],
    ),
  );
  for (const terminalMessage of terminalMessages) {
    const terminalIndex = findTerminalHermesIndex(
      messages,
      terminalMessage.id,
      terminalMessage.timestamp,
    );
    if (terminalIndex < 0) {
      continue;
    }
    let startIndex = terminalIndex;
    let foundUserBoundary = false;
    for (let index = terminalIndex; index >= 0; index -= 1) {
      if (messages[index]?.role === 'user') {
        startIndex = index;
        foundUserBoundary = true;
        break;
      }
    }
    if (!foundUserBoundary) {
      indexes.add(terminalIndex);
      continue;
    }
    for (let index = startIndex; index <= terminalIndex; index += 1) {
      indexes.add(index);
    }
  }
  return indexes;
}

function findTerminalHermesIndex(
  messages: HermesConversationMessage[],
  messageId: string | undefined,
  timestamp: number | undefined,
) {
  if (messageId) {
    const index = messages.findIndex((message) => message.id === messageId);
    if (index >= 0) {
      return index;
    }
  }
  if (timestamp === undefined) {
    return -1;
  }
  let closestIndex = -1;
  let closestDelta = Number.POSITIVE_INFINITY;
  messages.forEach((message, index) => {
    if (message.role !== 'assistant' || message.timestamp === undefined) {
      return;
    }
    const delta = Math.abs(message.timestamp - timestamp);
    if (
      delta <= HERMES_CORRELATION_MAX_DELTA_SECONDS &&
      (delta < closestDelta || (delta === closestDelta && index > closestIndex))
    ) {
      closestDelta = delta;
      closestIndex = index;
    }
  });
  return closestIndex;
}
