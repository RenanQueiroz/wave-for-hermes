import { useRouter } from 'expo-router';
import { useCallback, useMemo } from 'react';

import { ActiveSessionStore } from '@/services/sessions/active-session-store';

export function useReturnToActiveConversation(connectionId: string) {
  const router = useRouter();
  const activeSessionStore = useMemo(() => new ActiveSessionStore(), []);

  return useCallback(() => {
    void activeSessionStore
      .load(connectionId)
      .then((sessionId) => {
        if (!sessionId) {
          router.replace('/new');
          return;
        }
        router.replace({
          pathname: '/conversation/[sessionId]',
          params: { sessionId },
        });
      })
      .catch(() => router.replace('/new'));
  }, [activeSessionStore, connectionId, router]);
}
