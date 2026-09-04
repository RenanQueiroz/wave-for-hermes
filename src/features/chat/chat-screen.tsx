import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';
import type { WaveTimelineResponse, WaveToolDetail } from '@wave/contracts';
import {
  Redirect,
  Stack,
  useFocusEffect,
  useNavigation,
  useRouter,
} from 'expo-router';
import {
  Alert,
  AlertTriangleIcon,
  Button,
  CheckCircleIcon,
  ChevronRightIcon,
  FileIcon,
  LinkIcon,
  Marker,
  Message,
  PencilIcon,
  Reasoning,
  Response,
  // RotateCcwIcon deliberately: the package's runtime entry exports only the
  // counter-clockwise variant even though the typings declare both.
  RotateCcwIcon,
  SearchIcon,
  Shimmer,
  SparklesIcon,
  Typography,
} from 'panelui-native';
// Deep import: Expo Router 57 vendors React Navigation, so the header-height
// context the native stack actually provides has no public package to import
// from; an expo-router upgrade that moves it fails loudly at typecheck.
import { HeaderHeightContext } from 'expo-router/build/react-navigation/elements';
import {
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Animated, Platform, Pressable, View } from 'react-native';
import { useKeyboardAnimation } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCSSVariable } from 'uniwind';

import { ConversationScroller } from '@/components/conversation-scroller';
import { OfflineNotice } from '@/components/offline-notice';
import { PromptCard, type PromptCardResponse } from '@/components/prompt-card';
import { promptResponseInput } from '@/features/chat/prompt-response';
import { registerMobileAgentStateProvider } from '@/dev/mobile-agent-state';
import {
  isWaveChatActivityStale,
  timelineToWaveChatMessages,
  waveChatActivityLabel,
  WAVE_CHAT_ACTIVITY_STALE_MS,
  type WaveChatMessage,
  type WaveChatPart,
} from '@/features/chat/chat-state';
import { ChatComposer } from '@/features/chat/composer';
import { composerKeyboardBottomInset } from '@/features/chat/composer/dock';
import {
  deriveToolAction,
  formatToolName,
  toolActionLabel,
} from '@/features/chat/tool-actions';
import { ToolDetailSheet } from '@/features/chat/tool-detail-sheet';
import type { WaveToolCallDetail } from '@/features/chat/tool-detail-sheet.shared';
import {
  branchCount,
  collectPrunedEntryIds,
  rebindTimelineSurvivors,
  regenerateTarget,
} from '@/features/chat/turn-action-targets';
import { TurnActionRow } from '@/features/chat/turn-action-row';
import { useWaveChat } from '@/features/chat/use-wave-chat';
import { useConnectedWave } from '@/state/use-connected-wave';
import { useMessagePlayback } from '@/features/voice/use-message-playback';
import { refreshWaveSessionTimeline } from '@/features/sessions/refresh-session-timeline';
import {
  addWaveCorrectionJournalEntry,
  getWaveCorrectionJournal,
  mergeWaveCorrectionsIntoTimeline,
  mergeWaveCorrectionsIntoTimelineEntries,
} from '@/features/sessions/session-correction-journal';
import {
  flattenWaveSessions,
  useWaveSessions,
} from '@/features/sessions/use-wave-sessions';
import {
  setWaveSessionTitleInPages,
  setWaveSessionUnreadInPages,
  waveSessionUnreadInPages,
} from '@/features/sessions/session-page-cache';
import {
  waveSessionQueryKey,
  waveTimelineQueryKey,
} from '@/features/sessions/session-query-keys';
import { turnErrorTitle } from '@/features/chat/turn-error-copy.ts';
import { TurnTasks } from '@/features/chat/turn-tasks.tsx';
import { isOfflineLikeWaveError } from '@/services/query/offline-error';
import { activeSessionStore } from '@/services/sessions/active-session-store';
import { WaveBackendError } from '@/services/wave/wave-backend-error';
import type { GatewayClient } from '@/services/gateway/gateway-client';
import {
  isPendingSessionId,
  type WaveChatClient,
  type WaveSessionPage,
} from '@/services/wave/wave-chat-client';

interface ChatScreenProps {
  sessionId: string;
}

const EMPTY_STATE_TITLES = [
  'Ask me anything',
  'How can I help?',
  "What's on your mind?",
  'What can Hermes help with?',
] as const;

function emptyStateTitleForSession(sessionId: string) {
  const hash = Array.from(sessionId).reduce(
    (value, character) => (value * 31 + character.charCodeAt(0)) >>> 0,
    0,
  );
  return EMPTY_STATE_TITLES[hash % EMPTY_STATE_TITLES.length];
}

export function ChatScreen({ sessionId }: ChatScreenProps) {
  const connected = useConnectedWave();

  if (!connected || !sessionId) {
    return <Redirect href={sessionId ? '/' : '/new'} />;
  }
  return (
    <ConnectedChatScreen
      baseUrl={connected.baseUrl}
      client={connected.client}
      connectionId={connected.connectionId}
      gatewayClient={connected.gatewayClient}
      offline={connected.phase === 'offline'}
      sessionId={sessionId}
    />
  );
}

