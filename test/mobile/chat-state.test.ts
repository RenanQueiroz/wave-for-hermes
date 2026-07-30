import assert from 'node:assert/strict';
import test from 'node:test';

import {
  historyToWaveChatMessages,
  initialWaveChatState,
  waveChatReducer,
} from '../../src/features/chat/chat-state.ts';

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
      status: 'completed',
      toolName: 'search',
      toolOutput: {
        text: '{"matches":3}',
        truncated: false,
      },
      toolOutputIsPreview: true,
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
      outputIsPreview: true,
      status: 'complete',
      title: 'search',
      type: 'task',
    },
  ]);
});

test('history exposes only normalized bounded tool input and output details', () => {
  const messages = historyToWaveChatMessages([
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
  ]);

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

test('history groups tool records into one assistant turn and removes empty avatars', () => {
  const messages = historyToWaveChatMessages([
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
  ]);

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
  assert.equal(
    JSON.stringify(messages).includes('file contents'),
    true,
  );
  assert.equal(
    JSON.stringify(messages).includes('search results'),
    true,
  );
});

test('keeps a safe turn error after reconciled history replaces optimistic messages', () => {
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
  state = waveChatReducer(state, { type: 'history.reconciled' });

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
