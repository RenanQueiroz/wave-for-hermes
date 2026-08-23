import assert from 'node:assert/strict';
import test from 'node:test';

import {
  initialWaveChatState,
  isWaveChatActivityStale,
  timelineToWaveChatMessages,
  waveChatActivityLabel,
  waveChatReducer,
  WAVE_CHAT_ACTIVITY_STALE_MS,
} from '../../src/features/chat/chat-state.ts';
import type {
  WaveConversationMessage,
  WaveTimelineEntry,
} from '@wave/contracts';

test('reduces batched assistant text and bounded tool lifecycle details in order', () => {
  let state = waveChatReducer(initialWaveChatState, {
    assistantId: 'assistant-local',
    input: 'Do the work',
    type: 'send',
    userId: 'user-local',
  });
  state = waveChatReducer(state, {
    event: event({ type: 'turn.started' }),
    type: 'event',
  });
  state = waveChatReducer(state, {
    delta: 'Working',
    timestamp: '2026-07-30T02:00:00.000Z',
    type: 'assistant.delta',
  });
  state = waveChatReducer(state, {
    event: event({
      messageId: 'message-1',
      sequence: 1,
      status: 'started',
      toolInput: {
        text: '{"query":"Wave"}',
        truncated: false,
      },
      toolName: 'search',
      type: 'tool.status',
    }),
    type: 'event',
  });
  state = waveChatReducer(state, {
    event: event({
      messageId: 'message-1',
      sequence: 2,
      status: 'progress',
      toolName: 'search',
      toolOutput: {
        text: '{"matches":2}',
        truncated: false,
      },
      toolOutputIsPreview: true,
      type: 'tool.status',
    }),
    type: 'event',
  });
  state = waveChatReducer(state, {
    event: event({
      messageId: 'message-1',
      sequence: 3,
      status: 'completed',
      toolName: 'search',
      toolOutput: {
        text: '{"matches":3}',
        truncated: false,
      },
      type: 'tool.status',
    }),
    type: 'event',
  });

  assert.deepEqual(state.messages[1]?.parts, [
    { text: 'Working', type: 'text' },
    {
      id: 'message-1:search:1',
      input: {
        text: '{"query":"Wave"}',
        truncated: false,
      },
      output: {
        text: '{"matches":3}',
        truncated: false,
      },
      status: 'complete',
      title: 'search',
      type: 'task',
    },
  ]);
});

test('resume seeds only an assistant placeholder and streams replayed events', () => {
  let state = waveChatReducer(initialWaveChatState, {
    assistantId: 'assistant-resumed',
    lastActivityAt: '2026-07-30T01:59:00.000Z',
    liveStatus: 'waiting',
    turnId: 'turn-1',
    type: 'resume',
  });
  assert.equal(state.status, 'submitting');
  assert.equal(state.activeTurnId, 'turn-1');
  assert.equal(state.liveStatus, 'waiting');
  assert.equal(state.lastActivityAt, '2026-07-30T01:59:00.000Z');
  assert.deepEqual(state.messages, [
    { id: 'assistant-resumed', parts: [], role: 'assistant' },
  ]);

  state = waveChatReducer(state, {
    event: event({ type: 'turn.started' }),
    type: 'event',
  });
  state = waveChatReducer(state, {
    delta: 'Picked back up',
    timestamp: '2026-07-30T02:00:00.000Z',
    type: 'assistant.delta',
  });
  assert.equal(state.status, 'streaming');
  assert.deepEqual(state.messages[0]?.parts, [
    { text: 'Picked back up', type: 'text' },
  ]);
});

test('timeline exposes only normalized bounded tool input and output details', () => {
  const messages = timelineToWaveChatMessages(
    hermesTimeline([
      {
        content: '',
        id: 'tool-message',
        role: 'tool',
        toolInput: {
          text: '{"date":"tomorrow"}',
          truncated: false,
        },
        toolName: 'calendar',
        toolOutput: {
          text: '{"available":true}',
          truncated: false,
        },
      },
    ]),
  );

  assert.deepEqual(messages, [
    {
      id: 'tool-message',
      parts: [
        {
          id: 'tool-message-tool',
          input: {
            text: '{"date":"tomorrow"}',
            truncated: false,
          },
          output: {
            text: '{"available":true}',
            truncated: false,
          },
          status: 'complete',
          title: 'calendar',
          type: 'task',
        },
      ],
      role: 'assistant',
    },
  ]);
});

