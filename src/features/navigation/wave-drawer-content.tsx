import {
  useMutation,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';
import type { WaveSessionSummary } from '@wave/contracts';
import { usePathname, useRouter } from 'expo-router';
import type { DrawerContentComponentProps } from 'expo-router/drawer';
import {
  Alert,
  BookmarkIcon,
  Button,
  Dialog,
  EllipsisIcon,
  Input,
  Item,
  Menu,
  PencilIcon,
  PlusSquareIcon,
  ScrollFade,
  SearchIcon,
  Spinner,
  TrashIcon,
  Typography,
} from 'panelui-native';
import type { ReactNode } from 'react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useRecyclingState } from '@legendapp/list/react-native';

import { LegendList } from '@/components/legend-list';
import { OfflineNotice } from '@/components/offline-notice';
import { useWaveConnection } from '@/features/connection/connection-provider';
import { useConnectedWave } from '@/state/use-connected-wave';
import { isOfflineLikeWaveError } from '@/services/query/offline-error';
import {
  waveSessionDataQueryKey,
  waveSessionQueryKey,
} from '@/features/sessions/session-query-keys';
import {
  flattenWaveSessions,
  useWaveSessions,
} from '@/features/sessions/use-wave-sessions';
import { setWaveSessionPinnedInPages } from '@/features/sessions/session-page-cache';
import {
  organizeWaveSessions,
  type WaveSessionFilter,
  type WaveSessionSectionId,
} from '@/features/sessions/session-organization';
import { activeSessionStore } from '@/services/sessions/active-session-store';
import { WaveBackendError } from '@/services/wave/wave-backend-error';
import type {
  WaveChatClient,
  WaveSessionPage,
} from '@/services/wave/wave-chat-client';

type DrawerSessionListItem =
  | {
      id: string;
      kind: 'section';
      label: string;
      sectionId: WaveSessionSectionId;
    }
  | { id: string; kind: 'session'; session: WaveSessionSummary };

export function WaveDrawerContent(props: DrawerContentComponentProps) {
  const { disconnect } = useWaveConnection();
  const connected = useConnectedWave();
  if (!connected) {
    return (
      <View
        className="flex-1 items-center justify-center bg-background"
        accessibilityLabel="Loading Wave menu">
        <Spinner />
      </View>
    );
  }
  return (
    <ConnectedWaveDrawerContent
      {...props}
      baseUrl={connected.baseUrl}
      client={connected.client}
      connectionId={connected.connectionId}
      deviceName={connected.label}
      disconnect={disconnect}
    />
  );
}

function ConnectedWaveDrawerContent({
  baseUrl,
  client,
  connectionId,
  deviceName,
  disconnect,
  navigation,
}: DrawerContentComponentProps & {
  baseUrl: string;
  client: WaveChatClient;
  connectionId: string;
  deviceName: string;
  disconnect(): Promise<boolean>;
}) {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const sessionsQuery = useWaveSessions({
    baseUrl,
    client,
    connectionId,
  });
  const sessions = useMemo(
    () => flattenWaveSessions(sessionsQuery.data),
    [sessionsQuery.data],
  );
  const [sessionFilter, setSessionFilter] =
    useState<WaveSessionFilter>('chats');
  const organizedSessions = useMemo(
    () => organizeWaveSessions(sessions, sessionFilter),
    [sessionFilter, sessions],
  );
  const sessionListItems = useMemo<DrawerSessionListItem[]>(
    () =>
      organizedSessions.flatMap((section) => [
        {
          id: `section-${section.id}`,
          kind: 'section' as const,
          label: section.label,
          sectionId: section.id,
        },
        ...section.sessions.map((session) => ({
          id: `session-${session.id}`,
          kind: 'session' as const,
          session,
        })),
      ]),
    [organizedSessions],
  );
  const [localError, setLocalError] = useState<string>();
  const [renameSession, setRenameSession] = useState<WaveSessionSummary>();
  const [renameTitle, setRenameTitle] = useState('');
  const [deleteSession, setDeleteSession] = useState<WaveSessionSummary>();
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const sessionsKey = waveSessionQueryKey(connectionId, baseUrl);

  const renameMutation = useMutation({
    mutationFn: ({ sessionId, title }: { sessionId: string; title: string }) =>
      client.updateSession(sessionId, { title }),
    onSuccess: () => {
      setRenameSession(undefined);
      void queryClient.invalidateQueries({ queryKey: sessionsKey });
    },
  });
  const deleteMutation = useMutation({
    mutationFn: (sessionId: string) => client.deleteSession(sessionId),
    onSuccess: async (result) => {
      // The dialog close and the navigation away from the deleted session
      // must not wait on the list refetch or fail on a store error.
      const activeSessionId = await activeSessionStore
        .load(connectionId)
        .catch(() => undefined);
      if (activeSessionId === result.sessionId) {
        await activeSessionStore.clear().catch(() => undefined);
      }
      queryClient.removeQueries({
        queryKey: waveSessionDataQueryKey(
          connectionId,
          baseUrl,
          result.sessionId,
        ),
      });
      setDeleteSession(undefined);
      void queryClient.invalidateQueries({ queryKey: sessionsKey });
      if (pathname.includes(result.sessionId)) {
        navigation.closeDrawer();
        router.replace('/new');
      }
    },
  });
  const pinMutation = useMutation({
    mutationFn: ({
      pinned,
      sessionId,
    }: {
      pinned: boolean;
      sessionId: string;
    }) => client.setSessionPinned(sessionId, pinned),
    onMutate: async ({ pinned, sessionId }) => {
      await queryClient.cancelQueries({ queryKey: sessionsKey });
      const previous =
        queryClient.getQueryData<InfiniteData<WaveSessionPage>>(sessionsKey);
      queryClient.setQueryData<InfiniteData<WaveSessionPage>>(
        sessionsKey,
        (current) => setWaveSessionPinnedInPages(current, sessionId, pinned),
      );
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(sessionsKey, context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: sessionsKey });
    },
  });
  const pinningSessionId = pinMutation.isPending
    ? pinMutation.variables?.sessionId
    : undefined;
  const mutatePin = pinMutation.mutate;
  const toggleSessionPin = useCallback(
    (session: WaveSessionSummary) =>
      mutatePin({ pinned: !session.pinned, sessionId: session.id }),
    [mutatePin],
  );
  const disconnectMutation = useMutation({
    mutationFn: disconnect,
    onSuccess: (disconnected) => {
      if (disconnected) {
        setDisconnectOpen(false);
        navigation.closeDrawer();
        router.replace('/');
      }
    },
  });

  const navigate = (pathname: '/new' | '/search' | '/settings') => {
    navigation.closeDrawer();
    // Every app screen lives in the one native stack, so drawer entries push
    // (or return to) stack routes rather than switching drawer siblings.
    router.navigate(pathname);
  };
  const openSession = useCallback(
    async (sessionId: string) => {
      try {
        setLocalError(undefined);
        await activeSessionStore.save(connectionId, sessionId);
        navigation.closeDrawer();
        router.push({
          pathname: '/conversation/[sessionId]',
          params: { sessionId },
        });
      } catch {
        setLocalError('Wave could not open that conversation.');
      }
    },
    [connectionId, navigation, router],
  );
  const startRename = useCallback((session: WaveSessionSummary) => {
    setRenameSession(session);
    setRenameTitle(sessionTitle(session));
  }, []);
  // A page can contain only sources outside the selected filter. Keep paging
  // an actually empty filtered list so an older matching conversation cannot
  // become unreachable just because no row exists to trigger onEndReached.
  useEffect(() => {
    if (
      sessionListItems.length === 0 &&
      sessionsQuery.hasNextPage &&
      !sessionsQuery.isFetchingNextPage
    ) {
      void sessionsQuery.fetchNextPage();
    }
  }, [sessionListItems.length, sessionsQuery]);
  const renderSessionListItem = useCallback(
    ({ item }: { item: DrawerSessionListItem }) =>
      item.kind === 'section' ? (
        <Typography.Paragraph
          muted
          className="px-3 pb-1 pt-3 text-xs uppercase"
          testID={`drawer-section-${item.sectionId}`}>
          {item.label}
        </Typography.Paragraph>
      ) : (
        <DrawerSessionItem
          pinning={pinningSessionId === item.session.id}
          selected={pathname.includes(item.session.id)}
          session={item.session}
          onDelete={setDeleteSession}
          onOpen={openSession}
          onPin={toggleSessionPin}
          onRename={startRename}
        />
      ),
    [openSession, pathname, pinningSessionId, startRename, toggleSessionPin],
  );
  const mutationError =
    renameMutation.error ?? deleteMutation.error ?? pinMutation.error;
  const errorMessage =
    localError ??
    (mutationError ? drawerErrorMessage(mutationError) : undefined);
  const showingCachedSessions =
    sessions.length > 0 && isOfflineLikeWaveError(sessionsQuery.error);

  return (
    <View
      className="flex-1 bg-background"
      style={{
        paddingBottom: Math.max(insets.bottom, 12),
        paddingTop: Math.max(insets.top, 12),
      }}>
      <View className="gap-1 border-b border-border px-3 pb-3">
        <Typography.Heading className="px-3 pb-2" type="h3">
          Wave
        </Typography.Heading>
        <DrawerAction
          icon={<PlusSquareIcon size={19} />}
          label="New conversation"
          testID="drawer-new-conversation"
          onPress={() => navigate('/new')}
        />
        <DrawerAction
          icon={<SearchIcon size={19} />}
          label="Search conversations"
          testID="drawer-search-conversations"
          onPress={() => navigate('/search')}
        />
      </View>

      {errorMessage ? (
        // Padding lives on the wrapper: the Alert is w-full, so horizontal
        // margins on it would push it past the drawer edge.
        <View className="px-3 pt-3">
          <Alert variant="destructive" testID="drawer-error">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Description>{errorMessage}</Alert.Description>
            </Alert.Content>
          </Alert>
        </View>
      ) : null}

      {/* The filter is a control over the list, not list content: it stays
          pinned so switching tabs never requires scrolling back to the top.
          Its wrapper mirrors the padding it had inside the list container. */}
      <View className="px-2 pt-3">
        <DrawerSessionFilters
          value={sessionFilter}
          onChange={setSessionFilter}
        />
      </View>

      {/* Recycled: mounting a fresh Menu-bearing row for every item during a
          fast fling cannot keep up and leaves the viewport blank. The row
          resets its menu state on recycle, and drawDistance buffers rows
          beyond the viewport. */}
      {/* Orientation is explicit: ScrollFade cannot infer it from a
          virtualized list the way it can from a ScrollView. */}
      <ScrollFade className="flex-1" orientation="vertical" size={40}>
        <LegendList
          recycleItems
          drawDistance={500}
          className="flex-1"
          contentContainerClassName="px-2 pb-3"
          contentInsetAdjustmentBehavior="automatic"
          data={sessionListItems}
          getItemType={(item) => item.kind}
          keyExtractor={(item) => item.id}
          ListEmptyComponent={
            sessionsQuery.isPending ? (
              <View className="items-center py-8">
                <Spinner />
              </View>
            ) : (
              <Typography.Paragraph muted className="px-3 py-6">
                {emptySessionFilterMessage(sessionFilter)}
              </Typography.Paragraph>
            )
          }
          ListHeaderComponent={
            showingCachedSessions ? (
              <OfflineNotice
                label="Offline — showing cached conversations"
                testID="drawer-offline-notice"
              />
            ) : null
          }
          onEndReached={() => {
            if (
              sessionsQuery.hasNextPage &&
              !sessionsQuery.isFetchingNextPage
            ) {
              void sessionsQuery.fetchNextPage();
            }
          }}
          onEndReachedThreshold={0.5}
          refreshing={sessionsQuery.isRefetching}
          renderItem={renderSessionListItem}
          onRefresh={() => void sessionsQuery.refetch()}
        />
      </ScrollFade>

      <View className="gap-1 border-t border-border px-3 pt-3">
        <DrawerAction
          label="Settings"
          testID="drawer-settings"
          onPress={() => navigate('/settings')}
        />
        <DrawerAction
          description={deviceName}
          label="Disconnect"
          testID="drawer-disconnect"
          onPress={() => setDisconnectOpen(true)}
        />
      </View>

      <Dialog
        open={renameSession !== undefined}
        onOpenChange={(open) => {
          if (!open && !renameMutation.isPending) {
            setRenameSession(undefined);
          }
        }}>
        <Dialog.Content blur>
          <Dialog.Title>Rename conversation</Dialog.Title>
          <Dialog.Description>
            This changes the title in Hermes for every connected client.
          </Dialog.Description>
          <Input
            autoFocus
            // The dialog itself does not reposition for the keyboard; lift
            // the field when the centered card lands under it.
            avoidKeyboard
            accessibilityLabel="Conversation title"
            className="mt-4"
            maxLength={200}
            testID="rename-session-input"
            value={renameTitle}
            onChangeText={setRenameTitle}
          />
          <Dialog.Footer className="mt-4">
            <Button
              variant="ghost"
              disabled={renameMutation.isPending}
              onPress={() => setRenameSession(undefined)}>
              Cancel
            </Button>
            <Button
              disabled={!renameTitle.trim() || renameMutation.isPending}
              loading={renameMutation.isPending}
              testID="rename-session-confirm"
              onPress={() => {
                if (!renameSession || !renameTitle.trim()) return;
                renameMutation.mutate({
                  sessionId: renameSession.id,
                  title: renameTitle.trim(),
                });
              }}>
              Save
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog>

      <Dialog
        open={deleteSession !== undefined}
        onOpenChange={(open) => {
          if (!open && !deleteMutation.isPending) {
            setDeleteSession(undefined);
          }
        }}>
        <Dialog.Content blur dismissible={!deleteMutation.isPending}>
          <Dialog.Title>Delete conversation?</Dialog.Title>
          <Dialog.Description>
            {deleteSession
              ? `“${sessionTitle(deleteSession)}” will be permanently deleted from Hermes.`
              : 'This conversation will be permanently deleted from Hermes.'}
          </Dialog.Description>
          <Dialog.Footer className="mt-4">
            <Button
              variant="ghost"
              disabled={deleteMutation.isPending}
              onPress={() => setDeleteSession(undefined)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending}
              loading={deleteMutation.isPending}
              testID="delete-session-confirm"
              onPress={() => {
                if (deleteSession) {
                  deleteMutation.mutate(deleteSession.id);
                }
              }}>
              Delete
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog>

      <Dialog
        open={disconnectOpen}
        onOpenChange={(open) => {
          if (!open && !disconnectMutation.isPending) {
            setDisconnectOpen(false);
          }
        }}>
        <Dialog.Content blur dismissible={!disconnectMutation.isPending}>
          <Dialog.Title>Disconnect this device?</Dialog.Title>
          <Dialog.Description>
            Wave will revoke this device on the Gateway, end its active work,
            and remove its credential from this phone.
          </Dialog.Description>
          <Dialog.Footer className="mt-4">
            <Button
              variant="ghost"
              disabled={disconnectMutation.isPending}
              onPress={() => setDisconnectOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={disconnectMutation.isPending}
              loading={disconnectMutation.isPending}
              testID="disconnect-device-confirm"
              onPress={() => disconnectMutation.mutate()}>
              Disconnect
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog>
    </View>
  );
}

// Memoized because the drawer re-renders on every dialog keystroke and
// mutation, and an inline row would rebuild the whole visible list each time.
const DrawerSessionItem = memo(function DrawerSessionItem({
  pinning,
  selected,
  session,
  onDelete,
  onOpen,
  onPin,
  onRename,
}: {
  pinning: boolean;
  selected: boolean;
  session: WaveSessionSummary;
  onDelete: (session: WaveSessionSummary) => void;
  onOpen: (sessionId: string) => Promise<void>;
  onPin: (session: WaveSessionSummary) => void;
  onRename: (session: WaveSessionSummary) => void;
}) {
  // Resets when the recycled row is reused for another session, so an open
  // menu never carries over.
  const [menuOpen, setMenuOpen] = useRecyclingState(false);

  return (
    <Item size="sm" variant={selected ? 'muted' : 'default'}>
      <Pressable
        accessibilityLabel={`Open conversation ${sessionTitle(session)}`}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        className="min-w-0 flex-1"
        testID={`drawer-session-${session.id}`}
        onPress={() => void onOpen(session.id)}>
        <Item.Content>
          <Item.Title numberOfLines={1}>{sessionTitle(session)}</Item.Title>
          <Item.Description numberOfLines={1}>
            {sessionDescription(session)}
          </Item.Description>
        </Item.Content>
      </Pressable>
      {session.pinned ? (
        <Item.Media
          variant="icon"
          accessibilityLabel="Pinned conversation"
          testID={`drawer-session-pinned-${session.id}`}>
          <BookmarkIcon size={15} />
        </Item.Media>
      ) : null}
      <Item.Actions>
        <Menu haptics open={menuOpen} onOpenChange={setMenuOpen}>
          <Menu.Trigger>
            <Button
              size="icon"
              variant="ghost"
              accessibilityLabel={`Conversation actions for ${sessionTitle(session)}`}
              testID={`drawer-session-actions-${session.id}`}>
              <EllipsisIcon size={18} />
            </Button>
          </Menu.Trigger>
          <Menu.Content align="end" scrollable={false} width={200}>
            <Menu.Item
              icon={<PencilIcon size={16} />}
              testID={`drawer-session-rename-${session.id}`}
              onSelect={() => onRename(session)}>
              Rename
            </Menu.Item>
            <Menu.Item
              disabled={pinning}
              icon={<BookmarkIcon size={16} />}
              testID={`drawer-session-pin-${session.id}`}
              onSelect={() => onPin(session)}>
              {session.pinned ? 'Unpin' : 'Pin'}
            </Menu.Item>
            <Menu.Separator />
            <Menu.Item
              icon={<TrashIcon size={16} />}
              testID={`drawer-session-delete-${session.id}`}
              variant="destructive"
              onSelect={() => onDelete(session)}>
              Delete
            </Menu.Item>
          </Menu.Content>
        </Menu>
      </Item.Actions>
    </Item>
  );
});

const SESSION_FILTERS: readonly {
  accessibilityLabel: string;
  label: string;
  value: WaveSessionFilter;
}[] = [
  { accessibilityLabel: 'Show chats', label: 'Chats', value: 'chats' },
  {
    accessibilityLabel: 'Show conversations from automations and other sources',
    label: 'Other sources',
    value: 'activity',
  },
];

function DrawerSessionFilters({
  onChange,
  value,
}: {
  onChange(value: WaveSessionFilter): void;
  value: WaveSessionFilter;
}) {
  return (
    <View className="gap-2 px-1 pb-2">
      <Typography.Paragraph muted className="px-2 text-xs uppercase">
        Conversations
      </Typography.Paragraph>
      <View
        accessibilityLabel="Conversation filters"
        accessibilityRole="tablist"
        className="flex-row rounded-lg bg-muted p-1">
        {SESSION_FILTERS.map((filter) => {
          const selected = value === filter.value;
          return (
            <View className="flex-1" key={filter.value}>
              <Button
                fullWidth
                accessibilityLabel={filter.accessibilityLabel}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                className="px-1"
                size="sm"
                testID={`drawer-filter-${filter.value}`}
                variant={selected ? 'secondary' : 'ghost'}
                onPress={() => onChange(filter.value)}>
                {filter.label}
              </Button>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function DrawerAction({
  description,
  icon,
  label,
  onPress,
  testID,
}: {
  description?: string;
  icon?: ReactNode;
  label: string;
  onPress(): void;
  testID: string;
}) {
  return (
    <Item
      size="sm"
      accessibilityLabel={label}
      testID={testID}
      onPress={onPress}>
      {icon ? <Item.Media variant="icon">{icon}</Item.Media> : null}
      <Item.Content>
        <Item.Title>{label}</Item.Title>
        {description ? (
          <Item.Description numberOfLines={1}>{description}</Item.Description>
        ) : null}
      </Item.Content>
    </Item>
  );
}

function sessionTitle(session: WaveSessionSummary) {
  return session.title ?? 'Untitled chat';
}

function sessionDescription(session: WaveSessionSummary) {
  const liveLabel =
    session.liveStatus === 'starting'
      ? 'Starting'
      : session.liveStatus === 'waiting'
        ? 'Waiting for input'
        : session.liveStatus === 'working'
          ? 'Working'
          : undefined;
  if (liveLabel) return liveLabel;
  const sourceLabel =
    session.source === 'automation'
      ? 'Automation'
      : session.source === 'external'
        ? 'External activity'
        : session.source === 'other'
          ? 'Other activity'
          : undefined;
  if (session.preview) {
    return sourceLabel
      ? `${sourceLabel} · ${session.preview}`
      : session.preview;
  }
  if (sourceLabel) return sourceLabel;
  if (session.lastActiveAt) {
    return new Date(session.lastActiveAt).toLocaleDateString();
  }
  if (session.messageCount !== undefined) {
    return `${session.messageCount} message${session.messageCount === 1 ? '' : 's'}`;
  }
  return 'Hermes conversation';
}

function emptySessionFilterMessage(filter: WaveSessionFilter) {
  if (filter === 'activity') {
    return 'No conversations from other sources.';
  }
  return 'No previous chats.';
}

function drawerErrorMessage(error: unknown) {
  if (error instanceof WaveBackendError) return error.message;
  return 'Wave could not update the conversation.';
}
