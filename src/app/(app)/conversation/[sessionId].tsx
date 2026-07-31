import { useLocalSearchParams } from 'expo-router';

import { ChatScreen } from '@/features/chat/chat-screen';

export default function ChatRoute() {
  const { sessionId } = useLocalSearchParams<{
    sessionId?: string | string[];
  }>();
  const value = Array.isArray(sessionId)
    ? sessionId[0]
    : sessionId;
  return <ChatScreen sessionId={value ?? ''} />;
}