test('timeline groups tool records into one assistant turn and removes empty avatars', () => {
  const messages = timelineToWaveChatMessages(
    hermesTimeline([
      {
        content: 'Research voice platforms',
        id: 'user-message',
        role: 'user',
      },
      {
        content: '',
        id: 'empty-assistant-before-tool',
        role: 'assistant',
      },
      {
        content: '',
        id: 'tool-read',
        role: 'tool',
        toolName: 'read_file',
        toolOutput: {
          text: 'file contents',
          truncated: false,
        },
      },
      {
        content: '',
        id: 'empty-assistant-between-tools',
        role: 'assistant',
      },
      {
        content: '',
        id: 'tool-search',
        role: 'tool',
        toolName: 'web_extract',
        toolOutput: {
          text: 'search results',
          truncated: false,
        },
      },
      {
        content: 'Here is the comparison.',
        id: 'assistant-answer',
        role: 'assistant',
      },
    ]),
  );

  assert.deepEqual(messages, [
    {
      id: 'user-message',
      parts: [
        {
          text: 'Research voice platforms',
          type: 'text',
        },
      ],
      role: 'user',
    },
    {
      id: 'tool-read',
      parts: [
        {
          id: 'tool-read-tool',
          output: {
            text: 'file contents',
            truncated: false,
          },
          status: 'complete',
          title: 'read_file',
          type: 'task',
        },
        {
          id: 'tool-search-tool',
          output: {
            text: 'search results',
            truncated: false,
          },
          status: 'complete',
          title: 'web_extract',
          type: 'task',
        },
        {
          text: 'Here is the comparison.',
          type: 'text',
        },
      ],
      role: 'assistant',
    },
  ]);
  assert.equal(JSON.stringify(messages).includes('file contents'), true);
  assert.equal(JSON.stringify(messages).includes('search results'), true);
});

test('grouping survives per-row synthetic turn ids from stored history', () => {
  // normalizeTimelineEntries assigns each stored row its own turn id, so
  // grouping must work from roles alone or history never forms turns.
  const messages = timelineToWaveChatMessages(
    hermesTimeline([
      { content: 'Do the thing', id: 'u1', role: 'user' },
      {
        content: '',
        id: 't1',
        role: 'tool',
        toolName: 'read_file',
        toolOutput: { text: 'a', truncated: false },
      },
      {
        content: '',
        id: 't2',
        role: 'tool',
        toolName: 'web_search',
        toolOutput: { text: 'b', truncated: false },
      },
      { content: 'Done.', id: 'a1', role: 'assistant' },
    ]).map((entry) => ({ ...entry, turnId: entry.id })),
  );
  assert.equal(messages.length, 2);
  assert.equal(messages[1]?.role, 'assistant');
  assert.deepEqual(
    messages[1]?.parts.map((part) => part.type),
    ['task', 'task', 'text'],
  );
});

test('timeline nests a Hermes handoff between Wave acknowledgement and result', () => {
  const messages = timelineToWaveChatMessages([
    {
      id: 'voice-user',
      message: {
        content: 'Turn off the bedroom lights',
        role: 'user',
      },
      source: 'wave',
      turnId: 'voice-turn',
      type: 'message',
    },
    {
      id: 'wave-ack',
      message: {
        content: "I'll take care of that.",
        role: 'assistant',
      },
      source: 'wave',
      turnId: 'voice-turn',
      type: 'message',
    },
    {
      completedAt: '2026-07-30T02:00:02.000Z',
      createdAt: '2026-07-30T02:00:01.000Z',
      id: 'wave-handoff',
      instruction: 'Turn off the lights in the bedroom.',
      result: {
        answer: 'The bedroom lights are off.',
        ok: true,
        truncated: false,
      },
      status: 'completed',
      turnId: 'voice-turn',
      type: 'handoff',
    },
    {
      id: 'wave-result',
      message: {
        content: 'The bedroom lights are off.',
        role: 'assistant',
      },
      source: 'wave',
      turnId: 'voice-turn',
      type: 'message',
    },
  ]);

  assert.equal(messages.length, 2);
  assert.equal(messages[1]?.role, 'assistant');
  assert.deepEqual(
    messages[1]?.parts.map((part) => part.type),
    ['text', 'task', 'text'],
  );
  const handoff = messages[1]?.parts[1];
  assert.equal(
    handoff?.type === 'task' && handoff.title,
    'Hermes · Turn off the lights in the bedroom.',
  );
  assert.equal(
    handoff?.type === 'task' && handoff.output?.text.includes('"ok": true'),
    true,
  );
});

