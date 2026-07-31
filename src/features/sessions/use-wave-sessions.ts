import { useInfiniteQuery, type InfiniteData } from '@tanstack/react-query';
import type {
  WaveSessionListResponse,
  WaveSessionSummary,
} from '@wave/contracts';

import type { WaveBackendClient } from '@/services/wave/wave-backend-client';

import { waveSessionQueryKey } from './session-query-keys';

const SESSION_PAGE_SIZE = 50;

export function useWaveSessions({
  baseUrl,
  client,
  connectionId,
}: {
  baseUrl: string;
  client: WaveBackendClient;
  connectionId: string;
}) {
  return useInfiniteQuery<
    WaveSessionListResponse,
    Error,
    InfiniteData<WaveSessionListResponse>,
    ReturnType<typeof waveSessionQueryKey>,
    number
  >({
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? lastPage.offset + lastPage.sessions.length : undefined,
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) =>
      client.listSessions(
        {
          limit: SESSION_PAGE_SIZE,
          offset: pageParam,
        },
        signal,
      ),
    queryKey: waveSessionQueryKey(connectionId, baseUrl),
  });
}

export function flattenWaveSessions(
  data:
    | {
        pages: WaveSessionListResponse[];
      }
    | undefined,
): WaveSessionSummary[] {
  const sessions = new Map<string, WaveSessionSummary>();
  for (const page of data?.pages ?? []) {
    for (const session of page.sessions) {
      sessions.set(session.id, session);
    }
  }
  return [...sessions.values()];
}
