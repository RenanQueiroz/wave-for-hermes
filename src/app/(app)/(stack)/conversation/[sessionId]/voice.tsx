import { Redirect, useLocalSearchParams } from 'expo-router';

import { useWaveConnection } from '@/features/connection/connection-provider';
import { KeyedRealtimeVoiceScreen } from '@/features/realtime/voice-screen';
import { GatewayVoiceScreen } from '@/features/voice/gateway-voice-screen';
import { openAiKeyState } from '@/state/openai-key-state';
import { useHydratedStore } from '@/state/use-device-state';

export default function VoiceRoute() {
  const { sessionId } = useLocalSearchParams<{
    sessionId?: string | string[];
  }>();
  const value = Array.isArray(sessionId) ? sessionId[0] : sessionId;
  const { gatewayClient, state } = useWaveConnection();
  // Presence and preference only — never the key itself.
  const keyState = useHydratedStore(openAiKeyState);

  // Voice does not degrade the way chat does: both modes need a reachable
  // backend, so an unreachable one goes back rather than opening a microphone
  // with nowhere to send it.
  if (!value) return <Redirect href="/new" />;
  if (!gatewayClient || state.phase !== 'connected') {
    return <Redirect href="/" />;
  }
  if (!keyState.hydrated) return null;
  // Realtime is selected iff a key is saved and the user has not turned it
  // off; the keyless server-side voice is the default.
  if (keyState.hasKey && keyState.realtimeEnabled) {
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
