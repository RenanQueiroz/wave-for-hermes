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

  assert.equal(registry.cancel('device-2', 'session-1', turn.turnId), false);
  assert.equal(registry.cancel('device-1', 'session-2', turn.turnId), false);
  assert.equal(registry.cancel('device-1', 'session-1', turn.turnId), true);
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

test('aborts only active turns owned by a revoked device', () => {
  const registry = new ActiveTurnRegistry(2);
  const first = registry.start('device-1', 'session-1');
  const second = registry.start('device-2', 'session-2');

  assert.equal(registry.abortDevice('device-1', 'cancelled'), 1);

  assert.equal(first.controller.signal.aborted, true);
  assert.equal(first.abortReason(), 'cancelled');
  assert.equal(second.controller.signal.aborted, false);
});

test('makes session deletion mutually exclusive with new turns', () => {
  const registry = new ActiveTurnRegistry(2);

  assert.equal(registry.reserveSessionDeletion('session-1'), true);
  assert.equal(registry.reserveSessionDeletion('session-1'), false);
  assert.throws(() => registry.start('device-1', 'session-1'), /being deleted/);

  registry.releaseSessionDeletion('session-1');
  const turn = registry.start('device-1', 'session-1');
  assert.equal(registry.reserveSessionDeletion('session-1'), false);
  registry.finish(turn.turnId);
  assert.equal(registry.reserveSessionDeletion('session-1'), true);
});

test('retains a finished turn for replay within the resume window', () => {
  const registry = new ActiveTurnRegistry(2);
  const turn = registry.start('device-1', 'session-1');
  registry.record(turn.turnId, 0, 'frame-0');
  registry.record(turn.turnId, 1, 'frame-1');
  registry.finish(turn.turnId);

  const record = registry.lookup('device-1', 'session-1', turn.turnId);
  assert.equal(record?.state, 'completed');
  assert.deepEqual(record?.buffer.replayAfter(0), ['frame-1']);
  // A retained turn is not active work: it must not be reported, block a new
  // turn, or block session deletion.
  assert.equal(registry.activeTurnFor('device-1', 'session-1'), undefined);
  assert.doesNotThrow(() => registry.start('device-1', 'session-1'));
});

test('purges a finished turn immediately when the resume window is disabled', () => {
  const registry = new ActiveTurnRegistry(2, { resumeWindowMs: 0 });
  const turn = registry.start('device-1', 'session-1');
  registry.record(turn.turnId, 0, 'frame-0');
  registry.finish(turn.turnId);

  assert.equal(
    registry.lookup('device-1', 'session-1', turn.turnId),
    undefined,
  );
});

test('hides turns from other devices and forwards frames to the newest attachment', () => {
  const registry = new ActiveTurnRegistry(2);
  const turn = registry.start('device-1', 'session-1');
  assert.equal(
    registry.lookup('device-2', 'session-1', turn.turnId),
    undefined,
  );
  assert.equal(
    registry.lookup('device-1', 'session-2', turn.turnId),
    undefined,
  );

  const received: string[] = [];
  let firstEnded = false;
  registry.setAttachment(turn.turnId, {
    end: () => {
      firstEnded = true;
    },
    write: () => {},
  });
  registry.setAttachment(turn.turnId, {
    end: () => {},
    write: (frame) => received.push(frame),
  });
  assert.equal(firstEnded, true);

  registry.record(turn.turnId, 0, 'frame-0');
  assert.deepEqual(received, ['frame-0']);
  assert.deepEqual(registry.activeTurnFor('device-1', 'session-1'), {
    latestSequence: 0,
    turnId: turn.turnId,
  });
});

test('drops retained replay state when the owning device is revoked', () => {
  const registry = new ActiveTurnRegistry(2);
  const turn = registry.start('device-1', 'session-1');
  registry.record(turn.turnId, 0, 'frame-0');
  registry.finish(turn.turnId);

  registry.abortDevice('device-1', 'cancelled');
  assert.equal(
    registry.lookup('device-1', 'session-1', turn.turnId),
    undefined,
  );
});
