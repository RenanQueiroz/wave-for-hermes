import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Linking from 'expo-linking';
import { useFocusEffect, useRouter } from 'expo-router';
import { Response, Typography } from 'panelui-native';
import { useCallback, useEffect, useState } from 'react';
import { AppState, ScrollView, View } from 'react-native';

import { PromptCard, type PromptCardResponse } from '@/components/prompt-card';
import { registerMobileAgentStateProvider } from '@/dev/mobile-agent-state';
import { refreshWaveSessionTimeline } from '@/features/sessions/refresh-session-timeline';
import {
  voicePhaseDescription,
  voicePhaseTitle,
  type GatewayVoicePhase,
} from '@/features/voice/gateway-voice-machine';
import { useGatewayVoice } from '@/features/voice/use-gateway-voice';
import { useVoiceKeepAwake } from '@/features/voice/use-voice-keep-awake';
import { VoiceActions } from '@/features/voice/voice-actions';
import { VoiceAmbientGlow } from '@/features/voice/voice-ambient-glow';
import { VoiceCallControls } from '@/features/voice/voice-call-controls';
import { VoiceNotice } from '@/features/voice/voice-notice';
import type {
  VoiceActionSpec,
  VoiceCallControlSpec,
} from '@/features/voice/voice-screen-ui.types';
import { VoiceStatus } from '@/features/voice/voice-status';
import { VoiceTranscript } from '@/features/voice/voice-transcript';
import type { GatewayClient } from '@/services/gateway/gateway-client';
import { dbfsToAudioLevel } from '@/services/audio/audio-level';

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
  const { respondToPrompt, start, stop } = voice;

  // Mid-turn prompts render the same card chat uses; the loop waits in
  // `thinking` until the answer (or the server-side expiry) unblocks it.
  // Busy/error state is stamped with its prompt so a new prompt starts clean.
  const [promptStatus, setPromptStatus] = useState<{
    busy: boolean;
    error?: string;
    promptId?: string;
  }>({ busy: false });
  const activePromptId = voice.state.prompt?.promptId;
  const promptBusy =
    promptStatus.promptId === activePromptId && promptStatus.busy;
  const promptError =
    promptStatus.promptId === activePromptId ? promptStatus.error : undefined;
  const answerPrompt = useCallback(
    (response: PromptCardResponse) => {
      const prompt = voice.state.prompt;
      if (!prompt) return;
      const input =
        response.kind === 'approval'
          ? { choice: response.choice, kind: 'approval' as const }
          : response.kind === 'clarify'
            ? {
                answer: response.answer,
                kind: 'clarify' as const,
                promptId: prompt.promptId,
              }
            : {
                kind:
                  prompt.kind === 'sudo'
                    ? ('sudo' as const)
                    : ('secret' as const),
                promptId: prompt.promptId,
              };
      setPromptStatus({ busy: true, promptId: prompt.promptId });
      void respondToPrompt(input).catch(() => {
        setPromptStatus({
          busy: false,
          error: 'Wave could not deliver that answer.',
          promptId: prompt.promptId,
        });
      });
    },
    [respondToPrompt, voice.state.prompt],
  );

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
        assistantAudioLevel: voice.state.assistantAudioLevel,
        canListen,
        canSpeak,
        error: voice.state.error,
        meter: voice.meterDebug.current,
        muted: voice.state.muted,
        phase: voice.state.phase,
        replyStreaming: voice.state.replyStreaming,
        userAudioLevel:
          voice.state.level === undefined
            ? undefined
            : dbfsToAudioLevel(voice.state.level),
        userTranscript: voice.state.userTranscript,
      }),
    });
  }, [canListen, canSpeak, voice.meterDebug, voice.state]);

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

  // Auto-lock would kill the loop mid-conversation: backgrounding stops it
  // above, and nothing else holds the screen awake in a release build.
  useVoiceKeepAwake(voice.state.phase !== 'idle');

  const phase = voice.state.phase;
  const idle = phase === 'idle';
  const userLevel =
    voice.state.level === undefined
      ? undefined
      : dbfsToAudioLevel(voice.state.level);
  const ambientLevel =
    userLevel !== undefined || voice.state.assistantAudioLevel !== undefined
      ? Math.max(userLevel ?? 0, voice.state.assistantAudioLevel ?? 0)
      : undefined;
  const mutedWhileListening = voice.state.muted && phase === 'listening';

  const utilityRows: VoiceActionSpec[][] = voice.state.error?.includes(
    'microphone access',
  )
    ? [
        [
          {
            accessibilityLabel: 'Open microphone settings',
            key: 'open-settings',
            kind: 'outline',
            label: 'Open microphone settings',
            onPress: () => void Linking.openSettings(),
            testID: 'gateway-voice-open-settings-button',
          },
        ],
      ]
    : [];
  const callControls: VoiceCallControlSpec[] = idle
    ? [
        {
          accessibilityLabel: 'Start voice mode',
          disabled: !canListen || !canSpeak,
          glyph: 'wave',
          key: 'start',
          label: 'Start voice',
          onPress: () => void start(),
          role: 'start',
          testID: 'gateway-voice-primary-button',
        },
        // The screen must be leavable without starting — with no providers
        // configured, Start is disabled and this is the only exit.
        {
          accessibilityLabel: 'Close voice mode',
          glyph: 'close',
          key: 'close',
          label: 'Close',
          onPress: () => void end(),
          testID: 'gateway-voice-close-button',
        },
      ]
    : [
        {
          accessibilityLabel: voice.state.muted
            ? 'Unmute microphone'
            : 'Mute microphone',
          active: voice.state.muted,
          glyph: 'microphone-off',
          key: 'microphone',
          label: voice.state.muted ? 'Unmute' : 'Mute',
          onPress: () => voice.setMuted(!voice.state.muted),
          testID: 'gateway-voice-mute-button',
        },
        {
          accessibilityLabel: secondaryLabel(phase),
          disabled: phase === 'transcribing' || phase === 'thinking',
          glyph:
            phase === 'speaking'
              ? 'skip'
              : phase === 'listening'
                ? 'send'
                : 'working',
          key: 'secondary',
          label: secondaryLabel(phase),
          onPress: phase === 'speaking' ? voice.skipSpeaking : voice.submitNow,
          testID: 'gateway-voice-secondary-button',
        },
        {
          accessibilityLabel: 'End voice mode',
          glyph: 'end',
          key: 'end',
          label: 'End',
          onPress: () => void end(),
          role: 'end',
          testID: 'gateway-voice-end-button',
        },
      ];

  return (
    <View className="flex-1 bg-background">
      {/* Decorative conversation glow behind the content. Voice mode is
          half-duplex, so the glow naturally follows one party at a time;
          the phase title and description remain the accessible status. */}
      <VoiceAmbientGlow
        level={voice.state.muted ? undefined : ambientLevel}
        state={voice.state.muted ? 'idle' : ambientVoiceState(phase)}
        testID="gateway-voice-ambient-glow"
      />
      <ScrollView
        className="flex-1"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerClassName="flex-grow gap-8 px-6 py-8">
        <View className="flex-1 items-center justify-center gap-8">
          <View className="w-full max-w-md">
            <VoiceStatus
              description={
                mutedWhileListening
                  ? 'The microphone is off. Unmute to keep talking.'
                  : voicePhaseDescription(phase)
              }
              title={mutedWhileListening ? 'Muted' : voicePhaseTitle(phase)}
            />
          </View>

          {voice.state.userTranscript || voice.state.assistantText.trim() ? (
            <View className="w-full max-w-md gap-6">
              {voice.state.userTranscript ? (
                <VoiceTranscript
                  muted
                  speaker="You"
                  testID="gateway-voice-user-transcript"
                  text={voice.state.userTranscript}
                />
              ) : null}
              {voice.state.assistantText.trim() ? (
                // The assistant reply stays on PanelUI's bounded `Response`
                // markdown pipeline (product contract) — like Soundwave, a
                // deliberate React Native island in the native chrome.
                <View
                  className="gap-1"
                  testID="gateway-voice-assistant-transcript">
                  <Typography.Paragraph type="small" weight="semibold">
                    Hermes
                  </Typography.Paragraph>
                  <Response isStreaming={voice.state.replyStreaming}>
                    {voice.state.assistantText.trim()}
                  </Response>
                </View>
              ) : null}
            </View>
          ) : null}

          {voice.state.prompt ? (
            <View className="w-full max-w-md">
              <PromptCard
                busy={promptBusy}
                error={promptError}
                prompt={voice.state.prompt}
                onRespond={answerPrompt}
              />
            </View>
          ) : null}

          {/* "Not set up" is a claim about the server's configuration, so it
            only renders when the probe actually answered — a failed probe
            keeps retrying through the query layer instead. */}
          {speech.data && (!canListen || !canSpeak) ? (
            <View className="w-full max-w-md">
              <VoiceNotice
                description={unavailableDescription(canListen, canSpeak)}
                testID="gateway-voice-unavailable"
                title={unavailableTitle(canListen, canSpeak)}
              />
            </View>
          ) : null}

          {voice.state.error ? (
            <View className="w-full max-w-md">
              <VoiceNotice
                destructive
                description={voice.state.error}
                testID="gateway-voice-error"
                title="Voice mode stopped"
              />
            </View>
          ) : null}
        </View>

        <View className="w-full max-w-md self-center gap-6">
          {utilityRows.length > 0 ? <VoiceActions rows={utilityRows} /> : null}
          <VoiceCallControls controls={callControls} />
        </View>
      </ScrollView>
    </View>
  );
}

function ambientVoiceState(
  phase: GatewayVoicePhase,
): 'idle' | 'listening' | 'speaking' | 'thinking' {
  if (phase === 'speaking') return 'speaking';
  if (phase === 'listening') return 'listening';
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
