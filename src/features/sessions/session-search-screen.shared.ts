import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  mergeSessionSearchResults,
  type SessionSearchResult,
} from '@/features/sessions/merge-session-search';
import {
  flattenWaveSessions,
  useWaveSessions,
} from '@/features/sessions/use-wave-sessions';
import { isOfflineLikeWaveError } from '@/services/query/offline-error';
import { activeSessionStore } from '@/services/sessions/active-session-store';
import type { GatewayClient } from '@/services/gateway/gateway-client';
import type { WaveChatClient } from '@/services/wave/wave-chat-client';

export const SEARCH_COPY = {
  loadError: 'Wave could not load Hermes conversations.',
  offlineNotice: 'Offline — searching cached chats',
} as const;

export function searchPlaceholder(hasGatewayClient: boolean) {
  return hasGatewayClient ? 'Search titles and messages' : 'Search titles';
}

export function emptySearchMessage(
  normalizedSearch: string,
  hasGatewayClient: boolean,
) {
  if (!normalizedSearch) return 'No previous conversations.';
  return hasGatewayClient
    ? 'No conversation title or message matches your search.'
    : 'No conversation title matches your search.';
}

/**
 * Owns every platform-neutral search behavior: the debounced query, the
 * local-title + server-content merge, the keep-paging-while-searching rule,
 * and result navigation. The iOS and Android screens contain presentation
 * only. Titles are matched locally because the gateway does not index them
 * (verified live on 0.19.0); the server search covers message content, which
 * the client cannot see.
 */
export function useSessionSearch({
  baseUrl,
  client,
  connectionId,
  gatewayClient,
}: {
  baseUrl: string;
  client: WaveChatClient;
  connectionId: string;
  gatewayClient?: GatewayClient;
}) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const sessionsQuery = useWaveSessions({ baseUrl, client, connectionId });
  const {
    data: sessionPages,
    error: sessionsError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isPending,
  } = sessionsQuery;
  const sessions = useMemo(
    () => flattenWaveSessions(sessionPages),
    [sessionPages],
  );
  const normalizedSearch = search.trim().toLocaleLowerCase();
  // Debounced so typing does not spam the gateway.
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(normalizedSearch), 250);
    return () => clearTimeout(timer);
  }, [normalizedSearch]);
  const contentSearch = useQuery({
    enabled: Boolean(gatewayClient) && debouncedSearch.length > 1,
    queryFn: ({ signal }) =>
      gatewayClient?.searchSessions(debouncedSearch, { limit: 30 }, signal) ?? {
        results: [],
      },
    queryKey: [
      'wave',
      connectionId,
      baseUrl,
      'session-search',
      debouncedSearch,
    ],
    staleTime: 30_000,
  });
  const matches = useMemo<SessionSearchResult[]>(
    () =>
      mergeSessionSearchResults({
        contentMatches:
          debouncedSearch === normalizedSearch
            ? (contentSearch.data?.results ?? [])
            : [],
        normalizedQuery: normalizedSearch,
        sessions,
      }),
    [contentSearch.data, debouncedSearch, normalizedSearch, sessions],
  );

  // An active query keeps paging the sessions list so an older matching
  // title cannot stay unreachable behind unloaded pages.
  useEffect(() => {
    if (normalizedSearch && hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [fetchNextPage, hasNextPage, isFetchingNextPage, normalizedSearch]);

  const openResult = useCallback(
    (sessionId: string) => {
      void activeSessionStore.save(connectionId, sessionId).then(() =>
        router.replace({
          pathname: '/conversation/[sessionId]',
          params: { sessionId },
        }),
      );
    },
    [connectionId, router],
  );
  const onEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  const offlineCached =
    Boolean(sessionsError) &&
    sessions.length > 0 &&
    isOfflineLikeWaveError(sessionsError);

  return {
    hasGatewayClient: Boolean(gatewayClient),
    listPending: isPending || isFetchingNextPage,
    loadFailed: Boolean(sessionsError) && !offlineCached,
    matches,
    normalizedSearch,
    offlineCached,
    onEndReached,
    openResult,
    setSearch,
  };
}
