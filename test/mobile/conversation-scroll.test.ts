import assert from 'node:assert/strict';
import test from 'node:test';

import { isNearConversationEnd } from '../../src/components/conversation-scroll.ts';

function scrollEvent(offsetY: number, contentHeight: number, viewport = 800) {
  return {
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
});
