import { type QueryClient } from '@tanstack/react-query';
import type { WaveTimelineResponse } from '@wave/contracts';

import { waveTimelineQueryKey } from './session-query-keys.ts';

export function refreshWaveSessionTimeline({
  baseUrl,
  connectionId,
  load,
  queryClient,
  sessionId,
}: {
  baseUrl: string;
  connectionId: string;
  load: (
    before: string | undefined,
    signal: AbortSignal,
  ) => Promise<WaveTimelineResponse>;
  queryClient: QueryClient;
  sessionId: string;
}) {
  const queryKey = waveTimelineQueryKey(connectionId, baseUrl, sessionId);
  return queryClient.fetchInfiniteQuery({
    getNextPageParam: (page: WaveTimelineResponse) =>
      page.hasMore ? page.nextCursor : undefined,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => load(pageParam, signal),
    queryKey,
    staleTime: 0,
  });
}
