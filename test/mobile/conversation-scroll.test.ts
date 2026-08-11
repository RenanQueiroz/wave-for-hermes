import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isAtConversationEnd,
  isNearConversationEnd,
} from '../../src/components/conversation-scroll.ts';

function scrollEvent(
  offsetY: number,
  contentHeight: number,
  viewport = 800,
  bottomInset = 0,
) {
  return {
    contentInset: { bottom: bottomInset },
    contentOffset: { x: 0, y: offsetY },
    contentSize: { height: contentHeight, width: 400 },
    layoutMeasurement: { height: viewport, width: 400 },
  };
}

test('pins only within the near-end band', () => {
  // Resting exactly at the end.
  assert.equal(isNearConversationEnd(scrollEvent(9_200, 10_000)), true);
  // Just inside the 50%-of-viewport band (350px from the end).
  assert.equal(isNearConversationEnd(scrollEvent(8_850, 10_000)), true);
  // Outside the band (500px from the end).
  assert.equal(isNearConversationEnd(scrollEvent(8_700, 10_000)), false);
  // Reading far-back history — the case the pin must never fire in.
  assert.equal(isNearConversationEnd(scrollEvent(0, 10_000)), false);
});

test('content shorter than the viewport always counts as at the end', () => {
  assert.equal(isNearConversationEnd(scrollEvent(0, 300)), true);
  assert.equal(isAtConversationEnd(scrollEvent(0, 300)), true);
});

test('the jump control hides only at the actual end', () => {
  assert.equal(isAtConversationEnd(scrollEvent(9_200, 10_000)), true);
  assert.equal(isAtConversationEnd(scrollEvent(9_180, 10_000)), true);
  assert.equal(isAtConversationEnd(scrollEvent(9_175, 10_000)), false);
  // Auto-follow can be engaged while the explicit jump remains visible.
  assert.equal(isNearConversationEnd(scrollEvent(8_850, 10_000)), true);
  assert.equal(isAtConversationEnd(scrollEvent(8_850, 10_000)), false);
});

test('the actual end includes the platform-adjusted bottom inset', () => {
  assert.equal(isAtConversationEnd(scrollEvent(9_200, 10_000, 800, 34)), false);
  assert.equal(isAtConversationEnd(scrollEvent(9_210, 10_000, 800, 34)), true);
  assert.equal(isAtConversationEnd(scrollEvent(9_234, 10_000, 800, 34)), true);
});
