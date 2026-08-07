import type { WaveChatMessage } from '@/features/chat/chat-state';

// Roughly a phone viewport of body text. Below this the whole tail fits on
// screen anyway and opening at the end shows the reader everything at once.
const LONG_TAIL_CHARS = 1200;

/**
 * Where a conversation should open: at the end normally, or anchored at the
 * reader's last message when the tail assistant turn plainly overflows the
 * viewport — landing on the question and reading down beats landing at the
 * bottom of an answer whose beginning scrolled away.
 */
export function initialConversationAnchor(
  messages: readonly WaveChatMessage[],
): number | undefined {
  const tail = messages[messages.length - 1];
  if (!tail || tail.role !== 'assistant') return undefined;
  const tailChars = tail.parts.reduce(
    (total, part) => (part.type === 'text' ? total + part.text.length : total),
    0,
  );
  if (tailChars < LONG_TAIL_CHARS) return undefined;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') return index;
  }
  return undefined;
}