test('keeps a safe turn error after the timeline replaces optimistic messages', () => {
  let state = waveChatReducer(initialWaveChatState, {
    assistantId: 'assistant-local',
    input: 'Do the work',
    type: 'send',
    userId: 'user-local',
  });
  state = waveChatReducer(state, {
    event: {
      apiVersion: 'v1',
      error: {
        code: 'upstream_unavailable',
        message: 'Hermes could not complete the turn.',
        retryable: true,
      },
      eventId: 'event-1',
      sequence: 1,
      sessionId: 'session-1',
      timestamp: '2026-07-30T02:00:00.000Z',
      turnId: 'turn-1',
      type: 'turn.error',
    },
    type: 'event',
  });
  state = waveChatReducer(state, { type: 'timeline.reconciled' });

  assert.deepEqual(state.messages, []);
  assert.deepEqual(state.error, {
    message: 'Hermes could not complete the turn.',
    retryable: true,
  });
  assert.equal(state.status, 'error');
});

test('keeps cancellation busy until cleanup settles, then returns to neutral idle', () => {
  let state = waveChatReducer(initialWaveChatState, {
    assistantId: 'assistant-local',
    input: 'Cancel this',
    type: 'send',
    userId: 'user-local',
  });
  state = waveChatReducer(state, { type: 'cancel.requested' });
  state = waveChatReducer(state, {
    event: {
      apiVersion: 'v1',
      error: {
        code: 'cancelled',
        message: 'The Wave turn was cancelled.',
        retryable: false,
      },
      eventId: 'event-1',
      sequence: 1,
      sessionId: 'session-1',
      timestamp: '2026-07-30T02:00:00.000Z',
      turnId: 'turn-1',
      type: 'turn.error',
    },
    type: 'event',
  });

  assert.equal(state.status, 'cancelling');
  assert.equal(state.error, undefined);

  state = waveChatReducer(state, { type: 'settled' });

  assert.equal(state.status, 'idle');
  assert.equal(state.error, undefined);
});

test('places, queues, and rejects optimistic turn corrections deterministically', () => {
  const start = () =>
    waveChatReducer(initialWaveChatState, {
      assistantId: 'assistant-local',
      input: 'Original request',
      type: 'send',
      userId: 'user-local',
    });
  const request = (state: ReturnType<typeof start>) =>
    waveChatReducer(state, {
      messageId: 'correction-local',
      text: 'Use SQLite instead',
      type: 'correction.requested',
    });

  const requested = request(start());
  assert.deepEqual(
    requested.messages.map((message) => [message.id, message.role]),
    [
      ['user-local', 'user'],
      ['correction-local', 'user'],
      ['assistant-local', 'assistant'],
    ],
  );
  assert.deepEqual(requested.correction, {
    messageId: 'correction-local',
    text: 'Use SQLite instead',
  });

  const redirected = waveChatReducer(requested, {
    messageId: 'correction-local',
    status: 'redirected',
    type: 'correction.resolved',
  });
  assert.equal(redirected.correction, undefined);
  assert.deepEqual(
    redirected.messages.map((message) => message.id),
    ['user-local', 'correction-local', 'assistant-local'],
  );

  const queued = waveChatReducer(request(start()), {
    messageId: 'correction-local',
    status: 'queued',
    type: 'correction.resolved',
  });
  assert.deepEqual(
    queued.messages.map((message) => message.id),
    ['user-local', 'assistant-local', 'correction-local'],
  );

  const rejected = waveChatReducer(request(start()), {
    messageId: 'correction-local',
    status: 'rejected',
    type: 'correction.resolved',
  });
  assert.deepEqual(
    rejected.messages.map((message) => message.id),
    ['user-local', 'assistant-local'],
  );
  assert.match(rejected.correctionError?.message ?? '', /no longer/);
});

test('a correction transport failure removes only its optimistic message', () => {
  let state = waveChatReducer(initialWaveChatState, {
    assistantId: 'assistant-local',
    input: 'Original request',
    type: 'send',
    userId: 'user-local',
  });
  state = waveChatReducer(state, {
    messageId: 'correction-local',
    text: 'Keep the draft',
    type: 'correction.requested',
  });
  state = waveChatReducer(state, {
    message: 'Wave lost the connection to Hermes.',
    messageId: 'correction-local',
    retryable: true,
    type: 'correction.failed',
  });

  assert.deepEqual(
    state.messages.map((message) => message.id),
    ['user-local', 'assistant-local'],
  );
  assert.deepEqual(state.correctionError, {
    message: 'Wave lost the connection to Hermes.',
    retryable: true,
  });
  assert.equal(state.status, 'submitting');
});

