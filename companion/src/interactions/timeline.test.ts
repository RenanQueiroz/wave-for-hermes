import assert from 'node:assert/strict';
import test from 'node:test';

import type { InteractionTurnRecord } from './interaction-store.ts';
import { createUnifiedTimeline } from './timeline.ts';

test('merges Wave speech with canonical Hermes history without duplicating a handoff', () => {
  const interactionTurns: InteractionTurnRecord[] = [
    {
      createdAt: '2026-07-30T02:00:03.000Z',
      entries: [
        {
          content: "I'll take care of that.",
          createdAt: '2026-07-30T02:00:03.100Z',
          id: 'wave-message-1',
          type: 'wave_message',
        },
        {
          completedAt: '2026-07-30T02:00:05.000Z',
          createdAt: '2026-07-30T02:00:03.200Z',
          hermesAssistantMessageId: 'hermes-private-terminal-id',
          id: 'wave-handoff-1',
          instruction: 'Turn off the bedroom lights.',
          result: {
            answer: 'The bedroom lights are off.',
            ok: true,
            truncated: false,
          },
          status: 'completed',
          type: 'handoff',
        },
        {
          content: 'The bedroom lights are off.',
          createdAt: '2026-07-30T02:00:05.100Z',
          id: 'wave-message-2',
          type: 'wave_message',
        },
      ],
      id: 'wave-turn-1',
      sessionId: 'session-1',
      userTranscript: 'Turn off the bedroom lights',
    },
  ];

  const entries = createUnifiedTimeline({
    hermesMessages: [
      {
        content: 'What is seven times eight?',
        id: 'hermes-private-user-id',
        role: 'user',
        sessionId: 'session-1',
        timestamp: 1_785_370_001,
      },
      {
        content: 'Fifty-six.',
        id: 'hermes-private-answer-id',
        role: 'assistant',
        sessionId: 'session-1',
        timestamp: 1_785_370_002,
      },
      {
        content: 'Turn off the bedroom lights.',
        id: 'hermes-private-handoff-user-id',
        role: 'user',
        sessionId: 'session-1',
        timestamp: 1_785_370_004,
      },
      {
        content: 'The bedroom lights are off.',
        id: 'hermes-private-terminal-id',
        role: 'assistant',
        sessionId: 'session-1',
        timestamp: 1_785_370_005,
      },
    ],
    interactionTurns,
    sessionId: 'session-1',
  });

  assert.deepEqual(
    entries.map((entry) =>
      entry.type === 'message'
        ? `${entry.source}:${entry.message.role}:${entry.message.content}`
        : `handoff:${entry.status}:${entry.instruction}`,
    ),
    [
      'hermes:user:What is seven times eight?',
      'hermes:assistant:Fifty-six.',
      'wave:user:Turn off the bedroom lights',
      "wave:assistant:I'll take care of that.",
      'handoff:completed:Turn off the bedroom lights.',
      'wave:assistant:The bedroom lights are off.',
    ],
  );
  assert.equal(
    JSON.stringify(entries).includes('hermes-private-terminal-id'),
    false,
  );
  assert.equal(
    entries.every(
      (entry) =>
        entry.id.startsWith('timeline-') || entry.id.startsWith('wave-'),
    ),
    true,
  );
});

test('keeps a handoff visible when canonical Hermes history was cleared externally', () => {
  const entries = createUnifiedTimeline({
    hermesMessages: [],
    interactionTurns: [
      {
        createdAt: '2026-07-30T02:00:03.000Z',
        entries: [
          {
            completedAt: '2026-07-30T02:00:05.000Z',
            createdAt: '2026-07-30T02:00:03.100Z',
            hermesAssistantMessageId: 'no-longer-present',
            id: 'wave-handoff-1',
            instruction: 'Do the work.',
            result: {
              answer: 'Done.',
              ok: true,
              truncated: false,
            },
            status: 'completed',
            type: 'handoff',
          },
        ],
        id: 'wave-turn-1',
        sessionId: 'session-1',
        userTranscript: 'Do the work',
      },
    ],
    sessionId: 'session-1',
  });

  assert.equal(entries.length, 2);
  assert.equal(entries[1]?.type, 'handoff');
});

