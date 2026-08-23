import { useInfiniteQuery, type InfiniteData } from '@tanstack/react-query';
import type { WaveSessionSummary } from '@wave/contracts';

import type {
  WaveChatClient,
  WaveSessionPage,
} from '@/services/wave/wave-chat-client';

import { nextWaveSessionPageOffset } from './session-page-cache';
import { waveSessionQueryKey } from './session-query-keys';

const SESSION_PAGE_SIZE = 50;

export function useWaveSessions({
  baseUrl,
  client,
  connectionId,
  enabled = true,
}: {
  baseUrl: string;
  client: WaveChatClient;
  connectionId: string;
  /**
   * `false` subscribes to the cached list without fetching it — for screens
   * that react to list state (read marks) but must not drive list loads.
   * Every observer shares these exact options, so a paged refetch triggered
   * elsewhere keeps chaining pages the same way.
   */
  enabled?: boolean;
}) {
  return useInfiniteQuery<
    WaveSessionPage,
    Error,
    InfiniteData<WaveSessionPage>,
    ReturnType<typeof waveSessionQueryKey>,
    number
  >({
    enabled,
    getNextPageParam: nextWaveSessionPageOffset,
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