test('seals interim narration and preserves it beside the final segment', () => {
  let state = waveChatReducer(initialWaveChatState, {
    assistantId: 'assistant-local',
    input: 'Inspect the project',
    type: 'send',
    userId: 'user-local',
  });
  state = waveChatReducer(state, {
    event: event({ type: 'turn.started' }),
    type: 'event',
  });
  state = waveChatReducer(state, {
    delta: 'I will inspect the files.',
    timestamp: '2026-07-30T02:00:01.000Z',
    type: 'assistant.delta',
  });
  state = waveChatReducer(state, {
    event: {
      apiVersion: 'v1',
      content: 'I will inspect the files.',
      eventId: 'event-interim',
      messageId: 'assistant-local',
      sequence: 2,
      sessionId: 'session-1',
      timestamp: '2026-07-30T02:00:02.000Z',
      turnId: 'turn-1',
      type: 'assistant.interim',
    },
    type: 'event',
  });
  state = waveChatReducer(state, {
    delta: 'The checks passed.',
    timestamp: '2026-07-30T02:00:03.000Z',
    type: 'assistant.delta',
  });
  state = waveChatReducer(state, {
    event: {
      apiVersion: 'v1',
      content: 'The checks passed.',
      eventId: 'event-complete',
      interrupted: false,
      messageId: 'assistant-local',
      partial: false,
      sequence: 3,
      sessionId: 'session-1',
      timestamp: '2026-07-30T02:00:04.000Z',
      turnId: 'turn-1',
      type: 'assistant.completed',
    },
    type: 'event',
  });

  assert.deepEqual(state.messages[1]?.parts, [
    { sealed: true, text: 'I will inspect the files.', type: 'text' },
    { text: 'The checks passed.', type: 'text' },
  ]);

  const previewed = waveChatReducer(
    waveChatReducer(
      waveChatReducer(initialWaveChatState, {
        assistantId: 'assistant-preview',
        input: 'Preview this',
        type: 'send',
        userId: 'user-preview',
      }),
      {
        event: {
          apiVersion: 'v1',
          content: 'Preview text.',
          eventId: 'event-preview',
          messageId: 'assistant-preview',
          sequence: 1,
          sessionId: 'session-1',
          timestamp: '2026-07-30T02:00:01.000Z',
          turnId: 'turn-1',
          type: 'assistant.interim',
        },
        type: 'event',
      },
    ),
    {
      event: {
        apiVersion: 'v1',
        content: 'Preview text. Extended.',
        eventId: 'event-preview-complete',
        interrupted: false,
        messageId: 'assistant-preview',
        partial: false,
        replacesLastInterim: true,
        sequence: 2,
        sessionId: 'session-1',
        timestamp: '2026-07-30T02:00:02.000Z',
        turnId: 'turn-1',
        type: 'assistant.completed',
      },
      type: 'event',
    },
  );
  assert.deepEqual(previewed.messages[1]?.parts, [
    { text: 'Preview text. Extended.', type: 'text' },
  ]);
});

test('tracks reviewed activity, prompt waiting, and stale working hints', () => {
  const base = {
    apiVersion: 'v1' as const,
    eventId: 'event-activity',
    sequence: 1,
    sessionId: 'session-1',
    timestamp: '2026-07-30T02:00:00.000Z',
    turnId: 'turn-1',
  };
  let state = waveChatReducer(initialWaveChatState, {
    assistantId: 'assistant-local',
    input: 'Do the work',
    type: 'send',
    userId: 'user-local',
  });
  state = waveChatReducer(state, {
    event: { ...base, status: 'compacting', type: 'activity.status' },
    type: 'event',
  });
  assert.equal(state.liveStatus, 'working');
  assert.equal(waveChatActivityLabel(state), 'Summarizing conversation…');
  assert.equal(
    isWaveChatActivityStale(
      state,
      Date.parse(base.timestamp) + WAVE_CHAT_ACTIVITY_STALE_MS - 1,
    ),
    false,
  );
  assert.equal(
    isWaveChatActivityStale(
      state,
      Date.parse(base.timestamp) + WAVE_CHAT_ACTIVITY_STALE_MS,
    ),
    true,
  );

  state = waveChatReducer(state, {
    event: {
      ...base,
      allowsFreeText: true,
      choices: [],
      kind: 'clarify',
      promptId: 'prompt-1',
      question: 'Which path?',
      sequence: 2,
      type: 'prompt.request',
    },
    type: 'event',
  });
  assert.equal(state.liveStatus, 'waiting');
  assert.equal(isWaveChatActivityStale(state, Number.MAX_SAFE_INTEGER), false);

  state = waveChatReducer(state, {
    event: {
      ...base,
      eventId: 'event-while-waiting',
      sequence: 3,
      status: 'process-updated',
      type: 'activity.status',
    },
    type: 'event',
  });
  assert.equal(state.liveStatus, 'waiting');
  assert.equal(state.activePrompt?.promptId, 'prompt-1');
});

