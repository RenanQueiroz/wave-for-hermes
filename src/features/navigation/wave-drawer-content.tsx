import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { WaveSessionSummary } from '@wave/contracts';
import { usePathname, useRouter } from 'expo-router';
import type { DrawerContentComponentProps } from 'expo-router/drawer';
import type { ReactNode } from 'react';
import {
  Alert,
  Button,
  CalendarIcon,
  Dialog,
  EllipsisIcon,
  Input,
  Item,
  Menu,
  PencilIcon,
  PlusSquareIcon,
  SearchIcon,
  Spinner,
  TrashIcon,
  Typography,
} from 'panelui-native';
import { memo, useCallback, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LegendList } from '@/components/legend-list';
import { useWaveConnection } from '@/features/connection/connection-provider';
import {
  flattenWaveSessions,
  useWaveSessions,
} from '@/features/sessions/use-wave-sessions';
import { waveSessionQueryKey } from '@/features/sessions/session-query-keys';
import { ActiveSessionStore } from '@/services/sessions/active-session-store';
import {
  WaveBackendError,
  type WaveBackendClient,
} from '@/services/wave/wave-backend-client';

export function WaveDrawerContent(props: DrawerContentComponentProps) {
  const connection = useWaveConnection();
  if (connection.state.phase !== 'connected' || !connection.client) {
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
      baseUrl={connection.state.summary.baseUrl}
      client={connection.client}
      connectionId={connection.state.summary.device.id}
      deviceName={connection.state.summary.device.name}
      disconnect={connection.disconnect}
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
  client: WaveBackendClient;
  connectionId: string;
  deviceName: string;
  disconnect(): Promise<boolean>;
}) {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const activeSessionStore = useMemo(() => new ActiveSessionStore(), []);
  const sessionsQuery = useWaveSessions({
    baseUrl,
    client,
    connectionId,
  });
  const sessions = useMemo(
    () => flattenWaveSessions(sessionsQuery.data),
    [sessionsQuery.data],
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
      setDeleteSession(undefined);
      void queryClient.invalidateQueries({ queryKey: sessionsKey });
      if (pathname.includes(result.sessionId)) {
        navigation.closeDrawer();
        router.replace('/new');
      }
    },
  });
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

  const navigate = (
    pathname: '/new' | '/search' | '/operations/jobs' | '/settings',
  ) => {
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
    [activeSessionStore, connectionId, navigation, router],
  );
  const startRename = useCallback((session: WaveSessionSummary) => {
    setRenameSession(session);
    setRenameTitle(sessionTitle(session));
  }, []);
  const renderSession = useCallback(
    ({ item }: { item: WaveSessionSummary }) => (
      <DrawerSessionItem
        session={item}
        onDelete={setDeleteSession}
        onOpen={openSession}
        onRename={startRename}
      />
    ),
    [openSession, startRename],
  );
  const mutationError = renameMutation.error ?? deleteMutation.error;
  const errorMessage =
    localError ??
    (mutationError ? drawerErrorMessage(mutationError) : undefined);

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
        <DrawerAction
          icon={<CalendarIcon size={19} />}
          label="Scheduled jobs"
          testID="drawer-scheduled-jobs"
          onPress={() => navigate('/operations/jobs')}
        />
      </View>

      {errorMessage ? (
        <Alert
          className="mx-3 mt-3"
          variant="destructive"
          testID="drawer-error">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Description>{errorMessage}</Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}

      {/* No recycleItems: each row owns a Menu, and recycled rows would
          carry that state across sessions. */}
      <LegendList
        className="flex-1"
        contentContainerClassName="px-2 py-3"
        contentInsetAdjustmentBehavior="automatic"
        data={sessions}
        keyExtractor={(session) => session.id}
        ListEmptyComponent={
          sessionsQuery.isPending ? (
            <View className="items-center py-8">
              <Spinner />
            </View>
          ) : (
            <Typography.Paragraph muted className="px-3 py-6">
              No previous conversations.
            </Typography.Paragraph>
          )
        }
        ListHeaderComponent={
          <Typography.Paragraph muted className="px-3 pb-2 text-xs uppercase">
            Conversations
          </Typography.Paragraph>
        }
        onEndReached={() => {
          if (sessionsQuery.hasNextPage && !sessionsQuery.isFetchingNextPage) {
            void sessionsQuery.fetchNextPage();
          }
        }}
        onEndReachedThreshold={0.5}
        refreshing={sessionsQuery.isRefetching}
        renderItem={renderSession}
        onRefresh={() => void sessionsQuery.refetch()}
      />

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
  session,
  onDelete,
  onOpen,
  onRename,
}: {
  session: WaveSessionSummary;
  onDelete: (session: WaveSessionSummary) => void;
  onOpen: (sessionId: string) => Promise<void>;
  onRename: (session: WaveSessionSummary) => void;
}) {
  return (
    <Item size="sm">
      <Pressable
        accessibilityLabel={`Open conversation ${sessionTitle(session)}`}
        accessibilityRole="button"
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
      <Item.Actions>
        <Menu haptics>
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
              onSelect={() => onRename(session)}>
              Rename
            </Menu.Item>
            <Menu.Separator />
            <Menu.Item
              icon={<TrashIcon size={16} />}
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
  return session.title ?? 'Untitled conversation';
}

function sessionDescription(session: WaveSessionSummary) {
  if (session.preview) return session.preview;
  if (session.lastActiveAt) {
    return new Date(session.lastActiveAt).toLocaleDateString();
  }
  if (session.messageCount !== undefined) {
    return `${session.messageCount} message${session.messageCount === 1 ? '' : 's'}`;
  }
  return 'Hermes conversation';
}

function drawerErrorMessage(error: unknown) {
  if (error instanceof WaveBackendError) return error.message;
  return 'Wave could not update the conversation.';
}
