import assert from 'node:assert/strict';
import test from 'node:test';

import { TurnStreamBuffer } from './turn-stream-buffer.ts';

test('replays only frames after the requested sequence', () => {
  const buffer = new TurnStreamBuffer();
  buffer.append(0, 'frame-0');
  buffer.append(1, 'frame-1');
  buffer.append(2, 'frame-2');

  assert.deepEqual(buffer.replayAfter(-1), ['frame-0', 'frame-1', 'frame-2']);
  assert.deepEqual(buffer.replayAfter(1), ['frame-2']);
  assert.deepEqual(buffer.replayAfter(2), []);
  assert.equal(buffer.latestSequence, 2);
});

test('refuses a replay position beyond what the turn emitted', () => {
  const buffer = new TurnStreamBuffer();
  assert.deepEqual(buffer.replayAfter(-1), []);
  assert.equal(buffer.replayAfter(0), undefined);

  buffer.append(0, 'frame-0');
  assert.equal(buffer.replayAfter(5), undefined);
});

test('refuses replays that would cross an evicted frame', () => {
  const buffer = new TurnStreamBuffer({ maxFrames: 2 });
  buffer.append(0, 'frame-0');
  buffer.append(1, 'frame-1');
  buffer.append(2, 'frame-2');

  assert.equal(buffer.replayAfter(-1), undefined);
  assert.deepEqual(buffer.replayAfter(0), ['frame-1', 'frame-2']);
  assert.deepEqual(buffer.replayAfter(1), ['frame-2']);
});

test('evicts oldest frames when the byte budget is exceeded', () => {
  const buffer = new TurnStreamBuffer({ maxBytes: 10 });
  buffer.append(0, 'aaaaa');
  buffer.append(1, 'bbbbb');
  buffer.append(2, 'c');

  assert.equal(buffer.replayAfter(-1), undefined);
  assert.deepEqual(buffer.replayAfter(0), ['bbbbb', 'c']);
});