function event(
  value:
    | { type: 'turn.started' }
    | {
        messageId: string;
        sequence: number;
        status: 'completed' | 'failed' | 'progress' | 'started';
        toolInput?: {
          text: string;
          truncated: boolean;
        };
        toolName: string;
        toolOutput?: {
          text: string;
          truncated: boolean;
        };
        toolOutputIsPreview?: boolean;
        type: 'tool.status';
      },
) {
  return {
    apiVersion: 'v1' as const,
    eventId: `event-${value.sequence ?? 0}`,
    sequence: value.sequence ?? 0,
    sessionId: 'session-1',
    timestamp: '2026-07-30T02:00:00.000Z',
    turnId: 'turn-1',
    ...value,
  };
}

function hermesTimeline(
  messages: WaveConversationMessage[],
): WaveTimelineEntry[] {
  return messages.map((message, index) => {
    const { id, ...normalized } = message;
    return {
      id: id ?? `timeline-message-${index}`,
      message: normalized,
      source: 'hermes',
      turnId: 'timeline-turn-1',
      type: 'message',
    };
  });
}

test('tracks a mid-turn prompt through request, resolution, and turn end', () => {
  const base = {
    apiVersion: 'v1' as const,
    eventId: 'event-p',
    sessionId: 'session-1',
    timestamp: '2026-07-30T02:00:00.000Z',
    turnId: 'turn-1',
  };
  let state = waveChatReducer(initialWaveChatState, {
    assistantId: 'assistant-1',
    input: 'run it',
    type: 'send',
    userId: 'user-1',
  });
  state = waveChatReducer(state, {
    event: {
      ...base,
      allowsFreeText: false,
      choices: ['once', 'deny'],
      command: { text: 'rm -rf /tmp/x', truncated: false },
      description: 'delete in root path',
      kind: 'approval',
      promptId: 'approval-1',
      sequence: 1,
      type: 'prompt.request',
    },
    type: 'event',
  });
  assert.equal(state.activePrompt?.promptId, 'approval-1');
  assert.equal(state.activePrompt?.kind, 'approval');
  assert.deepEqual(state.activePrompt?.choices, ['once', 'deny']);
  assert.equal(state.status, 'streaming');

  // A resolution for a DIFFERENT prompt changes nothing.
  const unrelated = waveChatReducer(state, {
    event: { ...base, promptId: 'other', sequence: 2, type: 'prompt.resolved' },
    type: 'event',
  });
  assert.equal(unrelated.activePrompt?.promptId, 'approval-1');

  // The matching resolution clears it.
  const resolved = waveChatReducer(state, {
    event: {
      ...base,
      promptId: 'approval-1',
      sequence: 2,
      type: 'prompt.resolved',
    },
    type: 'event',
  });
  assert.equal(resolved.activePrompt, undefined);

  // A turn that ends while a prompt is showing also clears it.
  const ended = waveChatReducer(state, {
    event: { ...base, completed: true, sequence: 3, type: 'turn.completed' },
    type: 'event',
  });
  assert.equal(ended.activePrompt, undefined);

  // So does a transport failure.
  const failed = waveChatReducer(state, {
    message: 'boom',
    retryable: true,
    type: 'transport.error',
  });
  assert.equal(failed.activePrompt, undefined);
});

