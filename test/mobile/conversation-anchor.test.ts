import assert from 'node:assert/strict';
import test from 'node:test';

import { initialConversationAnchor } from '../../src/features/chat/conversation-anchor.ts';
import type { WaveChatMessage } from '../../src/features/chat/chat-state.ts';

function message(
  id: string,
  role: WaveChatMessage['role'],
  text: string,
): WaveChatMessage {
  return { id, parts: [{ text, type: 'text' }], role };
}

test('opens at the end for short tails, empty, and user tails', () => {
  assert.equal(initialConversationAnchor([]), undefined);
  assert.equal(
    initialConversationAnchor([
      message('u1', 'user', 'hi'),
      message('a1', 'assistant', 'short answer'),
    ]),
    undefined,
  );
  assert.equal(
    initialConversationAnchor([
      message('a1', 'assistant', 'x'.repeat(5000)),
      message('u1', 'user', 'follow-up'),
    ]),
    undefined,
  );
});

test('anchors at the last user message when the tail answer overflows', () => {
  const long = 'x'.repeat(2000);
  assert.equal(
    initialConversationAnchor([
      message('u1', 'user', 'first question'),
      message('a1', 'assistant', 'short'),
      message('u2', 'user', 'second question'),
      message('a2', 'assistant', long),
    ]),
    2,
  );
  // Task-only parts do not count toward tail length.
  assert.equal(
    initialConversationAnchor([
      message('u1', 'user', 'question'),
      {
        id: 'a1',
        parts: [
          {
            id: 't1',
            status: 'complete',
            title: 'read',
            type: 'task',
          },
          { text: 'short summary', type: 'text' },
        ],
        role: 'assistant',
      },
    ]),
    undefined,
  );
});

test('a long tail with no user message opens at the end', () => {
  assert.equal(
    initialConversationAnchor([message('a1', 'assistant', 'x'.repeat(3000))]),
    undefined,
  );
});
