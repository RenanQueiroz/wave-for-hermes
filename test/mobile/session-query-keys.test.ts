import assert from 'node:assert/strict';
import test from 'node:test';

import { QueryClient } from '@tanstack/react-query';

import { mergeSessionSearchResults } from '../../src/features/sessions/merge-session-search.ts';
import {
  waveSessionQueryKey,
  waveTimelineQueryKey,
} from '../../src/features/sessions/session-query-keys.ts';

test('session list invalidation never matches conversation timelines', () => {
  const listKey = waveSessionQueryKey('device-1', 'https://wave.example.test');
  const timelineKey = waveTimelineQueryKey(
    'device-1',
    'https://wave.example.test',
    'session-1',
  );

  const queryClient = new QueryClient();
  queryClient.setQueryData(timelineKey, { pageParams: [], pages: [] });
  queryClient.setQueryData(listKey, { pageParams: [], pages: [] });

  const matched = queryClient
    .getQueryCache()
    .findAll({ queryKey: listKey })
    .map((query) => query.queryKey);

  assert.deepEqual(matched, [listKey]);
  queryClient.clear();
});

test('merges title matches ahead of gateway content matches', () => {
  // The gateway indexes message content and session ids but NOT titles
  // (verified live on 0.19.0), so Wave matches titles locally and merges the
  // server's content hits underneath without duplicating a session.
  const sessions = [
    { id: 's1', title: 'Deployment notes' },
    { id: 's2', title: 'Grocery list' },
    { id: 's3', title: 'Untitled chat' },
  ];

  const merged = mergeSessionSearchResults({
    contentMatches: [
      { sessionId: 's1', snippet: 'we discussed deployment' },
      { sessionId: 's3', snippet: 'ship the deployment friday' },
      { sessionId: 's9', snippet: 'a session not in the loaded list' },
    ],
    normalizedQuery: 'deployment',
    sessions,
  });

  assert.deepEqual(
    merged.map((match) => [match.session.id, match.matchedOn]),
    [
      // Title match first…
      ['s1', 'title'],
      // …then content matches the title pass did not already claim.
      ['s3', 'content'],
      ['s9', 'content'],
    ],
  );
  // A session claimed by title keeps its title provenance and no snippet.
  assert.equal(merged[0].snippet, undefined);
  assert.equal(merged[1].snippet, 'ship the deployment friday');
  // A content hit outside the loaded list still shows, with what we know.
  assert.deepEqual(merged[2].session, { id: 's9' });

  // An empty query lists everything as-is.
  assert.deepEqual(
    mergeSessionSearchResults({
      contentMatches: [],
      normalizedQuery: '',
      sessions,
    }).map((match) => match.session.id),
    ['s1', 's2', 's3'],
  );
});