test('reasoning deltas accumulate, seal on completion, and stay bounded', () => {
  let state = waveChatReducer(initialWaveChatState, {
    assistantId: 'a1',
    input: 'question',
    type: 'send',
    userId: 'u1',
  });
  state = waveChatReducer(state, {
    event: event({
      delta: 'First thought. ',
      messageId: 'a1',
      type: 'reasoning.delta',
    }),
    type: 'event',
  });
  state = waveChatReducer(state, {
    event: event({
      delta: 'Second thought.',
      messageId: 'a1',
      type: 'reasoning.delta',
    }),
    type: 'event',
  });
  const assistant = state.messages.find((message) => message.id === 'a1');
  assert.equal(assistant?.reasoning?.text, 'First thought. Second thought.');
  assert.equal(assistant?.reasoningStreaming, true);

  state = waveChatReducer(state, {
    event: event({
      content: 'Answer.',
      interrupted: false,
      messageId: 'a1',
      partial: false,
      type: 'assistant.completed',
    }),
    type: 'event',
  });
  const sealed = state.messages.find((message) => message.id === 'a1');
  assert.equal(sealed?.reasoningStreaming, false);
  assert.equal(sealed?.reasoning?.text, 'First thought. Second thought.');
});

test('a turn ending without completion still seals a streaming trace', () => {
  let state = waveChatReducer(initialWaveChatState, {
    assistantId: 'a1',
    input: 'question',
    type: 'send',
    userId: 'u1',
  });
  state = waveChatReducer(state, {
    event: event({
      delta: 'thinking…',
      messageId: 'a1',
      type: 'reasoning.delta',
    }),
    type: 'event',
  });
  state = waveChatReducer(state, {
    event: event({ type: 'turn.completed' }),
    type: 'event',
  });
  assert.equal(
    state.messages.find((message) => message.id === 'a1')?.reasoningStreaming,
    false,
  );
});

test('timeline reasoning lands on the grouped assistant turn', () => {
  const messages = timelineToWaveChatMessages(
    hermesTimeline([
      { content: 'Ask', id: 'u1', role: 'user' },
      {
        content: '',
        id: 'r1',
        reasoning: { text: 'phase one', truncated: false },
        role: 'assistant',
      },
      {
        content: 'Answer.',
        id: 'a1',
        reasoning: { text: 'phase two', truncated: false },
        role: 'assistant',
      },
    ]),
  );
  assert.equal(messages.length, 2);
  assert.equal(messages[1]?.reasoning?.text, 'phase one\n\nphase two');
  assert.deepEqual(
    messages[1]?.parts.map((part) => part.type),
    ['text'],
  );
});

test('carries batched and multi-select clarify prompts into the active prompt', () => {
  const base = {
    apiVersion: 'v1' as const,
    eventId: 'event-batch',
    sessionId: 'session-1',
    timestamp: '2026-08-19T02:00:00.000Z',
    turnId: 'turn-1',
  };
  const questions = [
    {
      choices: ['alpha', 'beta'],
      multiSelect: true,
      question: 'Which?',
      questionId: 'q0',
    },
    {
      answer: 'locked',
      choices: [],
      multiSelect: false,
      question: 'Anything else?',
      questionId: 'q1',
    },
  ];
  let state = waveChatReducer(initialWaveChatState, {
    assistantId: 'assistant-1',
    input: 'plan it',
    type: 'send',
    userId: 'user-1',
  });
  state = waveChatReducer(state, {
    event: {
      ...base,
      allowsFreeText: true,
      choices: [],
      kind: 'clarify',
      promptId: 'req-batch',
      questions,
      sequence: 1,
      type: 'prompt.request',
    },
    type: 'event',
  });
  assert.deepEqual(state.activePrompt?.questions, questions);
  assert.equal(state.activePrompt?.multiSelect, undefined);
  assert.equal(state.liveStatus, 'waiting');
  state = waveChatReducer(state, {
    event: {
      ...base,
      allowsFreeText: true,
      choices: ['alpha', 'beta'],
      kind: 'clarify',
      multiSelect: true,
      promptId: 'req-multi',
      question: 'Which?',
      sequence: 2,
      type: 'prompt.request',
    },
    type: 'event',
  });
  assert.equal(state.activePrompt?.promptId, 'req-multi');
  assert.equal(state.activePrompt?.multiSelect, true);
  assert.equal(state.activePrompt?.questions, undefined);
  // The v0.20.5 loop wakeup narrates as a reviewed activity label.
  const looping = waveChatReducer(state, {
    event: {
      ...base,
      sequence: 3,
      status: 'loop-running',
      type: 'activity.status',
    },
    type: 'event',
  });
  assert.equal(waveChatActivityLabel(looping), 'Running a scheduled loop…');
});
