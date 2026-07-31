import { useQueryClient } from '@tanstack/react-query';
import { Redirect, useFocusEffect, useRouter } from 'expo-router';
import { Alert, Button, MicIcon, Soundwave, Typography } from 'panelui-native';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react';
import { AppState, ScrollView, View } from 'react-native';

import { registerMobileAgentStateProvider } from '@/dev/mobile-agent-state';
import { useWaveConnection } from '@/features/connection/connection-provider';
import {
  WaveRealtimeController,
  type WaveRealtimePhase,
} from '@/features/realtime/realtime-controller';
import { refreshWaveSessionHistory } from '@/features/sessions/refresh-session-history';
import { ReactNativeRealtimeTransport } from '@/services/realtime/react-native-realtime-transport';
import type { WaveBackendClient } from '@/services/wave/wave-backend-client';

interface VoiceScreenProps {
  sessionId: string;
}

export function VoiceScreen({ sessionId }: VoiceScreenProps) {
  const { client, state: connection } = useWaveConnection();

  if (connection.phase !== 'connected' || !client || !sessionId) {
    return <Redirect href={sessionId ? '/' : '/new'} />;
  }
  return (
    <ConnectedVoiceScreen
      baseUrl={connection.summary.baseUrl}
      client={client}
      connectionId={connection.summary.device.id}
      sessionId={sessionId}
    />
  );
}

function ConnectedVoiceScreen({
  baseUrl,
  client,
  connectionId,
  sessionId,
}: {
  baseUrl: string;
  client: WaveBackendClient;
  connectionId: string;
  sessionId: string;
}) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const stopAndRefreshRef = useRef<Promise<void> | undefined>(undefined);
  const controller = useMemo(
    () =>
      new WaveRealtimeController({
        backend: client,
        transport: new ReactNativeRealtimeTransport(),
      }),
    [client],
  );
  const state = useSyncExternalStore(controller.subscribe, controller.getState);
  const stopAndRefresh = useCallback(() => {
    if (stopAndRefreshRef.current) {
      return stopAndRefreshRef.current;
    }
    const task = (async () => {
      await controller.stop();
      if (controller.getState().phase !== 'idle') return;
      await refreshWaveSessionHistory({
        baseUrl,
        connectionId,
        load: (signal) => client.getSessionHistory(sessionId, signal),
        queryClient,
        sessionId,
      }).catch(() => undefined);
    })();
    stopAndRefreshRef.current = task;
    return task;
  }, [baseUrl, client, connectionId, controller, queryClient, sessionId]);
  const start = useCallback(() => {
    stopAndRefreshRef.current = undefined;
    void controller.start(sessionId);
  }, [controller, sessionId]);

  useFocusEffect(
    useCallback(() => {
      start();
      return () => {
        void stopAndRefresh();
      };
    }, [start, stopAndRefresh]),
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      const requestingPermission =
        controller.getState().phase === 'requesting_permission';
      if (nextState === 'background' && !requestingPermission) {
        void controller.stop();
      }
    });
    return () => subscription.remove();
  }, [controller]);

  useEffect(() => {
    if (!__DEV__) return;
    return registerMobileAgentStateProvider({
      name: 'wave-realtime',
      read: () => ({
        cleanupPending: state.cleanupPending,
        errorKind: state.error?.kind,
        microphoneEnabled: state.microphoneEnabled,
        phase: state.phase,
        remoteAudioTracks: state.remoteAudioTracks,
      }),
    });
  }, [state]);

  const end = useCallback(async () => {
    await stopAndRefresh();
    if (controller.getState().phase === 'idle') router.back();
  }, [controller, router, stopAndRefresh]);
  const retryStop = useCallback(() => {
    stopAndRefreshRef.current = undefined;
    void stopAndRefresh();
  }, [stopAndRefresh]);

  const canStart = state.phase === 'idle' || state.phase === 'error';

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentInsetAdjustmentBehavior="automatic"
      contentContainerClassName="flex-grow gap-8 px-6 py-8">
      <View className="flex-1 items-center justify-center gap-8">
        <View className="w-full max-w-md items-center gap-3">
          <Typography.Heading type="h1">
            {phaseTitle(state.phase)}
          </Typography.Heading>
          <Typography.Paragraph muted className="text-center">
            {phaseDescription(state.phase)}
          </Typography.Paragraph>
        </View>

        <View className="w-full max-w-md gap-8">
          <View className="gap-3">
            <Typography.Paragraph type="small" weight="semibold">
              You
            </Typography.Paragraph>
            <Soundwave
              accessibilityLabel={userWaveLabel(state.phase)}
              bars={32}
              height={48}
              mode="scrolling"
              state={userWaveState(state.phase)}
              testID="voice-user-wave"
              variant="bars"
            />
            {state.userTranscript ? (
              <Typography.Paragraph
                selectable
                muted
                testID="voice-user-transcript">
                {state.userTranscript}
              </Typography.Paragraph>
            ) : null}
          </View>

          <View className="gap-3">
            <Typography.Paragraph type="small" weight="semibold">
              Wave
            </Typography.Paragraph>
            <Soundwave
              accessibilityLabel={assistantWaveLabel(state.phase)}
              height={56}
              state={assistantWaveState(state.phase)}
              testID="voice-assistant-wave"
              variant="line"
            />
            {state.assistantTranscript ? (
              <Typography.Paragraph
                selectable
                testID="voice-assistant-transcript">
                {state.assistantTranscript}
              </Typography.Paragraph>
            ) : null}
          </View>
        </View>

        {state.error ? (
          <Alert
            className="w-full max-w-md"
            variant="destructive"
            testID="voice-error">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>Live voice interrupted</Alert.Title>
              <Alert.Description>{state.error.message}</Alert.Description>
            </Alert.Content>
          </Alert>
        ) : null}
      </View>

      <View className="w-full max-w-md self-center gap-3">
        {state.cleanupPending ? (
          <Button
            fullWidth
            accessibilityLabel="Retry ending call"
            testID="voice-primary-button"
            onPress={retryStop}>
            Retry ending call
          </Button>
        ) : canStart ? (
          <Button
            fullWidth
            accessibilityLabel="Start voice"
            testID="voice-primary-button"
            onPress={start}>
            Start voice
          </Button>
        ) : (
          <View className="flex-row gap-3">
            <Button
              className="flex-1"
              variant="outline"
              accessibilityLabel={
                state.microphoneEnabled
                  ? 'Mute microphone'
                  : 'Unmute microphone'
              }
              testID="voice-microphone-button"
              onPress={() =>
                controller.setMicrophoneEnabled(!state.microphoneEnabled)
              }>
              <MicIcon size={18} />
              {state.microphoneEnabled ? 'Mute' : 'Unmute'}
            </Button>
            <Button
              className="flex-1"
              variant="destructive"
              accessibilityLabel="End live voice"
              testID="voice-end-button"
              onPress={() => void end()}>
              End
            </Button>
          </View>
        )}
      </View>
    </ScrollView>
  );
}

