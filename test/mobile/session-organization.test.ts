import assert from 'node:assert/strict';
import test from 'node:test';

import type { InfiniteData } from '@tanstack/react-query';
import type { WaveSessionSummary } from '@wave/contracts';

import {
  nextWaveSessionPageOffset,
  setWaveSessionPinnedInPages,
  setWaveSessionTitleInPages,
} from '../../src/features/sessions/session-page-cache.ts';
import { organizeWaveSessions } from '../../src/features/sessions/session-organization.ts';
import type { WaveSessionPage } from '../../src/services/wave/wave-chat-client.ts';

// The grouping is by the device's local calendar, so fixtures must be built
// from local date components — fixed-offset ISO strings would shift across
// calendar days depending on the machine's timezone (this bit CI's UTC
// runners before it bit anyone's device).
const NOW = new Date(2026, 7, 3, 18, 0, 0);

function localIso(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): string {
  return new Date(year, month, day, hour, minute).toISOString();
}

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
      session('today', { lastActiveAt: localIso(2026, 7, 3, 8, 0) }),
      session('future', { lastActiveAt: localIso(2026, 7, 4, 8, 0) }),
      session('yesterday', { lastActiveAt: localIso(2026, 7, 2, 23, 59) }),
      session('week', { lastActiveAt: localIso(2026, 6, 28, 12, 0) }),
      session('old', { lastActiveAt: localIso(2026, 6, 1, 12, 0) }),
      session('missing-date'),
      session('pinned-old', {
        lastActiveAt: '2020-01-01T00:00:00Z',
        pinned: true,
      }),
    ],
    'chats',
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
  // The two filters partition the rows: together they cover every session
  // exactly once, so no source can fall through the tabs.
  assert.equal(
    organizeWaveSessions(sessions, 'chats', NOW).flatMap(
      (group) => group.sessions,
    ).length +
      organizeWaveSessions(sessions, 'activity', NOW).flatMap(
        (group) => group.sessions,
      ).length,
    sessions.length,
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

test('live titles update matching cached conversation rows immutably', () => {
  const first = session('s1');
  const data: InfiniteData<WaveSessionPage> = {
    pageParams: [0, 50],
    pages: [
      { hasMore: true, limit: 50, offset: 0, sessions: [first] },
      { hasMore: false, limit: 50, offset: 50, sessions: [first] },
    ],
  };
  const updated = setWaveSessionTitleInPages(data, 's1', 'Generated title');
  assert.equal(updated?.pages[0].sessions[0].title, 'Generated title');
  assert.equal(updated?.pages[1].sessions[0].title, 'Generated title');
  assert.equal(data.pages[0].sessions[0].title, undefined);
  assert.equal(
    setWaveSessionTitleInPages(updated, 'missing', 'No match'),
    updated,
  );
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