test('suppresses only the correlated terminal message without a preceding Hermes user item', () => {
  const entries = createUnifiedTimeline({
    hermesMessages: [
      {
        content: 'Earlier unrelated assistant context.',
        id: 'hermes-earlier-assistant',
        role: 'assistant',
        sessionId: 'session-1',
        timestamp: 1_785_370_001,
      },
      {
        content: 'Delegated result.',
        id: 'hermes-terminal',
        role: 'assistant',
        sessionId: 'session-1',
        timestamp: 1_785_370_002,
      },
    ],
    interactionTurns: [
      {
        createdAt: '2026-07-30T02:00:03.000Z',
        entries: [
          {
            completedAt: '2026-07-30T02:00:05.000Z',
            createdAt: '2026-07-30T02:00:03.100Z',
            hermesAssistantMessageId: 'hermes-terminal',
            id: 'wave-handoff-1',
            instruction: 'Do the work.',
            result: {
              answer: 'Delegated result.',
              ok: true,
              truncated: false,
            },
            status: 'completed',
            type: 'handoff',
          },
        ],
        id: 'wave-turn-1',
        sessionId: 'session-1',
        userTranscript: 'Do the work',
      },
    ],
    sessionId: 'session-1',
  });

  assert.equal(
    entries.some(
      (entry) =>
        entry.type === 'message' &&
        entry.message.content === 'Earlier unrelated assistant context.',
    ),
    true,
  );
  assert.equal(
    entries.some(
      (entry) =>
        entry.type === 'message' &&
        entry.message.content === 'Delegated result.',
    ),
    false,
  );
});

test('correlates Hermes history without message IDs using the terminal timestamp', () => {
  const entries = createUnifiedTimeline({
    hermesMessages: [
      {
        content: 'Run the delegated task.',
        role: 'user',
        sessionId: 'session-1',
        timestamp: 1_785_370_004,
      },
      {
        content: 'Delegated result.',
        role: 'assistant',
        sessionId: 'session-1',
        timestamp: 1_785_370_005.007,
      },
    ],
    interactionTurns: [
      {
        createdAt: '2026-07-30T02:00:03.000Z',
        entries: [
          {
            completedAt: '2026-07-30T02:00:05.100Z',
            createdAt: '2026-07-30T02:00:03.100Z',
            hermesAssistantMessageId: 'stream-only-message-id',
            hermesAssistantMessageTimestamp: 1_785_370_005,
            id: 'wave-handoff-1',
            instruction: 'Run the delegated task.',
            result: {
              answer: 'Delegated result.',
              ok: true,
              truncated: false,
            },
            status: 'completed',
            type: 'handoff',
          },
        ],
        id: 'wave-turn-1',
        sessionId: 'session-1',
        userTranscript: 'Run the delegated task',
      },
    ],
    sessionId: 'session-1',
  });

  assert.deepEqual(
    entries.map((entry) => entry.type),
    ['message', 'handoff'],
  );
  assert.equal(
    entries.some(
      (entry) => entry.type === 'message' && entry.source === 'hermes',
    ),
    false,
  );
});

test('does not suppress unrelated Hermes history outside the correlation window', () => {
  const entries = createUnifiedTimeline({
    hermesMessages: [
      {
        content: 'Keep this earlier answer.',
        role: 'assistant',
        sessionId: 'session-1',
        timestamp: 1_785_370_000,
      },
    ],
    interactionTurns: [
      {
        createdAt: '2026-07-30T02:00:03.000Z',
        entries: [
          {
            completedAt: '2026-07-30T02:00:15.000Z',
            createdAt: '2026-07-30T02:00:03.100Z',
            hermesAssistantMessageTimestamp: 1_785_370_015,
            id: 'wave-handoff-1',
            instruction: 'Run a later task.',
            result: {
              answer: 'Done.',
              ok: true,
              truncated: false,
            },
            status: 'completed',
            type: 'handoff',
          },
        ],
        id: 'wave-turn-1',
        sessionId: 'session-1',
      },
    ],
    sessionId: 'session-1',
  });

  assert.equal(
    entries.some(
      (entry) =>
        entry.type === 'message' &&
        entry.message.content === 'Keep this earlier answer.',
    ),
    true,
  );
});
