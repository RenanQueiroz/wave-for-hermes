import assert from 'node:assert/strict';
import test from 'node:test';

import { ActiveTurnRegistry } from './active-turns.ts';

test('bounds turns and prevents concurrent work per device or session', () => {
  const registry = new ActiveTurnRegistry(2);
  const first = registry.start('device-1', 'session-1');

  assert.throws(
    () => registry.start('device-1', 'session-2'),
    /already has an active turn/,
  );
  assert.throws(
    () => registry.start('device-2', 'session-1'),
    /already has an active turn/,
  );
  const second = registry.start('device-2', 'session-2');
  assert.throws(
    () => registry.start('device-3', 'session-3'),
    /maximum number/,
  );

  registry.finish(first.turnId);
  registry.finish(second.turnId);
  assert.doesNotThrow(() => registry.start('device-3', 'session-3'));
});

test('cancels only the authenticated device and session turn', () => {
  const registry = new ActiveTurnRegistry(2);
  const turn = registry.start('device-1', 'session-1');

  assert.equal(
    registry.cancel('device-2', 'session-1', turn.turnId),
    false,
  );
  assert.equal(
    registry.cancel('device-1', 'session-2', turn.turnId),
    false,
  );
  assert.equal(
    registry.cancel('device-1', 'session-1', turn.turnId),
    true,
  );
  assert.equal(turn.controller.signal.aborted, true);
  assert.equal(turn.abortReason(), 'cancelled');
});

test('aborts every active turn during server shutdown', () => {
  const registry = new ActiveTurnRegistry(2);
  const first = registry.start('device-1', 'session-1');
  const second = registry.start('device-2', 'session-2');

  registry.abortAll('server_shutdown');

  assert.equal(first.controller.signal.aborted, true);
  assert.equal(first.abortReason(), 'server_shutdown');
  assert.equal(second.controller.signal.aborted, true);
  assert.equal(second.abortReason(), 'server_shutdown');
});
