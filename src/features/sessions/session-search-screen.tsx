import { useQuery } from '@tanstack/react-query';
import { Redirect, useRouter } from 'expo-router';
import {
  Alert,
  InputGroup,
  Item,
  SearchIcon,
  Spinner,
  Typography,
} from 'panelui-native';
import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';

import { LegendList } from '@/components/legend-list';
import { OfflineNotice } from '@/components/offline-notice';
import { useConnectedWave } from '@/state/use-connected-wave';
import { mergeSessionSearchResults } from '@/features/sessions/merge-session-search';
import { isOfflineLikeWaveError } from '@/services/query/offline-error';
import {
  flattenWaveSessions,
  useWaveSessions,
} from '@/features/sessions/use-wave-sessions';
import type { GatewayClient } from '@/services/gateway/gateway-client';
import type { WaveChatClient } from '@/services/wave/wave-chat-client';
import { activeSessionStore } from '@/services/sessions/active-session-store';

export function SessionSearchScreen() {
  const connected = useConnectedWave();
  if (!connected) {
    return <Redirect href="/" />;
  }
  return (
    <ConnectedSessionSearchScreen
      baseUrl={connected.baseUrl}
      client={connected.client}
      connectionId={connected.connectionId}
      gatewayClient={connected.gatewayClient}
    />
  );
}

function ConnectedSessionSearchScreen({
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
  const sessionsQuery = useWaveSessions({
    baseUrl,
    client,
    connectionId,
  });
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
  // Titles are matched locally because the gateway does not index them
  // (verified live on 0.19.0); the server search covers message content, which
  // the client cannot see. Debounced so typing does not spam the gateway.
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
  const matches = useMemo(
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

  useEffect(() => {
    if (normalizedSearch && hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [fetchNextPage, hasNextPage, isFetchingNextPage, normalizedSearch]);

  return (
    <View className="flex-1 bg-background">
      <View className="px-4 py-3">
        <InputGroup>
          <InputGroup.Prefix>
            <SearchIcon size={18} />
          </InputGroup.Prefix>
          <InputGroup.Input
            autoFocus
            accessibilityLabel="Search conversations"
            placeholder={
              gatewayClient ? 'Search titles and messages' : 'Search titles'
            }
            returnKeyType="search"
            testID="session-search-input"
            value={search}
            onChangeText={setSearch}
          />
        </InputGroup>
      </View>

      {sessionsError &&
      sessions.length > 0 &&
      isOfflineLikeWaveError(sessionsError) ? (
        <OfflineNotice
          label="Offline — searching cached chats"
          testID="session-search-offline-notice"
        />
      ) : sessionsError ? (
        // Padding lives on the wrapper: the Alert is w-full, so horizontal
        // margins on it would push it past the screen edge.
        <View className="px-4 pb-3">
          <Alert variant="destructive" testID="session-search-error">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Description>
                Wave could not load Hermes conversations.
              </Alert.Description>
            </Alert.Content>
          </Alert>
        </View>
      ) : null}

      <LegendList
        recycleItems
        drawDistance={500}
        className="flex-1"
        contentContainerClassName="px-3 pb-6"
        data={matches}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        keyExtractor={(match) => match.session.id}
        ListEmptyComponent={
          isPending || isFetchingNextPage ? (
            <View className="items-center py-12">
              <Spinner />
            </View>
          ) : (
            <Typography.Paragraph muted className="px-3 py-10 text-center">
              {normalizedSearch
                ? gatewayClient
                  ? 'No conversation title or message matches your search.'
                  : 'No conversation title matches your search.'
                : 'No previous conversations.'}
            </Typography.Paragraph>
          )
        }
        onEndReached={() => {
          if (hasNextPage && !isFetchingNextPage) {
            void fetchNextPage();
          }
        }}
        renderItem={({ item }) => (
          <Item
            accessibilityLabel={`Open conversation ${item.session.title ?? 'Untitled chat'}`}
            testID={`search-session-${item.session.id}`}
            onPress={() => {
              void activeSessionStore
                .save(connectionId, item.session.id)
                .then(() =>
                  router.replace({
                    pathname: '/conversation/[sessionId]',
                    params: { sessionId: item.session.id },
                  }),
                );
            }}>
            <Item.Content>
              <Item.Title numberOfLines={1}>
                {item.session.title ?? 'Untitled chat'}
              </Item.Title>
              <Item.Description numberOfLines={2}>
                {item.matchedOn === 'content'
                  ? `Message match: ${item.snippet ?? 'found in this conversation'}`
                  : (item.session.preview ?? 'Hermes conversation')}
              </Item.Description>
            </Item.Content>
          </Item>
        )}
      />
    </View>
  );
}
