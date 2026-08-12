import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Redirect,
  useFocusEffect,
  useNavigation,
  useRouter,
} from 'expo-router';
import { DrawerActions } from 'expo-router/react-navigation';
import { Alert, Button, Spinner, Typography } from 'panelui-native';
import { useCallback, useRef, useState } from 'react';
import { View } from 'react-native';

import { useWaveConnection } from '@/features/connection/connection-provider';
import { useTheme } from '@/hooks/use-theme';
import { activeSessionStore } from '@/services/sessions/active-session-store';

import { OfflineActions } from './offline-actions';
import { waveSessionQueryKey } from './session-query-keys';

export function NewConversationScreen() {
  const { client, retry, state } = useWaveConnection();

  if (state.phase === 'offline') {
    return <OfflineNewConversationScreen retry={retry} />;
  }
  if (state.phase !== 'connected' || !client) {
    return <Redirect href="/" />;
  }
  return (
    <ConnectedNewConversationScreen
      baseUrl={state.identity.baseUrl}
      client={client}
      connectionId={state.identity.id}
    />
  );
}

// Starting a conversation needs the gateway, so the offline landing points
// at what still works — reading the conversations cached on this phone — and
// leaves reconnection to a deliberate retry or the automatic re-verification.
function OfflineNewConversationScreen({ retry }: { retry(): Promise<void> }) {
  const navigation = useNavigation();
  const theme = useTheme();
  const [retrying, setRetrying] = useState(false);

  return (
    <View
      className="flex-1 items-center justify-center gap-4 bg-background px-8"
      testID="offline-new-conversation-screen">
      <Alert variant="warning" testID="offline-cold-start-notice">
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Title>Wave is offline</Alert.Title>
          <Alert.Description>
            Your Hermes agent cannot be reached right now. Conversations already
            on this phone stay readable, and new messages have to wait until the
            connection returns.
          </Alert.Description>
        </Alert.Content>
      </Alert>
      <View className="w-full max-w-sm">
        <OfflineActions
          colorScheme={theme.mode}
          retrying={retrying}
          seedColor={theme.primary}
          onBrowseCached={() => navigation.dispatch(DrawerActions.openDrawer())}
          onRetry={() => {
            if (retrying) return;
            setRetrying(true);
            void retry().finally(() => setRetrying(false));
          }}
        />
      </View>
    </View>
  );
}

function ConnectedNewConversationScreen({
  baseUrl,
  client,
  connectionId,
}: {
  baseUrl: string;
  client: NonNullable<ReturnType<typeof useWaveConnection>['client']>;
  connectionId: string;
}) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const startedRef = useRef(false);
  const createSession = useMutation({
    mutationFn: () => client.createSession(),
    onSuccess: async (result) => {
      // Navigation must not depend on the list refetch or the store write:
      // the chat screen re-saves the active session on mount, and a stranded
      // success here would leave this screen on its spinner forever.
      await activeSessionStore
        .save(connectionId, result.session.id)
        .catch(() => undefined);
      void queryClient.invalidateQueries({
        queryKey: waveSessionQueryKey(connectionId, baseUrl),
      });
      router.replace({
        pathname: '/conversation/[sessionId]',
        params: { sessionId: result.session.id },
      });
    },
  });
  const createNewSession = createSession.mutate;
  const resetCreateSession = createSession.reset;

  useFocusEffect(
    useCallback(() => {
      if (startedRef.current) return;
      startedRef.current = true;
      resetCreateSession();
      createNewSession();

      // Drawer routes stay mounted after navigation, so the next visit must
      // explicitly become eligible to create a fresh conversation.
      return () => {
        startedRef.current = false;
      };
    }, [createNewSession, resetCreateSession]),
  );

  return (
    <View
      className="flex-1 items-center justify-center gap-4 bg-background px-8"
      testID="new-conversation-screen">
      {createSession.error ? (
        <>
          <Alert variant="destructive" testID="new-conversation-error">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>Could not start a conversation</Alert.Title>
              <Alert.Description>
                Wave could not create a Hermes conversation.
              </Alert.Description>
            </Alert.Content>
          </Alert>
          <Button
            accessibilityLabel="Retry creating a conversation"
            testID="new-conversation-retry"
            onPress={() => createSession.mutate()}>
            Try again
          </Button>
        </>
      ) : (
        <>
          <Spinner size="lg" />
          <Typography.Paragraph muted>
            Starting a new conversation…
          </Typography.Paragraph>
        </>
      )}
    </View>
  );
}
