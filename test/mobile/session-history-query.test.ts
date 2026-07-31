import assert from 'node:assert/strict';
import test from 'node:test';

import { QueryClient } from '@tanstack/react-query';
import type { WaveSessionHistoryResponse } from '@wave/contracts';

import { refreshWaveSessionHistory } from '../../src/features/sessions/refresh-session-history.ts';
import { waveHistoryQueryKey } from '../../src/features/sessions/session-query-keys.ts';

test('refreshes canonical Hermes history before returning from live voice', async () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  const queryKey = waveHistoryQueryKey(
    'device-1',
    'https://wave.example.test',
    'session-1',
  );
  queryClient.setQueryData(queryKey, historyResponse('Before voice'));
  let loadCount = 0;

  const refreshed = await refreshWaveSessionHistory({
    baseUrl: 'https://wave.example.test',
    connectionId: 'device-1',
    load: async (signal) => {
      loadCount += 1;
      assert.equal(signal.aborted, false);
      return historyResponse('After voice');
    },
    queryClient,
    sessionId: 'session-1',
  });

  assert.equal(loadCount, 1);
  assert.equal(refreshed.messages[0]?.content, 'After voice');
  assert.deepEqual(
    queryClient.getQueryData(queryKey),
    historyResponse('After voice'),
  );
  queryClient.clear();
});

function historyResponse(content: string): WaveSessionHistoryResponse {
  return {
    apiVersion: 'v1',
    messages: [
      {
        content,
        id: 'message-1',
        role: 'assistant',
      },
    ],
    sessionId: 'session-1',
  };
}