function assistantWaveLabel(phase: WaveRealtimePhase) {
  return phase === 'assistant_speaking'
    ? 'Wave is speaking'
    : 'Wave is waiting';
}

function assistantWaveState(
  phase: WaveRealtimePhase,
): 'idle' | 'speaking' | 'thinking' {
  if (phase === 'assistant_speaking') return 'speaking';
  if (
    phase === 'connecting' ||
    phase === 'reconnecting' ||
    phase === 'requesting_permission' ||
    phase === 'stopping'
  ) {
    return 'thinking';
  }
  return 'idle';
}

function phaseDescription(phase: WaveRealtimePhase) {
  switch (phase) {
    case 'requesting_permission':
      return 'Allow microphone access to begin the conversation.';
    case 'connecting':
      return 'Creating a private live audio connection.';
    case 'listening':
      return 'Speak naturally. Wave will answer when you pause.';
    case 'user_speaking':
      return 'Wave is listening to you.';
    case 'assistant_speaking':
      return 'You can speak at any time to interrupt.';
    case 'reconnecting':
      return 'Keeping the current call while the connection recovers.';
    case 'stopping':
      return 'Closing audio and the server-side call.';
    case 'error':
      return 'No microphone audio is being sent.';
    case 'idle':
      return 'Start when you are ready to talk with Hermes.';
  }
}

function phaseTitle(phase: WaveRealtimePhase) {
  switch (phase) {
    case 'requesting_permission':
      return 'Microphone access';
    case 'connecting':
      return 'Connecting';
    case 'listening':
      return 'Listening';
    case 'user_speaking':
      return 'Listening';
    case 'assistant_speaking':
      return 'Wave is speaking';
    case 'reconnecting':
      return 'Reconnecting';
    case 'stopping':
      return 'Ending call';
    case 'error':
      return 'Call ended';
    case 'idle':
      return 'Live voice';
  }
}

function userWaveLabel(phase: WaveRealtimePhase) {
  return phase === 'user_speaking'
    ? 'Your microphone is receiving speech'
    : 'Your microphone is listening';
}

function userWaveState(
  phase: WaveRealtimePhase,
): 'idle' | 'listening' | 'thinking' {
  if (phase === 'user_speaking' || phase === 'listening') {
    return 'listening';
  }
  if (
    phase === 'connecting' ||
    phase === 'reconnecting' ||
    phase === 'requesting_permission' ||
    phase === 'stopping'
  ) {
    return 'thinking';
  }
  return 'idle';
}
