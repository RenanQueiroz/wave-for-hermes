import {
  useMutation,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';
import type { WaveSessionSummary } from '@wave/contracts';
import { usePathname, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  drawerErrorMessage,
  type DrawerSessionListItem,
} from '@/features/navigation/drawer/row-model';
import {
  waveSessionDataQueryKey,
  waveSessionQueryKey,
} from '@/features/sessions/session-query-keys';
import {
  flattenWaveSessions,
  useWaveSessions,
} from '@/features/sessions/use-wave-sessions';
import {
  setWaveSessionPinnedInPages,
  setWaveSessionUnreadInPages,
} from '@/features/sessions/session-page-cache';
import {
  organizeWaveSessions,
  type WaveSessionFilter,
} from '@/features/sessions/session-organization';
import { isOfflineLikeWaveError } from '@/services/query/offline-error';
import { activeSessionStore } from '@/services/sessions/active-session-store';
import type {
  WaveChatClient,
  WaveSessionPage,
} from '@/services/wave/wave-chat-client';

export {
  DRAWER_COPY,
  drawerErrorMessage,
  drawerReadStateAction,
  drawerRowAccessibilityLabel,
  drawerRowGlyph,
  emptySessionFilterMessage,
  SESSION_FILTERS,
  sessionTitle,
  type DrawerRowGlyph,
  type DrawerSessionListItem,
} from '@/features/navigation/drawer/row-model';

/**
 * Owns every platform-neutral drawer behavior: queries, mutations, dialog
 * state, filter/paging, and navigation. The iOS and Android files contain
 * presentation only so their SwiftUI and Compose trees can diverge without
 * duplicating product behavior. Rename keystrokes deliberately never pass
 * through here — the native field owns its draft and submits a final title.
 */
export function useWaveDrawerContent({
  baseUrl,
  client,
  closeDrawer,
  connectionId,
}: {
  baseUrl: string;
  client: WaveChatClient;
  closeDrawer(): void;
  connectionId: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const sessionsQuery = useWaveSessions({ baseUrl, client, connectionId });
  const sessions = useMemo(
    () => flattenWaveSessions(sessionsQuery.data),
    [sessionsQuery.data],
  );
  const [sessionFilter, setSessionFilter] =
    useState<WaveSessionFilter>('chats');
  const sessionListItems = useMemo<DrawerSessionListItem[]>(
    () =>
      organizeWaveSessions(sessions, sessionFilter).flatMap((section) => [
        {
          id: `section-${section.id}`,
          kind: 'section' as const,
          label: section.label,
          sectionId: section.id,
        },
        ...section.sessions.map((session) => ({
          id: `session-${session.id}`,
          kind: 'session' as const,
          session,
        })),
      ]),
    [sessionFilter, sessions],
  );
  const [localError, setLocalError] = useState<string>();
  const [renameSession, setRenameSession] = useState<WaveSessionSummary>();
  const [deleteSession, setDeleteSession] = useState<WaveSessionSummary>();
  const sessionsKey = waveSessionQueryKey(connectionId, baseUrl);

  const renameMutation = useMutation({
    mutationFn: ({ sessionId, title }: { sessionId: string; title: string }) =>
      client.updateSession(sessionId, { title }),
    onSuccess: () => {
      setRenameSession(undefined);
      void queryClient.invalidateQueries({ queryKey: sessionsKey });
    },
  });
  const deleteMutation = useMutation({
    mutationFn: (sessionId: string) => client.deleteSession(sessionId),
    onSuccess: async (result) => {
      // The dialog close and the navigation away from the deleted session
      // must not wait on the list refetch or fail on a store error.
      const activeSessionId = await activeSessionStore
        .load(connectionId)
        .catch(() => undefined);
      if (activeSessionId === result.sessionId) {
        await activeSessionStore.clear().catch(() => undefined);
      }
      queryClient.removeQueries({
        queryKey: waveSessionDataQueryKey(
          connectionId,
          baseUrl,
          result.sessionId,
        ),
      });
      setDeleteSession(undefined);
      void queryClient.invalidateQueries({ queryKey: sessionsKey });
      if (pathname.includes(result.sessionId)) {
        closeDrawer();
        router.replace('/new');
      }
    },
  });
  const pinMutation = useMutation({
    mutationFn: ({
      pinned,
      sessionId,
    }: {
      pinned: boolean;
      sessionId: string;
    }) => client.setSessionPinned(sessionId, pinned),
    onMutate: async ({ pinned, sessionId }) => {
      await queryClient.cancelQueries({ queryKey: sessionsKey });
      const previous =
        queryClient.getQueryData<InfiniteData<WaveSessionPage>>(sessionsKey);
      queryClient.setQueryData<InfiniteData<WaveSessionPage>>(
        sessionsKey,
        (current) => setWaveSessionPinnedInPages(current, sessionId, pinned),
      );
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(sessionsKey, context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: sessionsKey });
    },
  });
  const pinningSessionId = pinMutation.isPending
    ? pinMutation.variables?.sessionId
    : undefined;
  const mutatePin = pinMutation.mutate;
  const toggleSessionPin = useCallback(
    (session: WaveSessionSummary) =>
      mutatePin({ pinned: !session.pinned, sessionId: session.id }),
    [mutatePin],
  );
  // Read state is the same ambiguous metadata PATCH as pinning: project it
  // optimistically, send it once, roll back on failure, reconcile from the
  // server either way.
  const unreadMutation = useMutation({
    mutationFn: ({
      sessionId,
      unread,
    }: {
      sessionId: string;
      unread: boolean;
    }) => client.setSessionUnread(sessionId, unread),
    onMutate: async ({ sessionId, unread }) => {
      await queryClient.cancelQueries({ queryKey: sessionsKey });
      const previous =
        queryClient.getQueryData<InfiniteData<WaveSessionPage>>(sessionsKey);
      queryClient.setQueryData<InfiniteData<WaveSessionPage>>(
        sessionsKey,
        (current) => setWaveSessionUnreadInPages(current, sessionId, unread),
      );
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(sessionsKey, context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: sessionsKey });
    },
  });
  const mutateUnread = unreadMutation.mutate;
  const toggleSessionUnread = useCallback(
    (session: WaveSessionSummary) =>
      mutateUnread({ sessionId: session.id, unread: !session.unread }),
    [mutateUnread],
  );
  const navigate = useCallback(
    (target: '/new' | '/search' | '/settings') => {
      closeDrawer();
      // Utility routes live in the parent native stack; conversation routes
      // remain in this drawer's nested chat stack. Public paths stay flat.
      if (target === '/new') router.replace(target);
      else router.navigate(target);
    },
    [closeDrawer, router],
  );
  const openSession = useCallback(
    async (sessionId: string) => {
      try {
        setLocalError(undefined);
        await activeSessionStore.save(connectionId, sessionId);
        closeDrawer();
        router.replace({
          pathname: '/conversation/[sessionId]',
          params: { sessionId },
        });
      } catch {
        setLocalError('Wave could not open that conversation.');
      }
    },
    [closeDrawer, connectionId, router],
  );
  // A page can contain only sources outside the selected filter. Keep paging
  // an actually empty filtered list so an older matching conversation cannot
  // become unreachable just because no row exists to trigger onEndReached.
  useEffect(() => {
    if (
      sessionListItems.length === 0 &&
      sessionsQuery.hasNextPage &&
      !sessionsQuery.isFetchingNextPage
    ) {
      void sessionsQuery.fetchNextPage();
    }
  }, [sessionListItems.length, sessionsQuery]);

  const mutationError =
    renameMutation.error ??
    deleteMutation.error ??
    pinMutation.error ??
    unreadMutation.error;
  const errorMessage =
    localError ??
    (mutationError ? drawerErrorMessage(mutationError) : undefined);
  const showingCachedSessions =
    sessions.length > 0 && isOfflineLikeWaveError(sessionsQuery.error);

  const confirmRename = useCallback(
    (title: string) => {
      const trimmed = title.trim();
      if (!renameSession || !trimmed || renameMutation.isPending) return;
      renameMutation.mutate({ sessionId: renameSession.id, title: trimmed });
    },
    [renameMutation, renameSession],
  );
  const confirmDelete = useCallback(() => {
    if (!deleteSession || deleteMutation.isPending) return;
    deleteMutation.mutate(deleteSession.id);
  }, [deleteMutation, deleteSession]);

  return {
    cancelDelete: useCallback(() => {
      if (!deleteMutation.isPending) setDeleteSession(undefined);
    }, [deleteMutation.isPending]),
    cancelRename: useCallback(() => {
      if (!renameMutation.isPending) setRenameSession(undefined);
    }, [renameMutation.isPending]),
    confirmDelete,
    confirmRename,
    deletePending: deleteMutation.isPending,
    deleteSession,
    errorMessage,
    fetchNextPage: () => {
      if (sessionsQuery.hasNextPage && !sessionsQuery.isFetchingNextPage) {
        void sessionsQuery.fetchNextPage();
      }
    },
    isPending: sessionsQuery.isPending,
    isRefetching: sessionsQuery.isRefetching,
    navigate,
    openSession,
    pathname,
    pinningSessionId,
    refetch: () => void sessionsQuery.refetch(),
    renamePending: renameMutation.isPending,
    renameSession,
    sessionFilter,
    sessionListItems,
    setSessionFilter,
    showingCachedSessions,
    startDelete: setDeleteSession,
    startRename: setRenameSession,
    toggleSessionPin,
    toggleSessionUnread,
  };
}
