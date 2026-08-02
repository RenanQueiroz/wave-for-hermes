import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Linking from 'expo-linking';
import { useFocusEffect, useRouter } from 'expo-router';
import { Alert, Button, Soundwave, Typography } from 'panelui-native';
import { useCallback, useEffect } from 'react';
import { AppState, ScrollView, View } from 'react-native';

import { registerMobileAgentStateProvider } from '@/dev/mobile-agent-state';
import { refreshWaveSessionTimeline } from '@/features/sessions/refresh-session-timeline';
import {
  voicePhaseDescription,
  voicePhaseTitle,
  type GatewayVoicePhase,
} from '@/features/voice/gateway-voice-machine';
import { useGatewayVoice } from '@/features/voice/use-gateway-voice';
import type { GatewayClient } from '@/services/gateway/gateway-client';

/**
 * Voice mode against the user's own Hermes gateway: speech in and out runs
 * through the server's configured providers, so nothing here needs a key on
 * the device. The turns are ordinary conversation turns — unlike Realtime,
 * what is said in voice mode stays in the chat history.
 */
export function GatewayVoiceScreen({
  baseUrl,
  client,
  connectionId,
  sessionId,
}: {
  baseUrl: string;
  client: GatewayClient;
  connectionId: string;
  sessionId: string;
}) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const voice = useGatewayVoice({ client, sessionId });
  const { start, stop } = voice;

  // Speech has to be configured server-side. Probing once keeps the screen
  // from opening a microphone it has nowhere to send.
  const speech = useQuery({
    queryFn: ({ signal }) => client.getAudioCapabilities(signal),
    queryKey: ['wave', connectionId, baseUrl, 'audio-capabilities'],
    staleTime: 5 * 60 * 1000,
  });
  const canListen = speech.data?.stt === true;
  const canSpeak = speech.data?.tts === true;

  useFocusEffect(
    useCallback(() => {
      return () => {
        void stop();
      };
    }, [stop]),
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      // Recording in the background is neither offered nor wanted; the user
      // resumes deliberately.
      if (nextState === 'background') void stop();
    });
    return () => subscription.remove();
  }, [stop]);

  useEffect(() => {
    if (!__DEV__) return;
    return registerMobileAgentStateProvider({
      name: 'wave-gateway-voice',
      read: () => ({
        canListen,
        canSpeak,
        error: voice.state.error,
        phase: voice.state.phase,
        userTranscript: voice.state.userTranscript,
      }),
    });
  }, [canListen, canSpeak, voice.state]);

  const end = useCallback(async () => {
    await stop();
    // Voice turns are real turns, so the conversation behind this screen is
    // stale by the time the user leaves.
    await refreshWaveSessionTimeline({
      baseUrl,
      connectionId,
      load: (before, signal) =>
        client.getSessionTimeline(
          sessionId,
          { ...(before ? { before } : {}), limit: 100 },
          signal,
        ),
      queryClient,
      sessionId,
    }).catch(() => undefined);
    router.back();
  }, [baseUrl, client, connectionId, queryClient, router, sessionId, stop]);

  const phase = voice.state.phase;
  const idle = phase === 'idle';

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentInsetAdjustmentBehavior="automatic"
      contentContainerClassName="flex-grow gap-8 px-6 py-8">
      <View className="flex-1 items-center justify-center gap-8">
        <View className="w-full max-w-md items-center gap-3">
          <Typography.Heading type="h1">
            {voicePhaseTitle(phase)}
          </Typography.Heading>
          <Typography.Paragraph muted className="text-center">
            {voicePhaseDescription(phase)}
          </Typography.Paragraph>
        </View>

        <View className="w-full max-w-md gap-8">
          <View className="gap-3">
            <Typography.Paragraph type="small" weight="semibold">
              You
            </Typography.Paragraph>
            <Soundwave
              accessibilityLabel={
                phase === 'listening'
                  ? 'Your microphone is listening'
                  : 'Your microphone is off'
              }
              bars={32}
              height={48}
              mode="scrolling"
              state={userWaveState(phase)}
              testID="gateway-voice-user-wave"
              variant="bars"
            />
            {voice.state.userTranscript ? (
              <Typography.Paragraph
                selectable
                muted
                testID="gateway-voice-user-transcript">
                {voice.state.userTranscript}
              </Typography.Paragraph>
            ) : null}
          </View>

          <View className="gap-3">
            <Typography.Paragraph type="small" weight="semibold">
              Wave
            </Typography.Paragraph>
            <Soundwave
              accessibilityLabel={
                phase === 'speaking' ? 'Wave is speaking' : 'Wave is waiting'
              }
              height={56}
              state={assistantWaveState(phase)}
              testID="gateway-voice-assistant-wave"
              variant="line"
            />
            {voice.state.assistantText ? (
              <Typography.Paragraph
                selectable
                testID="gateway-voice-assistant-transcript">
                {voice.state.assistantText}
              </Typography.Paragraph>
            ) : null}
          </View>
        </View>

        {speech.isPending ? null : !canListen || !canSpeak ? (
          <Alert
            className="w-full max-w-md"
            variant="default"
            testID="gateway-voice-unavailable">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>{unavailableTitle(canListen, canSpeak)}</Alert.Title>
              <Alert.Description>
                {unavailableDescription(canListen, canSpeak)}
              </Alert.Description>
            </Alert.Content>
          </Alert>
        ) : null}

        {voice.state.error ? (
          <Alert
            className="w-full max-w-md"
            variant="destructive"
            testID="gateway-voice-error">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>Voice mode stopped</Alert.Title>
              <Alert.Description>{voice.state.error}</Alert.Description>
            </Alert.Content>
          </Alert>
        ) : null}
      </View>

      <View className="w-full max-w-md self-center gap-3">
        {voice.state.error?.includes('microphone access') ? (
          <Button
            fullWidth
            accessibilityLabel="Open microphone settings"
            testID="gateway-voice-open-settings-button"
            variant="outline"
            onPress={() => void Linking.openSettings()}>
            Open microphone settings
          </Button>
        ) : null}
        {idle ? (
          <Button
            fullWidth
            accessibilityLabel="Start voice mode"
            disabled={!canListen || !canSpeak}
            testID="gateway-voice-primary-button"
            onPress={() => void start()}>
            Start voice mode
          </Button>
        ) : (
          <View className="flex-row gap-3">
            <Button
              className="flex-1"
              variant="outline"
              accessibilityLabel={secondaryLabel(phase)}
              disabled={phase === 'transcribing' || phase === 'thinking'}
              testID="gateway-voice-secondary-button"
              onPress={
                phase === 'speaking' ? voice.skipSpeaking : voice.submitNow
              }>
              {secondaryLabel(phase)}
            </Button>
            <Button
              className="flex-1"
              variant="destructive"
              accessibilityLabel="End voice mode"
              testID="gateway-voice-end-button"
              onPress={() => void end()}>
              End
            </Button>
          </View>
        )}
      </View>
    </ScrollView>
  );
}

