import { useLocalSearchParams } from 'expo-router';

import { VoiceScreen } from '@/features/realtime/voice-screen';

export default function VoiceRoute() {
  const { sessionId } = useLocalSearchParams<{
    sessionId?: string | string[];
  }>();
  const value = Array.isArray(sessionId) ? sessionId[0] : sessionId;
  return <VoiceScreen sessionId={value ?? ''} />;
}