function ConnectedChatScreen({
  baseUrl,
  client,
  connectionId,
  gatewayClient,
  offline,
  sessionId,
}: {
  baseUrl: string;
  client: WaveChatClient;
  connectionId: string;
  gatewayClient?: GatewayClient;
  offline: boolean;
  sessionId: string;
}) {
  const router = useRouter();
  const navigation = useNavigation();
  const drawerNavigation = navigation.getParent();
  const insets = useSafeAreaInsets();
  const [composerBottomOffset, setComposerBottomOffset] = useState(0);
  const [composerRestingOffset, setComposerRestingOffset] = useState(0);
  const [liveSessionTitle, setLiveSessionTitle] = useState<{
    routeSessionId: string;
    storedSessionId: string;
    title: string;
  }>();
  const queryClient = useQueryClient();
  const transcriptBottomPadding = Math.max(composerBottomOffset + 12, 12);

  // Speech affordances appear only when the gateway advertises the
  // capability; a failed probe hides them rather than caching a "no".
  const speech = useQuery({
    enabled: Boolean(gatewayClient),
    queryFn: ({ signal }) =>
      gatewayClient?.getAudioCapabilities(signal) ?? {
        stt: false,
        tts: false,
      },
    queryKey: ['wave', connectionId, baseUrl, 'audio-capabilities'],
    staleTime: 5 * 60_000,
  });
  const playback = useMessagePlayback({ client: gatewayClient });
  const canDictate = Boolean(gatewayClient) && speech.data?.stt === true;
  const canSpeak = Boolean(gatewayClient) && speech.data?.tts === true;
  const timelineKey = useMemo(
    () => waveTimelineQueryKey(connectionId, baseUrl, sessionId),
    [baseUrl, connectionId, sessionId],
  );
  const loadTimelinePage = useCallback(
    async (before: string | undefined, signal: AbortSignal) => {
      const page = await client.getSessionTimeline(
        sessionId,
        {
          ...(before ? { before } : {}),
          limit: 100,
        },
        signal,
      );
      return mergeWaveCorrectionsIntoTimeline(
        page,
        getWaveCorrectionJournal(queryClient, connectionId, baseUrl, sessionId),
      );
    },
    [baseUrl, client, connectionId, queryClient, sessionId],
  );
  const timeline = useInfiniteQuery<
    WaveTimelineResponse,
    WaveBackendError,
    InfiniteData<WaveTimelineResponse, string | undefined>,
    ReturnType<typeof waveTimelineQueryKey>,
    string | undefined
  >({
    getNextPageParam: (page) => (page.hasMore ? page.nextCursor : undefined),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => loadTimelinePage(pageParam, signal),
    queryKey: timelineKey,
  });
  // Reading a conversation clears its server-owned unread watermark: once per
  // newer activity the cached list reports, projected optimistically, sent
  // exactly once, rolled back on failure, and left to the next list refresh
  // to reconcile. Subscribing to the list cache (without fetching it) is what
  // lets a reply that lands while this screen is open clear itself too.
  const sessionsKey = useMemo(
    () => waveSessionQueryKey(connectionId, baseUrl),
    [baseUrl, connectionId],
  );
  const sessionList = useWaveSessions({
    baseUrl,
    client,
    connectionId,
    enabled: false,
  });
  const unreadRow = waveSessionUnreadInPages(sessionList.data, sessionId);
  const unreadClearedRef = useRef<string | undefined>(undefined);
  const unreadActivityKey = unreadRow?.unread
    ? `${sessionId}:${unreadRow.lastActiveAt ?? ''}`
    : undefined;
  useEffect(() => {
    if (!unreadActivityKey || unreadClearedRef.current === unreadActivityKey) {
      return;
    }
    unreadClearedRef.current = unreadActivityKey;
    queryClient.setQueryData<InfiniteData<WaveSessionPage>>(
      sessionsKey,
      (data) => setWaveSessionUnreadInPages(data, sessionId, false) ?? data,
    );
    client.setSessionUnread(sessionId, false).catch(() => {
      queryClient.setQueryData<InfiniteData<WaveSessionPage>>(
        sessionsKey,
        (data) => setWaveSessionUnreadInPages(data, sessionId, true) ?? data,
      );
    });
  }, [client, queryClient, sessionId, sessionsKey, unreadActivityKey]);
  const reconcileTimeline = useCallback(async () => {
    const result = await refreshWaveSessionTimeline({
      baseUrl,
      connectionId,
      load: loadTimelinePage,
      queryClient,
      sessionId,
    });
    await queryClient.invalidateQueries({
      queryKey: waveSessionQueryKey(connectionId, baseUrl),
    });
    return result;
  }, [baseUrl, connectionId, loadTimelinePage, queryClient, sessionId]);
  const getCorrectionAnchor = useCallback(() => {
    const entries = [...(timeline.data?.pages ?? [])]
      .reverse()
      .flatMap((page) => page.entries);
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index];
      if (entry.type === 'message' && entry.message.role === 'user') {
        return entry.message.content.trim() || undefined;
      }
    }
    return undefined;
  }, [timeline.data?.pages]);
  const persistCorrection = useCallback(
    (entry: {
      anchorText: string;
      createdAt: string;
      id: string;
      sessionId: string;
      text: string;
    }) => {
      const { sessionId: correctionSessionId, ...journalEntry } = entry;
      addWaveCorrectionJournalEntry(queryClient, {
        baseUrl,
        connectionId,
        entry: journalEntry,
        sessionId: correctionSessionId,
      });
    },
    [baseUrl, connectionId, queryClient],
  );
  const onSessionTitle = useCallback(
    (storedSessionId: string, title: string) => {
      // The first title can arrive while this screen is still addressed by
      // its pending placeholder. Keep both identities so the same title
      // survives Expo Router replacing the route with the durable id.
      setLiveSessionTitle({
        routeSessionId: sessionId,
        storedSessionId,
        title,
      });
      queryClient.setQueryData<InfiniteData<WaveSessionPage>>(
        waveSessionQueryKey(connectionId, baseUrl),
        (data) =>
          setWaveSessionTitleInPages(data, storedSessionId, title) ?? data,
      );
    },
    [baseUrl, connectionId, queryClient, sessionId],
  );
  const chat = useWaveChat({
    client,
    getCorrectionAnchor,
    onSessionTitle,
    persistCorrection,
    reconcileTimeline,
    sessionId,
  });
  const { resume } = chat;

  // A turn this device started may still be running server-side after a
  // backgrounding, a navigation away, or an app restart. Ask the gateway
  // and reattach to it instead of leaving it invisible; the probe is
  // best-effort and silent when it cannot be answered.
  useEffect(() => {
    let cancelled = false;
    void client
      .getActiveTurn(sessionId)
      .then((response) => {
        if (cancelled || !response.activeTurn) return;
        void resume(response.activeTurn.turnId, {
          ...(response.lastActiveAt
            ? { lastActivityAt: response.lastActiveAt }
            : {}),
          liveStatus: response.liveStatus ?? 'working',
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [client, resume, sessionId]);

  useEffect(() => {
    if (!__DEV__) return;
    return registerMobileAgentStateProvider({
      name: 'wave-chat',
      read: () => ({
        activity: chat.state.activity ?? 'none',
        correction: chat.state.correction
          ? 'sending'
          : chat.state.correctionError
            ? 'error'
            : 'idle',
        liveStatus: chat.state.liveStatus,
        sessionId,
        status: chat.state.status,
      }),
    });
  }, [
    chat.state.correction,
    chat.state.correctionError,
    chat.state.activity,
    chat.state.liveStatus,
    chat.state.status,
    sessionId,
  ]);

  useEffect(() => {
    void activeSessionStore
      .save(connectionId, sessionId)
      .catch(() => undefined);
  }, [connectionId, sessionId]);

  const sessionNotFound =
    timeline.error instanceof WaveBackendError &&
    timeline.error.kind === 'not_found';

  // Only the focused screen may leave a deleted conversation. This screen can
  // stay mounted under the drawer after navigating away, and a background
  // redirect here would steal navigation from the destination screen.
  useFocusEffect(
    useCallback(() => {
      if (!sessionNotFound) return;
      let cancelled = false;
      void (async () => {
        const activeSessionId = await activeSessionStore
          .load(connectionId)
          .catch(() => undefined);
        if (activeSessionId === sessionId) {
          await activeSessionStore.clear().catch(() => undefined);
        }
        void queryClient.invalidateQueries({
          queryKey: waveSessionQueryKey(connectionId, baseUrl),
        });
        if (!cancelled) {
          router.replace('/new');
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [
      baseUrl,
      connectionId,
      queryClient,
      router,
      sessionId,
      sessionNotFound,
    ]),
  );

  const timelineEntries = useMemo(() => {
    const entries = [...(timeline.data?.pages ?? [])]
      .reverse()
      .flatMap((page) => page.entries);
    return mergeWaveCorrectionsIntoTimelineEntries(
      entries,
      getWaveCorrectionJournal(queryClient, connectionId, baseUrl, sessionId),
    );
  }, [baseUrl, connectionId, queryClient, sessionId, timeline.data?.pages]);
  const timelineMessages = useMemo(
    () => timelineToWaveChatMessages(timelineEntries),
    [timelineEntries],
  );
  // Oldest first: LegendList chats are not inverted — the list aligns its
  // content to the end and keeps itself pinned there instead.
  const messages = useMemo(
    () => [...timelineMessages, ...chat.state.messages],
    [chat.state.messages, timelineMessages],
  );
  // The empty state centers on the area the keyboard leaves visible: its
  // overlay is anchored to the composer's resting footprint, and the docked
  // composer travels up by the keyboard height minus the dock's bottom inset,
  // so shifting the centered copy by half of that travel keeps it centered
  // between the header and the raised composer. `height` animates
  // 0 → -keyboardHeight; the -0.5 slope past the inset is that half-travel.
  const { height: animatedKeyboardHeight } = useKeyboardAnimation();
  const keyboardBottomInset = composerKeyboardBottomInset(insets.bottom);
  // iOS chat content underlaps the transparent native header, so the
  // overlay's centering space starts at the header's bottom edge. Android's
  // Material header is opaque and the chat area already begins below it —
  // and its context value would be the drawer header's height, not an
  // overlap — so the overlay keeps the area's own top edge there.
  const headerHeight = useContext(HeaderHeightContext) ?? 0;
  const emptyStateTopInset = Platform.OS === 'ios' ? headerHeight : 0;
  const emptyStateShift = useMemo(
    () =>
      animatedKeyboardHeight.interpolate({
        inputRange: [-keyboardBottomInset - 1, -keyboardBottomInset],
        outputRange: [-0.5, 0],
        extrapolateRight: 'clamp',
      }),
    [animatedKeyboardHeight, keyboardBottomInset],
  );
  const emptyStateTitle = useMemo(
    () => emptyStateTitleForSession(sessionId),
    [sessionId],
  );
  // A pending id is a chat the user just started on this phone; a stored id
  // with an empty timeline is an existing Hermes conversation that has no
  // messages Wave can show. The two must not present identically.
  const pendingSession = isPendingSessionId(sessionId);
  // The native header shows the conversation's Hermes title, resolved from the
  // sessions list the drawer already caches.
  const sessions = useWaveSessions({ baseUrl, client, connectionId });
  const headerTitle = useMemo(() => {
    if (
      liveSessionTitle &&
      (liveSessionTitle.routeSessionId === sessionId ||
        liveSessionTitle.storedSessionId === sessionId)
    ) {
      return liveSessionTitle.title;
    }
    const summary = flattenWaveSessions(sessions.data).find(
      (session) => session.id === sessionId,
    );
    if (summary?.title) return summary.title;
    if (timeline.isPending) return undefined;
    return pendingSession && messages.length === 0
      ? 'New chat'
      : 'Untitled chat';
  }, [
    messages.length,
    liveSessionTitle,
    pendingSession,
    sessionId,
    sessions.data,
    timeline.isPending,
  ]);
  useEffect(() => {
    drawerNavigation?.setOptions({ title: headerTitle ?? '' });

    return () => {
      drawerNavigation?.setOptions({ title: '' });
    };
  }, [drawerNavigation, headerTitle]);
  const busy =
    chat.state.status === 'submitting' ||
    chat.state.status === 'streaming' ||
    chat.state.status === 'cancelling';
  const correcting = Boolean(chat.state.correction);
  const cancelling = chat.state.status === 'cancelling';
  // Dispatching a turn or starting voice needs a reachable gateway and the
  // conversation's current state. While either is missing the composer stays
  // readable but cannot send; typing is still allowed so drafts survive.
  const composerBlocked = offline || Boolean(timeline.error);
  const activeAssistantId = chat.state.messages.findLast(
    (message) => message.role === 'assistant',
  )?.id;

  const [activityNow, setActivityNow] = useState(() => Date.now());
  useEffect(() => {
    if (chat.state.liveStatus !== 'working' || !chat.state.lastActivityAt) {
      return;
    }
    const lastActivityAt = Date.parse(chat.state.lastActivityAt);
    if (!Number.isFinite(lastActivityAt)) return;
    const delay = Math.max(
      0,
      lastActivityAt + WAVE_CHAT_ACTIVITY_STALE_MS - Date.now(),
    );
    const timer = setTimeout(
      () => setActivityNow(Date.now()),
      Math.min(delay + 50, WAVE_CHAT_ACTIVITY_STALE_MS),
    );
    return () => clearTimeout(timer);
  }, [chat.state.lastActivityAt, chat.state.liveStatus]);
  const activityLabel = isWaveChatActivityStale(chat.state, activityNow)
    ? 'Still working — no new activity yet'
    : waveChatActivityLabel(chat.state);

  // Mid-turn prompt responses go to the gateway client directly: prompts are
  // a gateway-only capability, and the response must reach the streaming
  // turn's own socket. Busy/error state is stamped with the prompt it belongs
  // to, so a new prompt starts clean without any effect-driven reset.
  const [promptStatus, setPromptStatus] = useState<{
    busy: boolean;
    error?: string;
    promptId?: string;
  }>({ busy: false });
  const activePromptId = chat.state.activePrompt?.promptId;
  const promptBusy =
    promptStatus.promptId === activePromptId && promptStatus.busy;
  const promptError =
    promptStatus.promptId === activePromptId ? promptStatus.error : undefined;
  const respondToPrompt = useCallback(
    (response: PromptCardResponse) => {
      const prompt = chat.state.activePrompt;
      if (!prompt || !gatewayClient) return;
      const input = promptResponseInput(prompt, response);
      if (!input) return;
      setPromptStatus({ busy: true, promptId: prompt.promptId });
      void gatewayClient
        .respondToPrompt(sessionId, input)
        .catch((error: unknown) => {
          setPromptStatus({
            busy: false,
            error:
              error instanceof WaveBackendError
                ? error.message
                : 'Wave could not deliver that answer.',
            promptId: prompt.promptId,
          });
        });
    },
    [chat.state.activePrompt, gatewayClient, sessionId],
  );

  const [turnActionError, setTurnActionError] = useState<string>();

  // A tapped tool Marker presents this call's bounded input/output in the
  // native detail sheet; the row snapshot is captured at press time.
  const [toolDetail, setToolDetail] = useState<WaveToolCallDetail>();
  const dismissToolDetail = useCallback(() => setToolDetail(undefined), []);

  // Branch: copy this conversation (up to the tapped turn) into a new chat
  // and open it. One non-retrying call; the drawer list refetch reconciles.
  const branchTurn = useCallback(
    (messageId: string) => {
      if (!gatewayClient || busy || composerBlocked) return;
      setTurnActionError(undefined);
      const count = branchCount(timelineEntries, messageId);
      void (async () => {
        try {
          const branched = await gatewayClient.branchSession(
            sessionId,
            count !== undefined ? { count } : {},
          );
          await queryClient.invalidateQueries({
            queryKey: waveSessionQueryKey(connectionId, baseUrl),
          });
          await activeSessionStore
            .save(connectionId, branched.sessionId)
            .catch(() => undefined);
          router.replace({
            pathname: '/conversation/[sessionId]',
            params: { sessionId: branched.sessionId },
          });
        } catch (error) {
          setTurnActionError(
            error instanceof Error && error.message
              ? error.message
              : 'Hermes could not branch this chat.',
          );
        }
      })();
    },
    [
      baseUrl,
      busy,
      composerBlocked,
      connectionId,
      gatewayClient,
      queryClient,
      router,
      sessionId,
      timelineEntries,
    ],
  );

  // Refresh: replay the nearest previous user message with the gateway's
  // truncate-and-replay submit. The pruned cache rows come back from the
  // authoritative refetch if the gateway refuses the ordinal.
  const regenerateTurn = useCallback(
    (messageId: string) => {
      if (busy || composerBlocked) return;
      setTurnActionError(undefined);
      const target = regenerateTarget(timelineEntries, messageId);
      if (!target) {
        setTurnActionError(
          'This conversation changed — try again in a moment.',
        );
        return;
      }
      const pruned = collectPrunedEntryIds(timelineEntries, target.entryId);
      queryClient.setQueryData<InfiniteData<WaveTimelineResponse>>(
        timelineKey,
        (data) =>
          data
            ? {
                ...data,
                pages: data.pages.map((page) => ({
                  ...page,
                  entries: page.entries.filter(
                    (entry) => !pruned.has(entry.id),
                  ),
                })),
              }
            : data,
      );
      void chat.send(target.text, target.text, {
        onTruncationCommitted: (survivors) => {
          queryClient.setQueryData<InfiniteData<WaveTimelineResponse>>(
            timelineKey,
            (data) => {
              if (!data) return data;
              const displayOrdered = [...data.pages]
                .reverse()
                .flatMap((page) => page.entries);
              const rebound = rebindTimelineSurvivors(
                displayOrdered,
                survivors,
              );
              const byId = new Map(rebound.map((entry) => [entry.id, entry]));
              return {
                ...data,
                pages: data.pages.map((page) => ({
                  ...page,
                  entries: page.entries.map(
                    (entry) => byId.get(entry.id) ?? entry,
                  ),
                })),
              };
            },
          );
        },
        // Every durable id currently on screen, so a v0.21 gateway can map
        // each one to its post-rewrite identity instead of Wave guessing the
        // alignment from a paged transcript.
        rebindRowIds: timelineEntries.flatMap((entry) =>
          entry.type === 'message' && typeof entry.rowId === 'number'
            ? [entry.rowId]
            : [],
        ),
        truncateBeforeUserOrdinal: target.ordinal,
        ...(target.rowId === undefined
          ? {}
          : { truncateBeforeRowId: target.rowId }),
      });
    },
    [busy, chat, composerBlocked, queryClient, timelineEntries, timelineKey],
  );

  const renderItem = useCallback(
    ({ item }: { item: WaveChatMessage }) => (
      <ChatTurn
        busy={busy}
        isStreaming={
          busy && item.role === 'assistant' && item.id === activeAssistantId
        }
        message={item}
        playbackStatus={
          playback.state.messageId === item.id ? playback.state.status : 'idle'
        }
        onBranch={gatewayClient ? branchTurn : undefined}
        onPlay={canSpeak ? playback.play : undefined}
        onRegenerate={regenerateTurn}
        onShowToolDetail={setToolDetail}
      />
    ),
    [
      activeAssistantId,
      branchTurn,
      busy,
      canSpeak,
      gatewayClient,
      playback.play,
      playback.state.messageId,
      playback.state.status,
      regenerateTurn,
    ],
  );

  // Legend List re-renders a row only when its key, its item, or `extraData`
  // changes — a fresh `renderItem` closure alone is invisible to it. Every row
  // input that lives outside the message itself has to travel through here.
  const rowExtraData = useMemo(
    () => ({
      activeAssistantId,
      branchTurn,
      busy,
      canSpeak,
      hasGateway: Boolean(gatewayClient),
      playbackMessageId: playback.state.messageId,
      playbackStatus: playback.state.status,
      regenerateTurn,
    }),
    [
      activeAssistantId,
      branchTurn,
      busy,
      canSpeak,
      gatewayClient,
      regenerateTurn,
      playback.state.messageId,
      playback.state.status,
    ],
  );

  return (
    <View className="flex-1 bg-background">
      {headerTitle ? <Stack.Screen options={{ title: headerTitle }} /> : null}
      {timeline.error &&
      messages.length > 0 &&
      isOfflineLikeWaveError(timeline.error) ? (
        <OfflineNotice
          label="Offline — showing this conversation from cache"
          testID="chat-offline-notice"
        />
      ) : timeline.error ? (
        // Padding lives on the wrapper: the Alert is w-full, so horizontal
        // margins on it would push it past the screen edge.
        <View className="px-4 pt-3">
          <Alert variant="destructive" testID="chat-history-error">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>Conversation unavailable</Alert.Title>
              <Alert.Description>
                Wave could not refresh this conversation.
              </Alert.Description>
              <Button
                size="sm"
                variant="outline"
                className="mt-2 self-start"
                accessibilityLabel="Retry loading this conversation"
                loading={timeline.isRefetching}
                startContent={<RotateCcwIcon size={14} />}
                testID="chat-history-retry"
                onPress={() => void timeline.refetch()}>
                Try again
              </Button>
            </Alert.Content>
          </Alert>
        </View>
      ) : null}

      {chat.state.todos && chat.state.todos.items.length > 0 ? (
        <View className="px-4 pt-3">
          <TurnTasks todos={chat.state.todos.items} />
        </View>
      ) : null}

      {chat.state.error ? (
        <View className="px-4 pt-3">
          <Alert variant="destructive" testID="chat-turn-error">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>
                {turnErrorTitle(chat.state.error.layer)}
              </Alert.Title>
              <Alert.Description>{chat.state.error.message}</Alert.Description>
            </Alert.Content>
          </Alert>
        </View>
      ) : null}

      <View className="flex-1">
        <ConversationScroller
          key={`conversation-scroller-${sessionId}`}
          // Turns hold disclosure state (open Tasks), which recycled rows
          // would carry between messages — so no recycling; the draw buffer
          // covers fast flings instead.
          recycleItems={false}
          drawDistance={500}
          bottomObscuredInset={composerBottomOffset}
          contentContainerClassName={messages.length > 0 ? 'px-4 pt-3' : 'px-4'}
          contentContainerStyle={{
            paddingBottom: messages.length > 0 ? transcriptBottomPadding : 0,
          }}
          contentInsetAdjustmentBehavior="automatic"
          data={messages}
          extraData={rowExtraData}
          ItemSeparatorComponent={ChatTurnSeparator}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          jumpButtonBottomOffset={composerBottomOffset + 12}
          keyExtractor={(message) => message.id}
          ListFooterComponent={
            chat.state.status === 'submitting' ? (
              <Thinking label={activityLabel ?? 'Working…'} />
            ) : null
          }
          ListHeaderComponent={
            timeline.isPending || timeline.isFetchingNextPage ? (
              <Thinking label="Loading conversation…" />
            ) : null
          }
          onStartReached={() => {
            if (timeline.hasNextPage && !timeline.isFetchingNextPage) {
              void timeline.fetchNextPage();
            }
          }}
          onStartReachedThreshold={0.25}
          renderItem={renderItem}
          scrollEnabled={messages.length > 0}
        />
        {!timeline.isPending && messages.length === 0 ? (
          <View
            pointerEvents="none"
            className="absolute inset-0 px-6"
            style={{ bottom: composerRestingOffset, top: emptyStateTopInset }}
            testID={pendingSession ? 'chat-empty-new' : 'chat-empty-existing'}>
            <Animated.View
              style={{
                alignItems: 'center',
                flex: 1,
                gap: 8,
                justifyContent: 'center',
                transform: [{ translateY: emptyStateShift }],
              }}>
              <Typography.Heading type="h2" className="text-center">
                {pendingSession ? emptyStateTitle : 'No messages yet'}
              </Typography.Heading>
              <Typography.Paragraph muted className="text-center">
                {pendingSession
                  ? 'Chat naturally with your Hermes agent.'
                  : 'This conversation is on your Hermes server but has no messages yet. Send one to continue it here.'}
              </Typography.Paragraph>
            </Animated.View>
          </View>
        ) : null}
        <ChatComposer
          key={`chat-composer-${sessionId}`}
          activePrompt={Boolean(chat.state.activePrompt)}
          activityLabel={activityLabel}
          baseUrl={baseUrl}
          blocked={composerBlocked}
          busy={busy}
          canDictate={canDictate}
          cancelling={cancelling}
          client={client}
          connectionId={connectionId}
          correcting={correcting}
          correctionError={chat.state.correctionError?.message}
          gatewayClient={gatewayClient}
          onCorrect={chat.correct}
          onDismissTurnActionError={() => setTurnActionError(undefined)}
          onBottomOffsetChange={setComposerBottomOffset}
          onRestingOffsetChange={setComposerRestingOffset}
          onSend={chat.send}
          onStop={chat.stop}
          prompt={
            chat.state.activePrompt && gatewayClient ? (
              <PromptCard
                busy={promptBusy}
                error={promptError}
                prompt={chat.state.activePrompt}
                onRespond={respondToPrompt}
              />
            ) : undefined
          }
          sessionId={sessionId}
          turnActionError={turnActionError}
        />
      </View>
      <ToolDetailSheet detail={toolDetail} onDismiss={dismissToolDetail} />
    </View>
  );
}

// FlashList's content container only honors padding, so the former `gap-3`
// between turns is a separator instead.
function ChatTurnSeparator() {
  return <View className="h-3" />;
}

/** Assistant parts grouped for rendering: prose blocks and tool runs. */
type AssistantGroup =
  | {
      key: string;
      kind: 'text';
      last: boolean;
      part: Extract<WaveChatPart, { type: 'text' }>;
    }
  | {
      key: string;
      kind: 'tools';
      parts: Extract<WaveChatPart, { type: 'task' }>[];
    };

function groupAssistantParts(message: WaveChatMessage): AssistantGroup[] {
  const groups: AssistantGroup[] = [];
  message.parts.forEach((part, index) => {
    if (part.type === 'task') {
      const previous = groups[groups.length - 1];
      if (previous?.kind === 'tools') {
        previous.parts.push(part);
      } else {
        groups.push({ key: `run-${part.id}`, kind: 'tools', parts: [part] });
      }
      return;
    }
    groups.push({
      key: `${message.id}-text-${index}`,
      kind: 'text',
      last: index === message.parts.length - 1,
      part,
    });
  });
  return groups;
}

const ChatTurn = memo(
  function ChatTurn({
    busy,
    isStreaming,
    message,
    onBranch,
    onPlay,
    onRegenerate,
    onShowToolDetail,
    playbackStatus,
  }: {
    busy: boolean;
    isStreaming: boolean;
    message: WaveChatMessage;
    onBranch?: (messageId: string) => void;
    onPlay?: (messageId: string, text: string) => void;
    onRegenerate?: (messageId: string) => void;
    onShowToolDetail: (detail: WaveToolCallDetail) => void;
    playbackStatus: 'idle' | 'loading' | 'playing' | 'error';
  }) {
    if (message.role === 'user') {
      return (
        <Message
          align="end"
          className="my-2"
          testID={`chat-message-${message.id}`}>
          <Message.Content>
            {message.parts.map((part, index) =>
              part.type === 'text' ? (
                <Message.Bubble
                  key={`${message.id}-text-${index}`}
                  className={
                    index === message.parts.length - 1
                      ? undefined
                      : 'rounded-ee-2xl'
                  }>
                  <Message.BubbleContent>{part.text}</Message.BubbleContent>
                </Message.Bubble>
              ) : null,
            )}
          </Message.Content>
        </Message>
      );
    }

    const spokenText = message.parts
      .flatMap((part) => (part.type === 'text' ? [part.text] : []))
      .join('\n\n')
      .trim();
    return (
      <View className="gap-3" testID={`chat-message-${message.id}`}>
        {message.reasoning ? (
          <ChatReasoning
            reasoning={message.reasoning}
            streaming={message.reasoningStreaming}
            testID={`chat-reasoning-${message.id}`}
          />
        ) : null}
        {groupAssistantParts(message).map((group) =>
          group.kind === 'text' ? (
            <Response
              key={group.key}
              // Only the still-arriving tail streams; sealed interim
              // segments and completed turns parse once and stay stable.
              isStreaming={isStreaming && group.last && !group.part.sealed}
              testID={`${group.key}-response`}>
              {group.part.text}
            </Response>
          ) : (
            <ChatToolRun
              key={group.key}
              parts={group.parts}
              onShowDetail={onShowToolDetail}
            />
          ),
        )}
        {isStreaming && message.parts.length === 0 ? (
          <Shimmer textClassName="text-base">Working…</Shimmer>
        ) : null}
        {/* The action row belongs to finished assistant turns only: there is
            nothing stable to copy, branch, or read aloud mid-stream. */}
        {!isStreaming && spokenText ? (
          <TurnActionRow
            busy={busy}
            createdAt={message.createdAt}
            getCopyText={() =>
              message.parts
                .flatMap((part) => (part.type === 'text' ? [part.text] : []))
                .join('\n\n')
                .trim()
            }
            messageId={message.id}
            playbackStatus={
              playbackStatus === 'error' ? 'idle' : playbackStatus
            }
            onBranch={onBranch}
            onPlay={onPlay ? (id) => onPlay(id, spokenText) : undefined}
            onRegenerate={onRegenerate}
          />
        ) : null}
      </View>
    );
  },
  (previous, next) =>
    previous.busy === next.busy &&
    previous.isStreaming === next.isStreaming &&
    previous.message.createdAt === next.message.createdAt &&
    previous.message.id === next.message.id &&
    previous.message.parts === next.message.parts &&
    previous.message.reasoning === next.message.reasoning &&
    previous.message.reasoningStreaming === next.message.reasoningStreaming &&
    previous.playbackStatus === next.playbackStatus &&
    previous.onBranch === next.onBranch &&
    previous.onPlay === next.onPlay &&
    previous.onRegenerate === next.onRegenerate,
);

/**
 * The turn's reasoning trace: PanelUI's Reasoning disclosure over the same
 * bounded `Response` markdown pipeline assistant text uses (model-authored
 * prose, links outside the allowlist stay inert). A live trace streams
 * (shimmering trigger, self-measured duration, auto-open/close); a stored
 * trace arrives folded under a plain "Reasoning" label.
 */
function ChatReasoning({
  reasoning,
  streaming,
  testID,
}: {
  reasoning: WaveToolDetail;
  streaming?: boolean;
  testID: string;
}) {
  const streamedLive = streaming !== undefined;
  return (
    <Reasoning
      isStreaming={streaming === true}
      {...(streamedLive ? {} : { defaultOpen: false })}
      testID={testID}>
      <Reasoning.Trigger
        accessibilityLabel="Reasoning trace"
        testID={`${testID}-trigger`}
        {...(streamedLive
          ? {}
          : {
              label: () => (
                <Typography className="text-sm text-muted-foreground">
                  Reasoning
                </Typography>
              ),
            })}
      />
      <Reasoning.Content testID={`${testID}-content`}>
        {/* Same markdown pipeline as the final response, dimmed as a
            subtree so the trace reads as background thought, not answer. */}
        <View className="opacity-70">
          <Response isStreaming={streaming === true}>{reasoning.text}</Response>
        </View>
        {reasoning.truncated ? (
          <Typography className="text-sm text-muted-foreground">
            (truncated)
          </Typography>
        ) : null}
      </Reasoning.Content>
    </Reasoning>
  );
}

/**
 * One contiguous run of tool calls (and handoffs) inside an assistant turn:
 * each call is a Marker row — an action taken, not a message spoken — with
 * a bounded one-line label. Raw tool input/output is never displayed, and
 * there is deliberately no disclosure affordance.
 */
function ChatToolRun({
  onShowDetail,
  parts,
}: {
  onShowDetail: (detail: WaveToolCallDetail) => void;
  parts: Extract<WaveChatPart, { type: 'task' }>[];
}) {
  return (
    <View className="gap-1">
      {parts.map((part) => (
        <ChatToolMarker key={part.id} part={part} onShowDetail={onShowDetail} />
      ))}
    </View>
  );
}

function toolActionIcon(verb: string) {
  switch (verb) {
    case 'Read':
    case 'Wrote':
    case 'Listed':
      return <FileIcon size={14} />;
    case 'Edited':
      return <PencilIcon size={14} />;
    case 'Ran':
      return <ChevronRightIcon size={14} />;
    case 'Searched':
    case 'Searched the web':
      return <SearchIcon size={14} />;
    case 'Fetched':
      return <LinkIcon size={14} />;
    case 'Asked Hermes':
      return <SparklesIcon size={14} />;
    default:
      return <CheckCircleIcon size={14} />;
  }
}

function ChatToolMarker({
  onShowDetail,
  part,
}: {
  onShowDetail: (detail: WaveToolCallDetail) => void;
  part: Extract<WaveChatPart, { type: 'task' }>;
}) {
  const action = deriveToolAction(part);
  const label = toolActionLabel(action);
  const failed = part.status === 'error';
  const destructive = useCSSVariable('--color-destructive');
  return (
    <Pressable
      accessibilityHint="Shows the call's input and output"
      accessibilityLabel={`${label}. ${toolStatusDescription(part.status)}`}
      accessibilityRole="button"
      style={({ pressed }) => (pressed ? { opacity: 0.6 } : undefined)}
      onPress={() =>
        onShowDetail({
          input: part.input,
          output: part.output,
          outputIsPreview: Boolean(part.outputIsPreview),
          status: part.status,
          // Handoffs keep their action verb; every other row shows the
          // humanized tool name. Raw ids never reach the sheet.
          title: part.id.endsWith('-handoff')
            ? 'Asked Hermes'
            : formatToolName(part.title),
        })
      }>
      <Marker testID={`chat-task-${part.id}`}>
        <Marker.Icon>
          {failed ? (
            <AlertTriangleIcon
              color={typeof destructive === 'string' ? destructive : undefined}
              size={14}
            />
          ) : (
            toolActionIcon(action.verb)
          )}
        </Marker.Icon>
        <Marker.Content
          className={failed ? 'text-destructive' : undefined}
          shimmer={part.status === 'running'}>
          {failed ? `${label} — failed` : label}
        </Marker.Content>
      </Marker>
    </Pressable>
  );
}

function Thinking({ label }: { label: string }) {
  return (
    <View className="py-2" testID="chat-thinking">
      <Shimmer textClassName="text-base">{label}</Shimmer>
    </View>
  );
}

function toolStatusDescription(
  status: 'complete' | 'error' | 'pending' | 'running',
) {
  switch (status) {
    case 'pending':
      return 'Waiting to run';
    case 'running':
      return 'Running';
    case 'complete':
      return 'Completed';
    case 'error':
      return 'Could not complete';
  }
}
