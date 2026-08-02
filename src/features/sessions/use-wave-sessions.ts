import { useInfiniteQuery, type InfiniteData } from '@tanstack/react-query';
import type { WaveSessionSummary } from '@wave/contracts';

import type {
  WaveChatClient,
  WaveSessionPage,
} from '@/services/wave/wave-chat-client';

import { waveSessionQueryKey } from './session-query-keys';

const SESSION_PAGE_SIZE = 50;

export function useWaveSessions({
  baseUrl,
  client,
  connectionId,
}: {
  baseUrl: string;
  client: WaveChatClient;
  connectionId: string;
}) {
  return useInfiniteQuery<
    WaveSessionPage,
    Error,
    InfiniteData<WaveSessionPage>,
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
        pages: WaveSessionPage[];
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
