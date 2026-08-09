import { useQueryClient } from '@tanstack/react-query';
import * as Linking from 'expo-linking';
import { Redirect, useFocusEffect, useRouter } from 'expo-router';
import {
  Alert,
  Button,
  MicIcon,
  RotateCcwIcon,
  Soundwave,
  Typography,
  XIcon,
} from 'panelui-native';
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
import {
  resolveRealtimeHarnessOverrides,
  type RealtimeHarnessOverrides,
} from '@/dev/realtime-harness';
import { createGatewayAskHermesExecutor } from '@/features/realtime/gateway-ask-hermes-executor';
import { createGatewayCorrectHermesExecutor } from '@/features/realtime/gateway-correct-hermes-executor';
import {
  WaveRealtimeController,
  type RealtimeBackend,
  type WaveRealtimePhase,
} from '@/features/realtime/realtime-controller';
import { refreshWaveSessionTimeline } from '@/features/sessions/refresh-session-timeline';
import { useConnectedWave } from '@/state/use-connected-wave';
import {
  realtimeCaptionPreference,
  realtimeModelPreference,
  realtimeVoicePreference,
} from '@/state/device-preferences';
import { useDevicePreference } from '@/state/use-device-state';
import type { GatewayClient } from '@/services/gateway/gateway-client';
import { OpenAiRealtimeBackend } from '@/services/realtime/openai-realtime-backend';
import { openAiKeyStore } from '@/services/realtime/openai-key-store';
import type { WaveRealtimeModelId } from '@/services/realtime/realtime-model-preference-record';
import type { RealtimeTransport } from '@/services/realtime/realtime-transport';
import { ReactNativeRealtimeTransport } from '@/services/realtime/react-native-realtime-transport';
import type { WaveTimelineResponse } from '@wave/contracts';

/**
 * Realtime on a gateway connection with the user-owned OpenAI key. The key is
 * read from secure storage into memory only; the backend binds ask_hermes to
 * this conversation's session through trusted call state.
 */
