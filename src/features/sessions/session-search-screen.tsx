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
import { useWaveConnection } from '@/features/connection/connection-provider';
import {
  flattenWaveSessions,
  useWaveSessions,
} from '@/features/sessions/use-wave-sessions';
import { ActiveSessionStore } from '@/services/sessions/active-session-store';

export function SessionSearchScreen() {
  const connection = useWaveConnection();
  if (connection.state.phase !== 'connected' || !connection.client) {
    return <Redirect href="/" />;
  }
  return (
    <ConnectedSessionSearchScreen
      baseUrl={connection.state.summary.baseUrl}
      client={connection.client}
      connectionId={connection.state.summary.device.id}
    />
  );
}

function ConnectedSessionSearchScreen({
  baseUrl,
  client,
  connectionId,
}: {
  baseUrl: string;
  client: NonNullable<ReturnType<typeof useWaveConnection>['client']>;
  connectionId: string;
}) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const activeSessionStore = useMemo(() => new ActiveSessionStore(), []);
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
  const matches = useMemo(
    () =>
      normalizedSearch
        ? sessions.filter((session) =>
            (session.title ?? 'Untitled conversation')
              .toLocaleLowerCase()
              .includes(normalizedSearch),
          )
        : sessions,
    [normalizedSearch, sessions],
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
            accessibilityLabel="Search conversation titles"
            placeholder="Search titles"
            returnKeyType="search"
            testID="session-search-input"
            value={search}
            onChangeText={setSearch}
          />
        </InputGroup>
      </View>

      {sessionsError ? (
        <Alert
          className="mx-4 mb-3"
          variant="destructive"
          testID="session-search-error">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Description>
              Wave could not load Hermes conversations.
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}

      <LegendList
        recycleItems
        className="flex-1"
        contentContainerClassName="px-3 pb-6"
        data={matches}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        keyExtractor={(session) => session.id}
        ListEmptyComponent={
          isPending || isFetchingNextPage ? (
            <View className="items-center py-12">
              <Spinner />
            </View>
          ) : (
            <Typography.Paragraph muted className="px-3 py-10 text-center">
              {normalizedSearch
                ? 'No conversation title matches your search.'
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
            accessibilityLabel={`Open conversation ${item.title ?? 'Untitled conversation'}`}
            testID={`search-session-${item.id}`}
            onPress={() => {
              void activeSessionStore.save(connectionId, item.id).then(() =>
                router.replace({
                  pathname: '/conversation/[sessionId]',
                  params: { sessionId: item.id },
                }),
              );
            }}>
            <Item.Content>
              <Item.Title numberOfLines={1}>
                {item.title ?? 'Untitled conversation'}
              </Item.Title>
              <Item.Description numberOfLines={2}>
                {item.preview ?? 'Hermes conversation'}
              </Item.Description>
            </Item.Content>
          </Item>
        )}
      />
    </View>
  );
}
