import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Redirect, useFocusEffect, useRouter } from 'expo-router';
import { Alert, Button, Spinner, Typography } from 'panelui-native';
import { useCallback, useMemo, useRef } from 'react';
import { View } from 'react-native';

import { useWaveConnection } from '@/features/connection/connection-provider';
import { ActiveSessionStore } from '@/services/sessions/active-session-store';

import { waveSessionQueryKey } from './session-query-keys';

export function NewConversationScreen() {
  const { client, state } = useWaveConnection();

  if (state.phase !== 'connected' || !client) {
    return <Redirect href="/" />;
  }
  return (
    <ConnectedNewConversationScreen
      baseUrl={state.summary.baseUrl}
      client={client}
      connectionId={state.summary.device.id}
    />
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
  const activeSessionStore = useMemo(() => new ActiveSessionStore(), []);
  const createSession = useMutation({
    mutationFn: () => client.createSession(),
    onSuccess: async (result) => {
      await activeSessionStore.save(connectionId, result.session.id);
      await queryClient.invalidateQueries({
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
