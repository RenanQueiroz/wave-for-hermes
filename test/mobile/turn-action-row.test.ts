import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatAbsoluteTime,
  formatTimeAgo,
} from '../../src/features/chat/time-ago.ts';
import {
  branchCount,
  collectPrunedEntryIds,
  rebindTimelineSurvivorRowIds,
  regenerateTarget,
} from '../../src/features/chat/turn-action-targets.ts';

const NOW = Date.parse('2026-08-07T12:00:00.000Z');

test('time ago uses the coarsest unit and treats missing times as fresh', () => {
  assert.equal(formatTimeAgo(undefined, NOW), 'now');
  assert.equal(formatTimeAgo('garbage', NOW), 'now');
  assert.equal(formatTimeAgo('2026-08-07T11:59:59.500Z', NOW), 'now');
  assert.equal(formatTimeAgo('2026-08-07T11:59:15.000Z', NOW), '45s ago');
  assert.equal(formatTimeAgo('2026-08-07T11:38:00.000Z', NOW), '22m ago');
  assert.equal(formatTimeAgo('2026-08-07T05:00:00.000Z', NOW), '7h ago');
  assert.equal(formatTimeAgo('2026-08-03T12:00:00.000Z', NOW), '4d ago');
});

test('absolute time collapses to Today/Yesterday and dates beyond', () => {
  const local = (iso: string) => formatAbsoluteTime(iso, NOW);
  assert.match(local('2026-08-07T09:30:00.000Z'), /^Today \d{2}:\d{2}$/);
  assert.match(local('2026-08-06T09:30:00.000Z'), /^Yesterday \d{2}:\d{2}$/);
  assert.match(local('2026-06-05T14:30:00.000Z'), /^5 Jun \d{2}:\d{2}$/);
});

function userEntry(
  id: string,
  content: string,
  options: {
    ordinalExempt?: boolean;
    rowId?: number;
    source?: 'hermes' | 'wave';
  } = {},
) {
  return {
    id,
    message: {
      content,
      role: 'user' as const,
      ...(options.ordinalExempt ? { ordinalExempt: true } : {}),
    },
    ...(options.rowId === undefined ? {} : { rowId: options.rowId }),
    source: options.source ?? ('hermes' as const),
    turnId: `turn-${id}`,
    type: 'message' as const,
  };
}

function assistantEntry(id: string, content: string) {
  return {
    id,
    message: { content, role: 'assistant' as const },
    source: 'hermes' as const,
    turnId: `turn-${id}`,
    type: 'message' as const,
  };
}

const ENTRIES = [
  userEntry('u0', 'first question', { rowId: 10 }),
  assistantEntry('a0', 'first answer'),
  userEntry('banner', 'session banner', { ordinalExempt: true }),
  userEntry('wave-correction-1', 'steer it', { source: 'wave' }),
  userEntry('u1', 'second question', { rowId: 20 }),
  assistantEntry('a1', 'second answer'),
];

test('regenerate targets the nearest user turn in the gateway ordinal space', () => {
  // Wave-injected corrections and display_kind rows never shift the ordinal.
  assert.deepEqual(regenerateTarget(ENTRIES, 'a1'), {
    entryId: 'u1',
    ordinal: 1,
    rowId: 20,
    text: 'second question',
  });
  assert.deepEqual(regenerateTarget(ENTRIES, 'a0'), {
    entryId: 'u0',
    ordinal: 0,
    rowId: 10,
    text: 'first question',
  });
  // An id the timeline does not know is a just-completed live turn: the tail.
  assert.deepEqual(regenerateTarget(ENTRIES, 'assistant-local-9'), {
    entryId: 'u1',
    ordinal: 1,
    rowId: 20,
    text: 'second question',
  });
  assert.equal(regenerateTarget([], 'a1'), undefined);
});

test('surviving user rows rebind from the loaded suffix after a rewrite', () => {
  const rebound = rebindTimelineSurvivorRowIds(ENTRIES, [101, 202]);
  assert.equal(rebound.find((entry) => entry.id === 'u0')?.rowId, 101);
  assert.equal(rebound.find((entry) => entry.id === 'u1')?.rowId, 202);
  assert.equal(
    rebound.find((entry) => entry.id === 'wave-correction-1')?.rowId,
    undefined,
  );

  // When older pages are not loaded, the visible user is the newest suffix
  // of the server's full survivor list — align from the end.
  const suffix = rebindTimelineSurvivorRowIds(ENTRIES.slice(-2), [101, 202]);
  assert.equal(suffix[0]?.rowId, 202);

  const cleared = rebindTimelineSurvivorRowIds(ENTRIES.slice(0, 2), [null]);
  assert.equal(cleared[0]?.rowId, undefined);
});

test('pruning collects the replayed row and everything after it', () => {
  assert.deepEqual([...collectPrunedEntryIds(ENTRIES, 'u1')], ['u1', 'a1']);
  assert.equal(collectPrunedEntryIds(ENTRIES, 'missing').size, 0);
});

test('branch count is omitted at the tail and counts visible rows before it', () => {
  // a1 is the newest hermes message: whole-history branch, no count.
  assert.equal(branchCount(ENTRIES, 'a1'), undefined);
  assert.equal(branchCount(ENTRIES, 'assistant-local-9'), undefined);
  // a0 sits mid-history: rows u0 and a0 (wave rows are not server history).
  assert.equal(branchCount(ENTRIES, 'a0'), 2);
});
