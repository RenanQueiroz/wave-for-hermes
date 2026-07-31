import assert from 'node:assert/strict';
import test from 'node:test';

import { QueryClient } from '@tanstack/react-query';
import type { WaveTimelineResponse } from '@wave/contracts';

import { refreshWaveSessionTimeline } from '../../src/features/sessions/refresh-session-timeline.ts';
import { waveTimelineQueryKey } from '../../src/features/sessions/session-query-keys.ts';

test('refreshes the unified timeline before returning from live voice', async () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  const queryKey = waveTimelineQueryKey(
    'device-1',
    'https://wave.example.test',
    'session-1',
  );
  queryClient.setQueryData(queryKey, {
    pageParams: [undefined],
    pages: [timelineResponse('Before voice')],
  });
  let loadCount = 0;

  const refreshed = await refreshWaveSessionTimeline({
    baseUrl: 'https://wave.example.test',
    connectionId: 'device-1',
    load: async (before, signal) => {
      loadCount += 1;
      assert.equal(before, undefined);
      assert.equal(signal.aborted, false);
      return timelineResponse('After voice');
    },
    queryClient,
    sessionId: 'session-1',
  });

  assert.equal(loadCount, 1);
  assert.equal(
    refreshed.pages[0]?.entries[0]?.type === 'message' &&
      refreshed.pages[0].entries[0].message.content,
    'After voice',
  );
  assert.deepEqual(queryClient.getQueryData(queryKey), {
    pageParams: [undefined],
    pages: [timelineResponse('After voice')],
  });
  queryClient.clear();
});

function timelineResponse(content: string): WaveTimelineResponse {
  return {
    apiVersion: 'v1',
    entries: [
      {
        id: 'message-1',
        message: {
          content,
          role: 'assistant',
        },
        source: 'wave',
        turnId: 'turn-1',
        type: 'message',
      },
    ],
    hasMore: false,
    limit: 100,
    sessionId: 'session-1',
  };
}