function assistantWaveState(
  phase: GatewayVoicePhase,
): 'idle' | 'speaking' | 'thinking' {
  if (phase === 'speaking') return 'speaking';
  if (phase === 'thinking' || phase === 'transcribing') return 'thinking';
  return 'idle';
}

function secondaryLabel(phase: GatewayVoicePhase) {
  if (phase === 'speaking') return 'Skip';
  if (phase === 'listening') return 'Send now';
  return 'Working…';
}

function unavailableDescription(canListen: boolean, canSpeak: boolean) {
  if (!canListen && !canSpeak) {
    return 'Configure a speech-to-text and a text-to-speech provider on your Hermes server to talk with Wave.';
  }
  return canListen
    ? 'Configure a text-to-speech provider on your Hermes server so Wave can answer out loud.'
    : 'Configure a speech-to-text provider on your Hermes server so Wave can hear you.';
}

function unavailableTitle(canListen: boolean, canSpeak: boolean) {
  if (!canListen && !canSpeak) return 'Voice is not set up on this server';
  return canListen ? 'This server cannot speak' : 'This server cannot listen';
}

function userWaveState(
  phase: GatewayVoicePhase,
): 'idle' | 'listening' | 'thinking' {
  if (phase === 'listening') return 'listening';
  if (phase === 'transcribing') return 'thinking';
  return 'idle';
}