export function KeyedRealtimeVoiceScreen({
  client,
  sessionId,
}: {
  client: GatewayClient;
  sessionId: string;
}) {
  const connected = useConnectedWave();
  const [configuration, setConfiguration] = useState<
    | {
        apiKey: string;
        captions: boolean;
        harness: RealtimeHarnessOverrides | undefined;
        model: WaveRealtimeModelId;
      }
    | null
    | undefined
  >(undefined);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      openAiKeyStore.load(),
      realtimeModelPreference.read(),
      realtimeCaptionPreference.read(),
      // Dev-only harness mode; resolves undefined in production builds.
      resolveRealtimeHarnessOverrides().catch(() => undefined),
    ])
      .then(([apiKey, model, captions, harness]) => {
        if (!cancelled) {
          setConfiguration(
            apiKey ? { apiKey, captions, harness, model } : null,
          );
        }
      })
      .catch(() => {
        if (!cancelled) setConfiguration(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (connected?.phase !== 'connected' || !sessionId) {
    return <Redirect href={sessionId ? '/' : '/new'} />;
  }
  // Key vanished (removed in Settings mid-navigation): gateway voice owns
  // the route on the next visit; nothing renders a half-configured call.
  if (configuration === null) return <Redirect href="/" />;
  if (configuration === undefined) return null;

  return (
    <KeyedRealtimeVoiceScreenReady
      apiKey={configuration.apiKey}
      baseUrl={connected.baseUrl}
      client={client}
      connectionId={connected.connectionId}
      harness={configuration.harness}
      model={configuration.model}
      sessionId={sessionId}
      transcribeInput={configuration.captions}
    />
  );
}

function KeyedRealtimeVoiceScreenReady({
  apiKey,
  baseUrl,
  client,
  connectionId,
  harness,
  model,
  sessionId,
  transcribeInput,
}: {
  apiKey: string;
  baseUrl: string;
  client: GatewayClient;
  connectionId: string;
  harness: RealtimeHarnessOverrides | undefined;
  model: WaveRealtimeModelId;
  sessionId: string;
  transcribeInput: boolean;
}) {
  const backend = useMemo(
    () =>
      new OpenAiRealtimeBackend({
        apiKey,
        executeAskHermes: createGatewayAskHermesExecutor({
          client,
          sessionId,
        }),
        executeCorrectHermes: createGatewayCorrectHermesExecutor({
          client,
          sessionId,
        }),
        model,
        transcribeInput,
        // Dev-only harness mode: requests move to the local fake (with a
        // dummy bearer, never the saved key) and WebRTC is replaced by the
        // scripted transport below. Absent in production builds.
        ...(harness
          ? {
              fetchImpl: harness.fetchImpl,
              socketFactory: harness.socketFactory,
            }
          : {}),
      }),
    [apiKey, client, harness, model, sessionId, transcribeInput],
  );
  return (
    <ConnectedVoiceScreen
      ephemeralTranscripts
      backend={backend}
      baseUrl={baseUrl}
      connectionId={connectionId}
      harnessActive={Boolean(harness)}
      loadTimeline={(before, signal) =>
        client.getSessionTimeline(
          sessionId,
          { ...(before ? { before } : {}), limit: 100 },
          signal,
        )
      }
      sessionId={sessionId}
      transport={harness?.transport}
    />
  );
}

function ConnectedVoiceScreen({
  backend,
  baseUrl,
  connectionId,
  ephemeralTranscripts = false,
  harnessActive = false,
  loadTimeline,
  sessionId,
  transport,
}: {
  backend: RealtimeBackend;
  baseUrl: string;
  connectionId: string;
  ephemeralTranscripts?: boolean;
  harnessActive?: boolean;
  loadTimeline(
    before: string | undefined,
    signal?: AbortSignal,
  ): Promise<WaveTimelineResponse>;
  sessionId: string;
  transport?: RealtimeTransport;
}) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const voicePreference = useDevicePreference(realtimeVoicePreference);
  const stopAndRefreshRef = useRef<Promise<void> | undefined>(undefined);
  const controller = useMemo(
    () =>
      new WaveRealtimeController({
        backend,
        transport: transport ?? new ReactNativeRealtimeTransport(),
      }),
    [backend, transport],
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
    if (!voicePreference.hydrated) return;
    stopAndRefreshRef.current = undefined;
    void controller.start(
      sessionId,
      voicePreference.value === 'default' ? undefined : voicePreference.value,
    );
  }, [controller, sessionId, voicePreference.hydrated, voicePreference.value]);

  // Like gateway voice mode, the call starts from an explicit tap — opening
  // the route never opens the microphone by itself. Leaving still tears the
  // call down.
  useFocusEffect(
    useCallback(() => {
      return () => {
        void stopAndRefresh();
      };
    }, [stopAndRefresh]),
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
        assistantAudioLevel: state.assistantAudioLevel,
        cleanupPending: state.cleanupPending,
        errorKind: state.error?.kind,
        harnessActive,
        microphoneEnabled: state.microphoneEnabled,
        phase: state.phase,
        remoteAudioTracks: state.remoteAudioTracks,
        userAudioLevel: state.userAudioLevel,
      }),
    });
  }, [harnessActive, state]);

  const end = useCallback(async () => {
    await stopAndRefresh();
    if (controller.getState().phase === 'idle') router.back();
  }, [controller, router, stopAndRefresh]);
  const retryStop = useCallback(() => {
    stopAndRefreshRef.current = undefined;
    void stopAndRefresh();
  }, [stopAndRefresh]);

  const canStart = state.phase === 'idle' || state.phase === 'error';
  const userLevel = state.microphoneEnabled ? state.userAudioLevel : undefined;
  const ambientLevel =
    userLevel !== undefined || state.assistantAudioLevel !== undefined
      ? Math.max(userLevel ?? 0, state.assistantAudioLevel ?? 0)
      : undefined;

  return (
    <View className="flex-1 bg-background">
      {/* Decorative conversation glow behind the content: one bloom breathing
          on whichever party is louder. Missing native stats leave the level
          undefined so the phase animation carries it; the phase title and
          description remain the accessible status. */}
      <Soundwave
        level={ambientLevel}
        state={ambientVoiceState(state.phase)}
        testID="voice-ambient-glow"
        variant="ambient"
      />
      <ScrollView
        className="flex-1"
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

          <View className="w-full max-w-md gap-6">
            {state.userTranscript ? (
              <View className="gap-1">
                <Typography.Paragraph type="small" weight="semibold">
                  You
                </Typography.Paragraph>
                <Typography.Paragraph
                  selectable
                  muted
                  testID="voice-user-transcript">
                  {state.userTranscript}
                </Typography.Paragraph>
              </View>
            ) : null}
            {state.assistantTranscript ? (
              <View className="gap-1">
                <Typography.Paragraph type="small" weight="semibold">
                  Wave
                </Typography.Paragraph>
                <Typography.Paragraph
                  selectable
                  testID="voice-assistant-transcript">
                  {state.assistantTranscript}
                </Typography.Paragraph>
              </View>
            ) : null}
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
          {state.error?.kind === 'model_unavailable' ? (
            <Button
              fullWidth
              accessibilityLabel="Choose a different Realtime model"
              testID="voice-open-model-settings-button"
              variant="outline"
              onPress={() => router.replace('/settings')}>
              Review model in Settings
            </Button>
          ) : null}
          {state.cleanupPending ? (
            <Button
              fullWidth
              accessibilityLabel="Retry ending call"
              testID="voice-primary-button"
              onPress={retryStop}>
              <RotateCcwIcon size={18} />
              Retry ending call
            </Button>
          ) : canStart ? (
            <>
              <Button
                fullWidth
                accessibilityLabel="Start voice"
                testID="voice-primary-button"
                onPress={start}>
                <MicIcon size={18} />
                Start voice
              </Button>
              {/* The route is a headerless modal, so without this the only
                  exits are the system back gesture or starting a call. */}
              <Button
                fullWidth
                variant="outline"
                accessibilityLabel="Close live voice"
                testID="voice-close-button"
                onPress={() => void end()}>
                <XIcon size={18} />
                Close
              </Button>
            </>
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
                <XIcon size={18} />
                End
              </Button>
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function ambientVoiceState(
  phase: WaveRealtimePhase,
): 'idle' | 'listening' | 'speaking' | 'thinking' {
  if (phase === 'assistant_speaking') return 'speaking';
  if (phase === 'user_speaking' || phase === 'listening') return 'listening';
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
