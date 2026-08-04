import assert from 'node:assert/strict';
import test from 'node:test';

import type { InfiniteData } from '@tanstack/react-query';
import type { WaveSessionSummary } from '@wave/contracts';

import {
  nextWaveSessionPageOffset,
  setWaveSessionPinnedInPages,
} from '../../src/features/sessions/session-page-cache.ts';
import { organizeWaveSessions } from '../../src/features/sessions/session-organization.ts';
import type { WaveSessionPage } from '../../src/services/wave/wave-chat-client.ts';

const NOW = new Date('2026-08-03T18:00:00-04:00');

function session(
  id: string,
  input: Partial<WaveSessionSummary> = {},
): WaveSessionSummary {
  return {
    id,
    liveStatus: 'idle',
    pinned: false,
    source: 'chat',
    ...input,
  };
}

test('organizes pins and mutually exclusive local-calendar date groups', () => {
  const sections = organizeWaveSessions(
    [
      session('today', { lastActiveAt: '2026-08-03T08:00:00-04:00' }),
      session('future', { lastActiveAt: '2026-08-04T08:00:00-04:00' }),
      session('yesterday', { lastActiveAt: '2026-08-02T23:59:00-04:00' }),
      session('week', { lastActiveAt: '2026-07-28T12:00:00-04:00' }),
      session('old', { lastActiveAt: '2026-07-01T12:00:00-04:00' }),
      session('missing-date'),
      session('pinned-old', {
        lastActiveAt: '2020-01-01T00:00:00Z',
        pinned: true,
      }),
    ],
    'all',
    NOW,
  );

  assert.deepEqual(
    sections.map((section) => [
      section.label,
      section.sessions.map((row) => row.id),
    ]),
    [
      ['Pinned', ['pinned-old']],
      ['Today', ['future', 'today']],
      ['Yesterday', ['yesterday']],
      ['Previous 7 days', ['week']],
      ['Older', ['old', 'missing-date']],
    ],
  );
});

test('filters chats from automation, external, and unknown activity', () => {
  const sessions = [
    session('chat'),
    session('automation', { source: 'automation' }),
    session('external', { source: 'external' }),
    session('future-source', { source: 'other' }),
  ];
  assert.deepEqual(
    organizeWaveSessions(sessions, 'chats', NOW).flatMap((group) =>
      group.sessions.map((row) => row.id),
    ),
    ['chat'],
  );
  assert.deepEqual(
    organizeWaveSessions(sessions, 'activity', NOW).flatMap((group) =>
      group.sessions.map((row) => row.id),
    ),
    ['automation', 'external', 'future-source'],
  );
  assert.equal(
    organizeWaveSessions(sessions, 'all', NOW).flatMap(
      (group) => group.sessions,
    ).length,
    4,
  );
});

test('optimistic pinning updates duplicate server-backed rows immutably', () => {
  const first = session('s1');
  const data: InfiniteData<WaveSessionPage> = {
    pageParams: [0, 50],
    pages: [
      { hasMore: true, limit: 50, offset: 0, sessions: [first] },
      { hasMore: false, limit: 50, offset: 50, sessions: [first] },
    ],
  };
  const updated = setWaveSessionPinnedInPages(data, 's1', true);
  assert.notEqual(updated, data);
  assert.equal(updated?.pages[0].sessions[0].pinned, true);
  assert.equal(updated?.pages[1].sessions[0].pinned, true);
  assert.equal(data.pages[0].sessions[0].pinned, false);
  assert.equal(setWaveSessionPinnedInPages(updated, 'missing', true), updated);
});

test('pagination advances by server limit, not pin-backfilled row count', () => {
  const page: WaveSessionPage = {
    hasMore: true,
    limit: 50,
    offset: 100,
    sessions: Array.from({ length: 53 }, (_, index) => session(`s${index}`)),
  };
  assert.equal(nextWaveSessionPageOffset(page), 150);
  assert.equal(
    nextWaveSessionPageOffset({ ...page, hasMore: false }),
    undefined,
  );
});
