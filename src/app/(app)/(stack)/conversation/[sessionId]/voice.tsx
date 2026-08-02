import { useQuery } from '@tanstack/react-query';
import { Redirect, useLocalSearchParams } from 'expo-router';

import { useWaveConnection } from '@/features/connection/connection-provider';
import {
  loadOpenAiKeyState,
  OPENAI_KEY_STATE_QUERY_KEY,
} from '@/features/realtime/openai-key-card';
import {
  KeyedRealtimeVoiceScreen,
  VoiceScreen,
} from '@/features/realtime/voice-screen';
import { GatewayVoiceScreen } from '@/features/voice/gateway-voice-screen';

export default function VoiceRoute() {
  const { sessionId } = useLocalSearchParams<{
    sessionId?: string | string[];
  }>();
  const value = Array.isArray(sessionId) ? sessionId[0] : sessionId;
  const { gatewayClient, state } = useWaveConnection();
  // Presence and preference only — never the key itself.
  const keyState = useQuery({
    enabled: Boolean(gatewayClient),
    queryFn: loadOpenAiKeyState,
    queryKey: OPENAI_KEY_STATE_QUERY_KEY,
    staleTime: Infinity,
  });

  // Voice does not degrade the way chat does: both modes need a reachable
  // backend, so an unreachable one goes back rather than opening a microphone
  // with nowhere to send it.
  if (!value) return <Redirect href="/new" />;
  if (gatewayClient) {
    if (state.phase !== 'connected') return <Redirect href="/" />;
    if (keyState.isPending) return null;
    // Mode selection (stage 4): Realtime iff a key is saved and the user has
    // not turned it off; the keyless server-side voice is the default.
    if (keyState.data?.hasKey && keyState.data.realtimeEnabled) {
      return (
        <KeyedRealtimeVoiceScreen client={gatewayClient} sessionId={value} />
      );
    }
    return (
      <GatewayVoiceScreen
        baseUrl={state.identity.baseUrl}
        client={gatewayClient}
        connectionId={state.identity.id}
        sessionId={value}
      />
    );
  }
  return <VoiceScreen sessionId={value} />;
}
