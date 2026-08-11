import assert from 'node:assert/strict';
import test from 'node:test';

import { isChatDrawerRoute } from '../../src/features/navigation/chat-drawer-route.ts';

test('the drawer is available on chat entry routes', () => {
  assert.equal(isChatDrawerRoute('/new'), true);
  assert.equal(isChatDrawerRoute('/new/'), true);
  assert.equal(isChatDrawerRoute('/conversation/session-123'), true);
});

test('the drawer is unavailable outside top-level chat routes', () => {
  assert.equal(isChatDrawerRoute('/'), false);
  assert.equal(isChatDrawerRoute('/settings'), false);
  assert.equal(isChatDrawerRoute('/settings/model'), false);
  assert.equal(isChatDrawerRoute('/search'), false);
  assert.equal(isChatDrawerRoute('/development'), false);
  assert.equal(isChatDrawerRoute('/conversation/session-123/voice'), false);
});
