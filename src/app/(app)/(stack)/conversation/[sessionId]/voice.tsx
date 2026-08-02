import { Redirect, useLocalSearchParams } from 'expo-router';

import { useWaveConnection } from '@/features/connection/connection-provider';
import { VoiceScreen } from '@/features/realtime/voice-screen';
import { GatewayVoiceScreen } from '@/features/voice/gateway-voice-screen';

export default function VoiceRoute() {
  const { sessionId } = useLocalSearchParams<{
    sessionId?: string | string[];
  }>();
  const value = Array.isArray(sessionId) ? sessionId[0] : sessionId;
  const { gatewayClient, state } = useWaveConnection();

  // Voice does not degrade the way chat does: both modes need a reachable
  // backend, so an unreachable one goes back rather than opening a microphone
  // with nowhere to send it.
  if (!value) return <Redirect href="/new" />;
  if (gatewayClient) {
    if (state.phase !== 'connected') return <Redirect href="/" />;
    return (
      <GatewayVoiceScreen
        baseUrl={state.identity.baseUrl}
        client={gatewayClient}
        connectionId={state.identity.id}
        sessionId={value}
      />
    );
  }
  // Realtime stays the companion's voice mode until the user-owned OpenAI key
  // lands (stage 4 of the gateway migration).
  return <VoiceScreen sessionId={value} />;
}
