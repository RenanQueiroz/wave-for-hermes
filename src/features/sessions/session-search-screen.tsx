import { Redirect, Stack } from 'expo-router';
import { useCallback } from 'react';

import { LegendList } from '@/components/legend-list';
import { OfflineNotice } from '@/components/offline-notice';
import {
  sessionSearchRowDescription,
  type SessionSearchResult,
} from '@/features/sessions/merge-session-search';
import { SessionSearchRow } from '@/features/sessions/session-search-row';
import {
  emptySearchMessage,
  SEARCH_COPY,
  searchPlaceholder,
  useSessionSearch,
} from '@/features/sessions/session-search-screen.shared';
import {
  SearchListEmpty,
  SearchLoadError,
} from '@/features/sessions/session-search-states';
import { useTheme } from '@/hooks/use-theme';
import type { GatewayClient } from '@/services/gateway/gateway-client';
import type { WaveChatClient } from '@/services/wave/wave-chat-client';
import { useConnectedWave } from '@/state/use-connected-wave';

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
  const theme = useTheme();
  const search = useSessionSearch({
    baseUrl,
    client,
    connectionId,
    gatewayClient,
  });
  const { openResult } = search;
  const renderItem = useCallback(
    ({ item }: { item: SessionSearchResult }) => (
      <SessionSearchRow
        description={sessionSearchRowDescription(item)}
        foregroundColor={theme.text}
        mutedColor={theme.textSecondary}
        testID={`search-session-${item.session.id}`}
        title={item.session.title ?? 'Untitled chat'}
        onPress={() => openResult(item.session.id)}
      />
    ),
    [openResult, theme.text, theme.textSecondary],
  );

  return (
    <>
      {/* Renders nothing in the tree: it configures the native header search
          field (UISearchController on iOS, the toolbar search view on
          Android), so the list below stays the route root and the large
          title keeps tracking it. */}
      <Stack.SearchBar
        autoCapitalize="none"
        autoFocus
        hideWhenScrolling={false}
        placeholder={searchPlaceholder(search.hasGatewayClient)}
        onChangeText={(event) => search.setSearch(event.nativeEvent.text)}
      />
      <LegendList
        recycleItems
        drawDistance={500}
        className="flex-1 bg-background"
        contentContainerClassName="px-3 pb-6"
        contentInsetAdjustmentBehavior="automatic"
        data={search.matches}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        keyExtractor={(match) => match.session.id}
        ListHeaderComponent={
          search.offlineCached ? (
            <OfflineNotice
              label={SEARCH_COPY.offlineNotice}
              testID="session-search-offline-notice"
            />
          ) : search.loadFailed ? (
            <SearchLoadError message={SEARCH_COPY.loadError} />
          ) : null
        }
        ListEmptyComponent={
          <SearchListEmpty
            message={emptySearchMessage(
              search.normalizedSearch,
              search.hasGatewayClient,
            )}
            pending={search.listPending}
          />
        }
        renderItem={renderItem}
        onEndReached={search.onEndReached}
      />
    </>
  );
}
