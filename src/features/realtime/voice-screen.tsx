import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Linking from 'expo-linking';
import { Redirect, useFocusEffect, useRouter } from 'expo-router';
import { Alert, Button, MicIcon, Soundwave, Typography } from 'panelui-native';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { AppState, ScrollView, View } from 'react-native';

import { registerMobileAgentStateProvider } from '@/dev/mobile-agent-state';
import { useWaveConnection } from '@/features/connection/connection-provider';
import { createGatewayAskHermesExecutor } from '@/features/realtime/gateway-ask-hermes-executor';
import {
  WaveRealtimeController,
  type RealtimeBackend,
  type WaveRealtimePhase,
} from '@/features/realtime/realtime-controller';
import {
  realtimeVoicePreferenceQueryKey,
  realtimeVoicePreferenceStore,
} from '@/features/realtime/realtime-voice-preference';
import { refreshWaveSessionTimeline } from '@/features/sessions/refresh-session-timeline';
import type { GatewayClient } from '@/services/gateway/gateway-client';
import { OpenAiRealtimeBackend } from '@/services/realtime/openai-realtime-backend';
import { openAiKeyStore } from '@/services/realtime/openai-key-store';
import { ReactNativeRealtimeTransport } from '@/services/realtime/react-native-realtime-transport';
import type { WaveTimelineResponse } from '@wave/contracts';

interface VoiceScreenProps {
  sessionId: string;
}

export function VoiceScreen({ sessionId }: VoiceScreenProps) {
  const { companionClient, state: connection } = useWaveConnection();

  // Connected only: the voice screen auto-starts a Realtime call on focus,
  // which has nothing to offer while the backend is unreachable. Chat
  // degrades to cached reading; voice does not degrade.
  if (connection.phase !== 'connected' || !companionClient || !sessionId) {
    return <Redirect href={sessionId ? '/' : '/new'} />;
  }
  return (
    <ConnectedVoiceScreen
      backend={companionClient}
      baseUrl={connection.identity.baseUrl}
      connectionId={connection.identity.id}
      loadTimeline={(before, signal) =>
        companionClient.getSessionTimeline(
          sessionId,
          { ...(before ? { before } : {}), limit: 100 },
          signal,
        )
      }
      sessionId={sessionId}
    />
  );
}

/**
 * Realtime on a gateway connection with the user-owned OpenAI key (stage 4).
 * The key is read from secure storage into memory only; the backend binds
 * ask_hermes to this conversation's session through trusted call state.
 */
export function KeyedRealtimeVoiceScreen({
  client,
  sessionId,
}: {
  client: GatewayClient;
  sessionId: string;
}) {
  const { state: connection } = useWaveConnection();
  const [apiKey, setApiKey] = useState<string | undefined | null>(undefined);

  useEffect(() => {
    let cancelled = false;
    void openAiKeyStore
      .load()
      .then((key) => {
        if (!cancelled) setApiKey(key ?? null);
      })
      .catch(() => {
        if (!cancelled) setApiKey(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (connection.phase !== 'connected' || !sessionId) {
    return <Redirect href={sessionId ? '/' : '/new'} />;
  }
  // Key vanished (removed in Settings mid-navigation): gateway voice owns
  // the route on the next visit; nothing renders a half-configured call.
  if (apiKey === null) return <Redirect href="/" />;
  if (apiKey === undefined) return null;

  return (
    <KeyedRealtimeVoiceScreenReady
      apiKey={apiKey}
      baseUrl={connection.identity.baseUrl}
      client={client}
      connectionId={connection.identity.id}
      sessionId={sessionId}
    />
  );
}

function KeyedRealtimeVoiceScreenReady({
  apiKey,
  baseUrl,
  client,
  connectionId,
  sessionId,
}: {
  apiKey: string;
  baseUrl: string;
  client: GatewayClient;
  connectionId: string;
  sessionId: string;
}) {
  const backend = useMemo(
    () =>
      new OpenAiRealtimeBackend({
        apiKey,
        executeAskHermes: createGatewayAskHermesExecutor({
          client,
          sessionId,
        }),
      }),
    [apiKey, client, sessionId],
  );
  return (
    <ConnectedVoiceScreen
      ephemeralTranscripts
      backend={backend}
      baseUrl={baseUrl}
      connectionId={connectionId}
      loadTimeline={(before, signal) =>
        client.getSessionTimeline(
          sessionId,
          { ...(before ? { before } : {}), limit: 100 },
          signal,
        )
      }
      sessionId={sessionId}
    />
  );
}

function ConnectedVoiceScreen({
  backend,
  baseUrl,
  connectionId,
  ephemeralTranscripts = false,
  loadTimeline,
  sessionId,
}: {
  backend: RealtimeBackend;
  baseUrl: string;
  connectionId: string;
  ephemeralTranscripts?: boolean;
  loadTimeline(
    before: string | undefined,
    signal?: AbortSignal,
  ): Promise<WaveTimelineResponse>;
  sessionId: string;
}) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const voicePreference = useQuery({
    queryFn: () => realtimeVoicePreferenceStore.load(),
    queryKey: realtimeVoicePreferenceQueryKey,
    retry: false,
    staleTime: Infinity,
  });
  const stopAndRefreshRef = useRef<Promise<void> | undefined>(undefined);
  const controller = useMemo(
    () =>
      new WaveRealtimeController({
        backend,
        transport: new ReactNativeRealtimeTransport(),
      }),
    [backend],
  );
  const state = useSyncExternalStore(controller.subscribe, controller.getState);
  const stopAndRefresh = useCallback(() => {
    if (stopAndRefreshRef.current) {
      return stopAndRefreshRef.current;
    }
    const task = (async () => {
      await controller.stop();
      if (controller.getState().phase !== 'idle') return;
      // The spoken exchange itself is not saved, but work delegated through
      // ask_hermes lands as ordinary turns — refresh so those are visible.
      await refreshWaveSessionTimeline({
        baseUrl,
        connectionId,
        load: loadTimeline,
        queryClient,
        sessionId,
      }).catch(() => undefined);
    })();
    stopAndRefreshRef.current = task;
    return task;
  }, [baseUrl, connectionId, controller, loadTimeline, queryClient, sessionId]);
  const start = useCallback(() => {
    if (voicePreference.isPending) return;
    stopAndRefreshRef.current = undefined;
    void controller.start(
      sessionId,
      voicePreference.data === 'default' ? undefined : voicePreference.data,
    );
  }, [controller, sessionId, voicePreference.data, voicePreference.isPending]);

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
          {ephemeralTranscripts ? (
            <Typography.Paragraph
              muted
              className="text-center text-xs"
              testID="voice-ephemeral-note">
              Live voice is not saved to this chat. Work Wave hands to Hermes
              shows up in the conversation afterward.
            </Typography.Paragraph>
          ) : null}
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
        {state.error?.kind === 'media_permission' ? (
          <Button
            fullWidth
            accessibilityLabel="Open microphone settings"
            testID="voice-open-settings-button"
            variant="outline"
            onPress={() => void Linking.openSettings()}>
            Open microphone settings
          </Button>
        ) : null}
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
      return 'Start when you are ready to talk with Wave.';
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
