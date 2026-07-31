import { type QueryClient } from '@tanstack/react-query';
import type { WaveSessionHistoryResponse } from '@wave/contracts';

import { waveHistoryQueryKey } from './session-query-keys.ts';

export function refreshWaveSessionHistory({
  baseUrl,
  connectionId,
  load,
  queryClient,
  sessionId,
}: {
  baseUrl: string;
  connectionId: string;
  load: (signal: AbortSignal) => Promise<WaveSessionHistoryResponse>;
  queryClient: QueryClient;
  sessionId: string;
}) {
  return queryClient.fetchQuery({
    queryFn: ({ signal }) => load(signal),
    queryKey: waveHistoryQueryKey(connectionId, baseUrl, sessionId),
    staleTime: 0,
  });
}
