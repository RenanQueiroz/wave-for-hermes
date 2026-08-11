import { Redirect, useLocalSearchParams } from 'expo-router';

import { KeyedRealtimeVoiceScreen } from '@/features/realtime/voice-screen';
import { GatewayVoiceScreen } from '@/features/voice/gateway-voice-screen';
import { openAiKeyState } from '@/state/openai-key-state';
import { useConnectedWave } from '@/state/use-connected-wave';
import { useHydratedStore } from '@/state/use-device-state';

export default function VoiceRoute() {
  const { sessionId } = useLocalSearchParams<{
    sessionId?: string | string[];
  }>();
  const value = Array.isArray(sessionId) ? sessionId[0] : sessionId;
  const connected = useConnectedWave();
  // Presence and preference only — never the key itself.
  const keyState = useHydratedStore(openAiKeyState);

  // Voice does not degrade the way chat does: both modes need a reachable
  // backend, so an unreachable one goes back rather than opening a microphone
  // with nowhere to send it.
  if (!value) return <Redirect href="/new" />;
  if (!connected || connected.phase !== 'connected') {
    return <Redirect href="/" />;
  }
  if (!keyState.hydrated) return null;
  // Realtime is selected iff a key is saved and the user has not turned it
  // off; the keyless server-side voice is the default.
  if (keyState.hasKey && keyState.realtimeEnabled) {
    return (
      <KeyedRealtimeVoiceScreen
        client={connected.gatewayClient}
        sessionId={value}
      />
    );
  }
  return (
    <GatewayVoiceScreen
      baseUrl={connected.baseUrl}
      client={connected.gatewayClient}
      connectionId={connected.connectionId}
      sessionId={value}
    />
  );
}
