import assert from 'node:assert/strict';
import test from 'node:test';

import { QueryClient } from '@tanstack/react-query';

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
