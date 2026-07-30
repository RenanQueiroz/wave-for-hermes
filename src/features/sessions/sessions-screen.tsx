import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type { WaveSessionSummary } from '@wave/contracts';
import { Redirect, useRouter } from 'expo-router';
import {
  Alert,
  Button,
  ChevronRightIcon,
  EmptyState,
  Item,
  PlusIcon,
  Spinner,
  Typography,
} from 'panelui-native';
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { FlatList, View } from 'react-native';

import { useWaveConnection } from '@/features/connection/connection-provider';
import {
  ActiveSessionStore,
  ActiveSessionStoreError,
} from '@/services/sessions/active-session-store';
import { WaveBackendError } from '@/services/wave/wave-backend-client';
import type { WaveBackendClient } from '@/services/wave/wave-backend-client';

import { waveSessionQueryKey } from './session-query-keys';

export function SessionsScreen() {
  const { client, disconnect, state } = useWaveConnection();

  if (state.phase !== 'connected' || !client) {
    return <Redirect href="/" />;
  }
  return (
    <ConnectedSessionsScreen
      baseUrl={state.summary.baseUrl}
      client={client}
      connectionId={state.summary.device.id}
      disconnect={disconnect}
    />
  );
}

function ConnectedSessionsScreen({
  baseUrl,
  client,
  connectionId,
  disconnect,
}: {
  baseUrl: string;
  client: WaveBackendClient;
  connectionId: string;
  disconnect(): Promise<void>;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const activeSessionStore = useMemo(
    () => new ActiveSessionStore(),
    [],
  );
  const resumeAttemptedRef = useRef(false);
  const [localError, setLocalError] = useState<string | undefined>();

  const queryKey = waveSessionQueryKey(connectionId, baseUrl);
  const sessions = useQuery({
    queryFn: ({ signal }) => client.listSessions(signal),
    queryKey,
  });
  const createSession = useMutation({
    mutationFn: () => client.createSession(),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey });
      await openSession(result.session.id);
    },
  });
  const importSessions = useMutation({
    mutationFn: () => client.importSessions(),
    onSuccess: (result) => {
      queryClient.setQueryData(queryKey, result);
    },
  });

  const openSession = useCallback(
    async (sessionId: string) => {
      try {
        setLocalError(undefined);
        await activeSessionStore.save(connectionId, sessionId);
        router.push({
          pathname: '/sessions/[sessionId]',
          params: { sessionId },
        });
      } catch (error) {
        setLocalError(sessionErrorMessage(error));
      }
    },
    [activeSessionStore, connectionId, router],
  );

  useEffect(() => {
    if (
      resumeAttemptedRef.current ||
      !sessions.data
    ) {
      return;
    }
    resumeAttemptedRef.current = true;
    let active = true;
    void activeSessionStore.load(connectionId).then(
      (sessionId) => {
        if (
          active &&
          sessionId &&
          sessions.data.sessions.some(
            (session) => session.id === sessionId,
          )
        ) {
          void openSession(sessionId);
        }
      },
      (error: unknown) => {
        if (active) setLocalError(sessionErrorMessage(error));
      },
    );
    return () => {
      active = false;
    };
  }, [
    activeSessionStore,
    connectionId,
    openSession,
    sessions.data,
  ]);

  const busy = createSession.isPending || importSessions.isPending;
  const requestError =
    createSession.error ?? importSessions.error ?? sessions.error;
  const errorMessage =
    localError ??
    (requestError ? sessionErrorMessage(requestError) : undefined);

  return (
    <FlatList
      className="flex-1 bg-background"
      contentContainerClassName="mx-auto w-full max-w-xl gap-4 px-5 py-6"
      data={sessions.data?.sessions ?? []}
      keyExtractor={(session) => session.id}
      ListHeaderComponent={
        <View className="gap-4">
          <Alert variant="success" testID="connection-success">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>Connected to Hermes</Alert.Title>
              <Alert.Description>
                Choose a conversation or start a new one.
              </Alert.Description>
            </Alert.Content>
          </Alert>

          {errorMessage ? (
            <Alert variant="destructive" testID="sessions-error">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Title>Conversations unavailable</Alert.Title>
                <Alert.Description>{errorMessage}</Alert.Description>
              </Alert.Content>
            </Alert>
          ) : null}

          <View className="flex-row gap-3">
            <Button
              className="flex-1"
              accessibilityLabel="Start a new Hermes conversation"
              disabled={busy}
              loading={createSession.isPending}
              startContent={<PlusIcon size={18} />}
              testID="create-session-button"
              onPress={() => createSession.mutate()}>
              New conversation
            </Button>
            <Button
              variant="outline"
              accessibilityLabel="Refresh Hermes conversations"
              disabled={busy}
              testID="refresh-sessions-button"
              onPress={() => void sessions.refetch()}>
              Refresh
            </Button>
          </View>

          <Typography.Heading type="h2">
            Conversations
          </Typography.Heading>

          {sessions.isPending ? (
            <View
              className="items-center py-10"
              accessibilityLabel="Loading Hermes conversations"
              testID="sessions-loading">
              <Spinner size="lg" />
            </View>
          ) : null}
        </View>
      }
      ListEmptyComponent={
        !sessions.isPending ? (
          <EmptyState variant="card" size="sm">
            <EmptyState.Header>
              <EmptyState.Title>No conversations yet</EmptyState.Title>
              <EmptyState.Description>
                Start a new conversation, or import sessions already stored
                by Hermes.
              </EmptyState.Description>
            </EmptyState.Header>
            <EmptyState.Content>
              <Button
                variant="outline"
                accessibilityLabel="Import existing Hermes conversations"
                disabled={busy}
                loading={importSessions.isPending}
                testID="import-sessions-button"
                onPress={() => importSessions.mutate()}>
                Import existing
              </Button>
            </EmptyState.Content>
          </EmptyState>
        ) : null
      }
      ListFooterComponent={
        <View className="gap-2 pt-2">
          {sessions.data?.sessions.length ? (
            <Button
              variant="ghost"
              accessibilityLabel="Import existing Hermes conversations"
              disabled={busy}
              loading={importSessions.isPending}
              testID="import-sessions-button"
              onPress={() => importSessions.mutate()}>
              Import existing conversations
            </Button>
          ) : null}
          {__DEV__ ? (
            <Button
              variant="outline"
              accessibilityLabel="Open Wave development tools"
              testID="development-tools-button"
              onPress={() => router.push('/development')}>
              Development tools
            </Button>
          ) : null}
          <Button
            variant="ghost"
            accessibilityLabel="Disconnect this Wave device"
            testID="disconnect-device-button"
            onPress={() => void disconnect()}>
            Disconnect this device
          </Button>
        </View>
      }
      renderItem={({ item, index }) => (
        <Fragment>
          {index > 0 ? <Item.Separator /> : null}
          <Item
            variant="outline"
            accessibilityLabel={`Open conversation ${sessionTitle(item)}`}
            testID={`session-row-${item.id}`}
            onPress={() => void openSession(item.id)}>
            <Item.Content>
              <Item.Title>{sessionTitle(item)}</Item.Title>
              <Item.Description numberOfLines={2}>
                {sessionDescription(item)}
              </Item.Description>
            </Item.Content>
            <Item.Actions>
              <ChevronRightIcon size={18} />
            </Item.Actions>
          </Item>
        </Fragment>
      )}
    />
  );
}

function sessionTitle(session: WaveSessionSummary) {
  return session.title ?? 'Untitled conversation';
}

function sessionDescription(session: WaveSessionSummary) {
  if (session.preview) return session.preview;
  if (session.messageCount !== undefined) {
    return `${session.messageCount} message${session.messageCount === 1 ? '' : 's'}`;
  }
  if (session.lastActiveAt) {
    return `Last active ${new Date(session.lastActiveAt).toLocaleString()}`;
  }
  return 'Hermes conversation';
}

function sessionErrorMessage(error: unknown) {
  if (
    error instanceof WaveBackendError ||
    error instanceof ActiveSessionStoreError
  ) {
    return error.message;
  }
  return 'Wave could not load conversations.';
}
