import assert from 'node:assert/strict';
import test from 'node:test';

import { sanitizeState } from './state.js';

test('recursively redacts sensitive state keys', () => {
  const result = sanitizeState({
    profile: {
      name: 'Renan',
      accessToken: 'not-visible',
    },
    api_key: 'also-not-visible',
  });

  assert.deepEqual(result.value, {
    profile: {
      name: 'Renan',
      accessToken: '[REDACTED]',
    },
    api_key: '[REDACTED]',
  });
  assert.equal(result.redactedKeys, 2);
});

test('enforces depth and byte limits', () => {
  const depthLimited = sanitizeState(
    { one: { two: { three: true } } },
    { maxDepth: 1 },
  );
  assert.deepEqual(depthLimited.value, { one: { two: '[MAX_DEPTH]' } });
  assert.equal(depthLimited.depthLimited, true);

  assert.throws(
    () => sanitizeState({ payload: 'x'.repeat(2_000) }, { maxBytes: 1_024 }),
    /exceeding the 1024-byte limit/,
  );
});
