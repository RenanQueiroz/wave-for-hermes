import assert from 'node:assert/strict';
import test from 'node:test';

import { calculateBoundedRetryDelay } from '../../src/services/query/retry-policy.ts';

test('applies bounded exponential retry delay with jitter', () => {
  assert.equal(calculateBoundedRetryDelay(-1, -1), 375);
  assert.equal(calculateBoundedRetryDelay(0, 0), 375);
  assert.equal(calculateBoundedRetryDelay(0, 0.5), 500);
  assert.equal(calculateBoundedRetryDelay(0, 1), 625);
  assert.equal(calculateBoundedRetryDelay(1, 0), 750);
  assert.equal(calculateBoundedRetryDelay(1, 1), 1_250);
  assert.equal(calculateBoundedRetryDelay(20, 0), 6_000);
  assert.equal(calculateBoundedRetryDelay(20, 1), 8_000);
  assert.equal(calculateBoundedRetryDelay(20, 2), 8_000);
  assert.equal(calculateBoundedRetryDelay(Number.NaN, Number.NaN), 500);
});
