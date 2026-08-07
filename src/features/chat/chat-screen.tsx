import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';
import type { WaveTimelineResponse, WaveTurnInput } from '@wave/contracts';
import { Redirect, Stack, useFocusEffect, useRouter } from 'expo-router';
import {
  Alert,
  Attachment,
  Avatar,
  BottomSheet,
  Button,
  CodeBlock,
  FileIcon,
  ImageIcon,
  InputGroup,
  KeyboardAvoider,
  Message,
  PaperclipIcon,
  MicIcon,
  PlayIcon,
  PlusIcon,
  // RotateCcwIcon deliberately: the package's runtime entry exports only the
  // counter-clockwise variant even though the typings declare both.
  RotateCcwIcon,
  ScrollFade,
  SendIcon,
  Shimmer,
  Soundwave,
  Task,
  Typography,
  XIcon,
} from 'panelui-native';
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  Keyboard,
  Pressable,
  ScrollView,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCSSVariable } from 'uniwind';

import { CameraIcon } from '@/components/icons/camera-icon';
import { LegendList } from '@/components/legend-list';
import { OfflineNotice } from '@/components/offline-notice';
import { PromptCard, type PromptCardResponse } from '@/components/prompt-card';
import { registerMobileAgentStateProvider } from '@/dev/mobile-agent-state';
import {
  isWaveChatActivityStale,
  timelineToWaveChatMessages,
  waveChatActivityLabel,
  WAVE_CHAT_ACTIVITY_STALE_MS,
  type WaveChatMessage,
  type WaveChatPart,
} from '@/features/chat/chat-state';
import { useChatAttachments } from '@/features/chat/use-chat-attachments';
import { isNearTimelineEnd } from '@/features/chat/timeline-scroll';
import { useWaveChat } from '@/features/chat/use-wave-chat';
import { useWaveConnection } from '@/features/connection/connection-provider';
import { useDictation } from '@/features/voice/use-dictation';
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
  waveSessionQueryKey,
  waveTimelineQueryKey,
} from '@/features/sessions/session-query-keys';
import { isOfflineLikeWaveError } from '@/services/query/offline-error';
import { ActiveSessionStore } from '@/services/sessions/active-session-store';
import { WaveBackendError } from '@/services/wave/wave-backend-error';
import type { GatewayClient } from '@/services/gateway/gateway-client';
import {
  isPendingSessionId,
  type WaveChatClient,
} from '@/services/wave/wave-chat-client';

interface ChatScreenProps {
  sessionId: string;
}

// Explicit per-bar heights for the live-voice glyph. Supplying `levels` is also
// what makes the Soundwave render still instead of animating.
const LIVE_VOICE_WAVE_LEVELS = [0.3, 1, 0.65, 0.3];

// Space kept visible between the composer and the open keyboard. Dock travel is
// keyboardHeight − bottomInset, so undershooting the composer's real bottom
// padding by this much leaves exactly this gap above the keyboard.
const KEYBOARD_GAP = 12;

// Strong enough to read as inert on the dark composer; the library's own
// disabled dim is both subtler and suppressed by its press animation.
const BLOCKED_COMPOSER_BUTTON_STYLE = { opacity: 0.4 } as const;

// The avatar-facing pointer corner of the final assistant item. Expressed
// through RN's directional prop instead of the `rounded-es-*` classes the
// Message variant uses: RN Android resolves the CSS logical `es`/`se`
// corners to the diagonally opposite corner (BorderRadiusStyle.resolve reads
// the tokens inline-axis-first), so `rounded-es-md` squares the top-right on
// Android while iOS correctly squares the bottom-left. borderBottomStartRadius
// resolves correctly on both platforms and still flips for RTL. 6 mirrors the
// theme's `md` radius.
const ASSISTANT_POINTER_CORNER_STYLE = { borderBottomStartRadius: 6 } as const;

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
  const { client, gatewayClient, state: connection } = useWaveConnection();

  if (
    (connection.phase !== 'connected' && connection.phase !== 'offline') ||
    !client ||
    !sessionId
  ) {
    return <Redirect href={sessionId ? '/' : '/new'} />;
  }
  return (
    <ConnectedChatScreen
      baseUrl={connection.identity.baseUrl}
      client={client}
      connectionId={connection.identity.id}
      gatewayClient={gatewayClient}
      offline={connection.phase === 'offline'}
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
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [input, setInput] = useState('');
  const [attachmentSheetOpen, setAttachmentSheetOpen] = useState(false);
  const attachmentState = useChatAttachments();
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
  const dictation = useDictation({ client: gatewayClient });
  const playback = useMessagePlayback({ client: gatewayClient });
  const canDictate = Boolean(gatewayClient) && speech.data?.stt === true;
  const canSpeak = Boolean(gatewayClient) && speech.data?.tts === true;
  const activeSessionStore = useMemo(() => new ActiveSessionStore(), []);
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
  const chat = useWaveChat({
    client,
    getCorrectionAnchor,
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
  }, [activeSessionStore, connectionId, sessionId]);

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
      activeSessionStore,
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
    pendingSession,
    sessionId,
    sessions.data,
    timeline.isPending,
  ]);
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

  const send = useCallback(() => {
    const value = input.trim();
    if (!value || busy || composerBlocked) return;
    const attachments = attachmentState.attachments;
    const turnInput: WaveTurnInput =
      attachments.length === 0
        ? value
        : [
            { text: value, type: 'text' },
            ...attachments.map((attachment) => attachment.part),
          ];
    const optimisticText = [
      value,
      ...attachments.map((attachment) => `[Attached: ${attachment.part.name}]`),
    ].join('\n');
    setInput('');
    attachmentState.clear();
    void chat.send(turnInput, optimisticText);
  }, [attachmentState, busy, chat, composerBlocked, input]);

  const correct = useCallback(() => {
    const value = input;
    if (
      !value.trim() ||
      !busy ||
      cancelling ||
      correcting ||
      composerBlocked ||
      chat.state.activePrompt ||
      attachmentState.attachments.length > 0
    ) {
      return;
    }
    setInput('');
    void chat.correct(value).then((result) => {
      if (
        result.status === 'failed' ||
        result.status === 'rejected' ||
        result.status === 'unavailable'
      ) {
        setInput((current) => (current.trim() ? current : result.draft));
      }
    });
  }, [
    attachmentState.attachments.length,
    busy,
    cancelling,
    chat,
    composerBlocked,
    correcting,
    input,
  ]);

  const submitComposer = busy ? correct : send;
  const canCorrect =
    busy &&
    !cancelling &&
    !correcting &&
    !chat.state.activePrompt &&
    attachmentState.attachments.length === 0 &&
    Boolean(input.trim());
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

  // Press to dictate, press again to insert. The transcript is appended so a
  // half-typed message is never lost.
  const toggleDictation = useCallback(async () => {
    if (dictation.state.status === 'recording') {
      const transcript = await dictation.stop();
      if (!transcript) return;
      setInput((current) =>
        current.trim() ? `${current.trim()} ${transcript}` : transcript,
      );
      return;
    }
    if (dictation.state.status === 'idle') {
      await dictation.start();
    }
  }, [dictation]);

  const selectAttachmentSource = useCallback((action: () => Promise<void>) => {
    setAttachmentSheetOpen(false);
    void action();
  }, []);

  // Icon `color` is a native prop, so the theme token is resolved here.
  const foreground = useCSSVariable('--color-foreground');
  const attachmentIconColor =
    typeof foreground === 'string' ? foreground : undefined;

  const renderItem = useCallback(
    ({ item }: { item: WaveChatMessage }) => (
      <ChatTurn
        isStreaming={
          busy && item.role === 'assistant' && item.id === activeAssistantId
        }
        message={item}
        playbackStatus={
          playback.state.messageId === item.id ? playback.state.status : 'idle'
        }
        onPlay={canSpeak ? playback.play : undefined}
      />
    ),
    [
      activeAssistantId,
      busy,
      canSpeak,
      playback.play,
      playback.state.messageId,
      playback.state.status,
    ],
  );

  // Legend List re-renders a row only when its key, its item, or `extraData`
  // changes — a fresh `renderItem` closure alone is invisible to it. Every row
  // input that lives outside the message itself has to travel through here.
  const rowExtraData = useMemo(
    () => ({
      activeAssistantId,
      busy,
      canSpeak,
      playbackMessageId: playback.state.messageId,
      playbackStatus: playback.state.status,
    }),
    [
      activeAssistantId,
      busy,
      canSpeak,
      playback.state.messageId,
      playback.state.status,
    ],
  );

  // Legend List gates its maintain-at-end scroll on a cached flag that can go
  // stale mid-momentum, which yanked the list to the newest message while the
  // user was reading far-back history and a refetch replaced `data`. Gate the
  // pin on fresh scroll geometry instead: far from the end, no data change is
  // allowed to move the list. Starts true because the list opens at the end.
  const [nearEnd, setNearEnd] = useState(true);
  const trackNearEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const next = isNearTimelineEnd(event.nativeEvent);
      setNearEnd((previous) => (previous === next ? previous : next));
    },
    [],
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

      {chat.state.error ? (
        <View className="px-4 pt-3">
          <Alert variant="destructive" testID="chat-turn-error">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>Turn interrupted</Alert.Title>
              <Alert.Description>{chat.state.error.message}</Alert.Description>
            </Alert.Content>
          </Alert>
        </View>
      ) : null}

      <View className="flex-1">
        {/* Orientation is explicit: ScrollFade cannot infer it from a
            virtualized list the way it can from a ScrollView. */}
        <ScrollFade className="flex-1" orientation="vertical" size={40}>
          <LegendList
            alignItemsAtEnd
            initialScrollAtEnd
            maintainScrollAtEnd={nearEnd}
            maintainVisibleContentPosition
            onScroll={trackNearEnd}
            // Turns hold disclosure state (expanded Tasks), which recycled
            // rows would carry between messages — so no recycling; the draw
            // buffer covers fast flings instead.
            recycleItems={false}
            drawDistance={500}
            className="flex-1"
            contentContainerClassName="px-4 py-3"
            data={messages}
            extraData={rowExtraData}
            ItemSeparatorComponent={ChatTurnSeparator}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            keyExtractor={(message) => message.id}
            ListFooterComponent={
              chat.state.status === 'submitting' ? (
                <Thinking label="Wave is thinking…" />
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
          />
        </ScrollFade>
        {!timeline.isPending && messages.length === 0 ? (
          <View
            pointerEvents="none"
            className="absolute inset-0 items-center justify-center gap-2 px-6"
            testID={pendingSession ? 'chat-empty-new' : 'chat-empty-existing'}>
            <Typography.Heading type="h2" className="text-center">
              {pendingSession ? emptyStateTitle : 'No messages yet'}
            </Typography.Heading>
            <Typography.Paragraph muted className="text-center">
              {pendingSession
                ? 'Chat naturally. Wave delegates work when your Hermes agent is needed.'
                : 'This conversation is on your Hermes server without any messages Wave can show. Send one to continue it here.'}
            </Typography.Paragraph>
          </View>
        ) : null}
      </View>

      <KeyboardAvoider
        bottomInset={Math.max(insets.bottom, 12) - KEYBOARD_GAP}
        className="gap-2 bg-background px-4 pt-2"
        mode="dock"
        style={{ paddingBottom: Math.max(insets.bottom, 12) }}>
        {/* A mid-turn prompt docks above the composer so it is answerable
            without scrolling; the turn is paused until it is. */}
        {chat.state.activePrompt && gatewayClient ? (
          <PromptCard
            busy={promptBusy}
            error={promptError}
            prompt={chat.state.activePrompt}
            onRespond={respondToPrompt}
          />
        ) : null}
        {attachmentState.attachments.length > 0 ? (
          <Attachment.Group
            className="gap-1"
            orientation="vertical"
            testID="chat-attachments">
            {attachmentState.attachments.map((attachment) => (
              <Attachment
                key={attachment.id}
                orientation="horizontal"
                size="sm"
                state="done">
                <Attachment.Media variant="icon">
                  {attachment.part.type === 'image' ? (
                    <ImageIcon size={16} />
                  ) : (
                    <FileIcon size={16} />
                  )}
                </Attachment.Media>
                <Attachment.Content>
                  <Attachment.Title numberOfLines={1}>
                    {attachment.part.name}
                  </Attachment.Title>
                  <Attachment.Description>
                    {attachment.description}
                  </Attachment.Description>
                </Attachment.Content>
                <Attachment.Actions>
                  <Attachment.Action
                    accessibilityLabel={`Remove ${attachment.part.name}`}
                    testID={`remove-attachment-${attachment.id}`}
                    onPress={() => attachmentState.remove(attachment.id)}>
                    <XIcon size={14} />
                  </Attachment.Action>
                </Attachment.Actions>
              </Attachment>
            ))}
          </Attachment.Group>
        ) : null}

        {chat.state.correctionError ? (
          <Alert variant="destructive" testID="chat-correction-error">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>Correction not sent</Alert.Title>
              <Alert.Description>
                {chat.state.correctionError.message}
              </Alert.Description>
            </Alert.Content>
          </Alert>
        ) : null}

        {attachmentState.error ? (
          <Alert variant="destructive" testID="attachment-error">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Description>{attachmentState.error}</Alert.Description>
            </Alert.Content>
          </Alert>
        ) : busy && attachmentState.attachments.length > 0 ? (
          <Typography.Paragraph
            muted
            className="px-2 text-center text-xs"
            testID="chat-correction-attachment-hint">
            Corrections are text only. Remove the attachments or wait for this
            response to finish.
          </Typography.Paragraph>
        ) : attachmentState.attachments.length > 0 && !input.trim() ? (
          <Typography.Paragraph muted className="px-2 text-xs">
            Add a message to send the selected attachments.
          </Typography.Paragraph>
        ) : busy && chat.state.activePrompt && input.trim() ? (
          <Typography.Paragraph
            muted
            className="px-2 text-center text-xs"
            testID="chat-correction-prompt-hint">
            Answer the prompt above before correcting this response.
          </Typography.Paragraph>
        ) : null}

        {dictation.state.status === 'recording' ? (
          <Typography.Paragraph
            muted
            className="px-2 text-center text-xs"
            testID="chat-dictation-hint">
            Listening — tap the microphone again to insert what you said.
          </Typography.Paragraph>
        ) : dictation.state.error ? (
          <Pressable onPress={dictation.dismissError}>
            <Typography.Paragraph
              muted
              className="px-2 text-center text-xs"
              testID="chat-dictation-error">
              {dictation.state.error} Tap to dismiss.
            </Typography.Paragraph>
          </Pressable>
        ) : null}

        {composerBlocked ? (
          <Typography.Paragraph
            muted
            className="px-2 text-center text-xs"
            testID="chat-composer-blocked-hint">
            Sending and live voice are paused until this conversation can
            refresh.
          </Typography.Paragraph>
        ) : null}

        {busy && activityLabel && !chat.state.activePrompt ? (
          <Typography.Paragraph
            muted
            accessibilityLiveRegion="polite"
            className="px-2 text-center text-xs"
            testID="chat-activity-status">
            {activityLabel}
          </Typography.Paragraph>
        ) : null}

        <InputGroup
          className="min-h-14 overflow-hidden rounded-[28px] bg-muted"
          isDisabled={cancelling || correcting}>
          <InputGroup.Prefix className="px-2">
            {/* The dim lives on a wrapper View: the button's press-feedback
                animation drives opacity from the UI thread, overriding both
                class- and style-based opacity on the button itself. */}
            <View
              style={composerBlocked ? BLOCKED_COMPOSER_BUTTON_STYLE : null}>
              <Button
                size="icon"
                variant="secondary"
                accessibilityLabel="Add an attachment"
                disabled={busy || composerBlocked}
                className="rounded-full"
                testID="chat-attachment-button"
                onPress={() => {
                  // The styled sheet renders in the app window, underneath the
                  // keyboard's own window — close the keyboard before opening it.
                  Keyboard.dismiss();
                  setAttachmentSheetOpen(true);
                }}>
                <PlusIcon size={20} />
              </Button>
            </View>
            {canDictate ? (
              <View
                style={composerBlocked ? BLOCKED_COMPOSER_BUTTON_STYLE : null}>
                <Button
                  size="icon"
                  variant={
                    dictation.state.status === 'recording'
                      ? 'destructive'
                      : 'secondary'
                  }
                  accessibilityLabel={
                    dictation.state.status === 'recording'
                      ? 'Stop dictating and insert the transcript'
                      : 'Dictate a message'
                  }
                  disabled={busy || composerBlocked}
                  loading={dictation.state.status === 'transcribing'}
                  className="rounded-full"
                  testID="chat-dictate-button"
                  onPress={() => void toggleDictation()}>
                  <MicIcon size={18} />
                </Button>
              </View>
            ) : null}
          </InputGroup.Prefix>
          <InputGroup.Input
            multiline
            accessibilityLabel={busy ? 'Correct Wave response' : 'Message Wave'}
            className="max-h-32 min-h-14 rounded-[28px] border-0 bg-muted py-4"
            placeholder={busy ? 'Add a correction' : 'Message Wave'}
            // Clears the prefix buttons, which the InputGroup overlays on the
            // field: 8 padding + 44 attachment + 44 mic + spacing.
            style={{ paddingLeft: canDictate ? 116 : 60, paddingRight: 56 }}
            submitBehavior="submit"
            testID="chat-composer-input"
            value={input}
            onChangeText={setInput}
            onSubmitEditing={submitComposer}
          />
          <InputGroup.Suffix className="px-2">
            {correcting ? (
              <Button
                size="icon"
                accessibilityLabel="Sending correction"
                className="rounded-full"
                disabled
                loading
                testID="chat-correction-loading-button"
              />
            ) : canCorrect ? (
              <Button
                size="icon"
                accessibilityLabel="Correct current Wave response"
                className="rounded-full"
                testID="chat-correct-button"
                onPress={correct}>
                <SendIcon size={18} />
              </Button>
            ) : busy ? (
              <Button
                size="icon"
                variant="secondary"
                accessibilityLabel="Stop Wave response"
                className="rounded-full"
                disabled={chat.state.status === 'cancelling'}
                testID="chat-stop-button"
                onPress={() => void chat.stop()}>
                ■
              </Button>
            ) : input.trim() ? (
              <View
                style={composerBlocked ? BLOCKED_COMPOSER_BUTTON_STYLE : null}>
                <Button
                  size="icon"
                  accessibilityLabel="Send message to Wave"
                  className="rounded-full"
                  disabled={composerBlocked}
                  testID="chat-send-button"
                  onPress={send}>
                  <SendIcon size={18} />
                </Button>
              </View>
            ) : (
              <View
                style={composerBlocked ? BLOCKED_COMPOSER_BUTTON_STYLE : null}>
                <Button
                  size="icon"
                  accessibilityLabel="Start live voice"
                  className="rounded-full"
                  disabled={composerBlocked}
                  testID="chat-live-button"
                  onPress={() =>
                    router.push({
                      pathname: '/conversation/[sessionId]/voice',
                      params: { sessionId },
                    })
                  }>
                  <Soundwave
                    barWidth={4}
                    bars={4}
                    height={18}
                    levels={LIVE_VOICE_WAVE_LEVELS}
                    state="idle"
                    style={{ width: 25 }}
                    variant="bars"
                  />
                </Button>
              </View>
            )}
          </InputGroup.Suffix>
        </InputGroup>
      </KeyboardAvoider>

      <BottomSheet
        open={attachmentSheetOpen}
        onOpenChange={setAttachmentSheetOpen}>
        {/* No Header and no close button: the tiles are the whole sheet, and
            the backdrop, grabber drag, and Android back all still dismiss.
            Not BottomSheet.Body either — that is a flex-1 scroll region for
            sized sheets, and in this auto-sized sheet it collapses to zero
            height. */}
        <BottomSheet.Content detached blur showClose={false}>
          <View className="flex-row gap-3 py-2">
            <AttachmentSourceButton
              accessibilityLabel="Take a photo"
              label="Camera"
              testID="attachment-source-camera"
              onPress={() => selectAttachmentSource(attachmentState.takePhoto)}>
              <CameraIcon color={attachmentIconColor} size={22} />
            </AttachmentSourceButton>
            <AttachmentSourceButton
              accessibilityLabel="Choose a photo"
              label="Photos"
              testID="attachment-source-photos"
              onPress={() => selectAttachmentSource(attachmentState.pickImage)}>
              <ImageIcon color={attachmentIconColor} size={22} />
            </AttachmentSourceButton>
            <AttachmentSourceButton
              accessibilityLabel="Choose a text file"
              label="Files"
              testID="attachment-source-files"
              onPress={() => selectAttachmentSource(attachmentState.pickFile)}>
              <PaperclipIcon color={attachmentIconColor} size={22} />
            </AttachmentSourceButton>
          </View>
        </BottomSheet.Content>
      </BottomSheet>
    </View>
  );
}

// FlashList's content container only honors padding, so the former `gap-3`
// between turns is a separator instead.
function ChatTurnSeparator() {
  return <View className="h-3" />;
}

function AttachmentSourceButton({
  accessibilityLabel,
  children,
  label,
  onPress,
  testID,
}: {
  accessibilityLabel: string;
  children: ReactNode;
  label: string;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      className="flex-1 items-center gap-2 rounded-2xl bg-muted py-5 active:opacity-70"
      testID={testID}
      onPress={onPress}>
      {children}
      <Typography className="text-sm font-medium">{label}</Typography>
    </Pressable>
  );
}

const ChatTurn = memo(
  function ChatTurn({
    isStreaming,
    message,
    onPlay,
    playbackStatus,
  }: {
    isStreaming: boolean;
    message: WaveChatMessage;
    onPlay?: (messageId: string, text: string) => void;
    playbackStatus: 'idle' | 'loading' | 'playing' | 'error';
  }) {
    const isUser = message.role === 'user';
    const spokenText = message.parts
      .flatMap((part) => (part.type === 'text' ? [part.text] : []))
      .join('\n\n')
      .trim();
    return (
      <Message
        align={isUser ? 'end' : 'start'}
        testID={`chat-message-${message.id}`}>
        {!isUser ? (
          <Message.Avatar>
            <Avatar accessibilityLabel="Wave" fallback="W" size="sm" />
          </Message.Avatar>
        ) : null}
        <Message.Content>
          {message.parts.map((part, index) => {
            const isLastPart = index === message.parts.length - 1;
            if (part.type === 'text') {
              // User bubbles keep the variant's `rounded-ee-*` classes (that
              // corner resolves correctly everywhere); assistant bubbles
              // override the broken `es` class away and draw the pointer via
              // ASSISTANT_POINTER_CORNER_STYLE on the final item only.
              return (
                <Message.Bubble
                  key={`${message.id}-text-${index}`}
                  className={
                    isUser
                      ? isLastPart
                        ? undefined
                        : 'rounded-ee-2xl'
                      : 'rounded-2xl'
                  }
                  style={
                    !isUser && isLastPart
                      ? ASSISTANT_POINTER_CORNER_STYLE
                      : undefined
                  }>
                  <Message.BubbleContent>{part.text}</Message.BubbleContent>
                </Message.Bubble>
              );
            }
            return (
              <ChatToolStep
                key={part.id}
                isLast={isLastPart}
                input={part.input}
                output={part.output}
                outputIsPreview={part.outputIsPreview}
                status={part.status}
                testID={`chat-task-${part.id}`}
                title={part.title}
              />
            );
          })}
          {isStreaming && message.parts.length === 0 ? (
            <Message.Bubble
              className="rounded-2xl"
              style={ASSISTANT_POINTER_CORNER_STYLE}>
              <Shimmer textClassName="text-base">Wave is thinking…</Shimmer>
            </Message.Bubble>
          ) : null}
          {/* Playback belongs to finished assistant text only: there is
              nothing stable to read aloud mid-stream. */}
          {!isUser && !isStreaming && onPlay && spokenText ? (
            <Button
              size="sm"
              variant="ghost"
              accessibilityLabel={
                playbackStatus === 'playing'
                  ? 'Stop reading this message aloud'
                  : 'Read this message aloud'
              }
              className="self-start"
              loading={playbackStatus === 'loading'}
              startContent={<PlayIcon size={14} />}
              testID={`chat-play-${message.id}`}
              onPress={() => onPlay(message.id, spokenText)}>
              {playbackStatus === 'playing' ? 'Stop' : 'Play'}
            </Button>
          ) : null}
        </Message.Content>
      </Message>
    );
  },
  (previous, next) =>
    previous.isStreaming === next.isStreaming &&
    previous.message.id === next.message.id &&
    previous.message.parts === next.message.parts &&
    previous.playbackStatus === next.playbackStatus &&
    previous.onPlay === next.onPlay,
);

function ChatToolStep({
  input,
  isLast,
  output,
  outputIsPreview,
  status,
  testID,
  title,
}: {
  input: Extract<WaveChatPart, { type: 'task' }>['input'];
  isLast: boolean;
  output: Extract<WaveChatPart, { type: 'task' }>['output'];
  outputIsPreview: Extract<WaveChatPart, { type: 'task' }>['outputIsPreview'];
  status: 'complete' | 'error' | 'pending' | 'running';
  testID: string;
  title: string;
}) {
  const displayTitle = formatToolName(title);
  const [open, setOpen] = useState(false);
  const [hasOpened, setHasOpened] = useState(false);
  const setDisclosureOpen = useCallback((next: boolean) => {
    setOpen(next);
    if (next) {
      setHasOpened(true);
    }
  }, []);

  return (
    <Task
      className={[
        'rounded-xl bg-muted px-3 py-2',
        open ? 'gap-2' : 'gap-0',
        status === 'error' ? 'border border-destructive/30' : '',
      ].join(' ')}
      style={isLast ? ASSISTANT_POINTER_CORNER_STYLE : undefined}
      defaultOpen={false}
      open={open}
      status={status}
      testID={testID}
      onOpenChange={setDisclosureOpen}>
      <Task.Trigger
        accessibilityHint="Shows the raw tool input and output"
        accessibilityLabel={`${displayTitle}, ${toolStatusDescription(status).toLowerCase()}. ${open ? 'Collapse' : 'Expand'} tool details`}
        testID={`${testID}-trigger`}
        title={displayTitle}
      />
      {hasOpened ? (
        <Task.Content className="ms-0 gap-2 border-s-0 ps-0">
          <ToolDetailBlock
            detail={input}
            label="Input"
            testID={`${testID}-input`}
          />
          <ToolDetailBlock
            detail={output}
            label={outputIsPreview ? 'Output preview' : 'Output'}
            testID={`${testID}-output`}
          />
        </Task.Content>
      ) : null}
    </Task>
  );
}

function ToolDetailBlock({
  detail,
  label,
  testID,
}: {
  detail: Extract<WaveChatPart, { type: 'task' }>['input'];
  label: string;
  testID: string;
}) {
  if (!detail) {
    return (
      <Task.Item testID={testID}>
        {`No raw ${label.toLowerCase()} was provided.`}
      </Task.Item>
    );
  }

  return (
    <ScrollView
      nestedScrollEnabled
      showsVerticalScrollIndicator
      style={{ maxHeight: 320 }}>
      <CodeBlock
        className="w-full"
        code={detail.text}
        language="text"
        testID={testID}>
        <CodeBlock.Header>
          <CodeBlock.Filename>
            {detail.truncated ? `${label} (truncated)` : label}
          </CodeBlock.Filename>
          <CodeBlock.Actions>
            <CodeBlock.CopyButton />
          </CodeBlock.Actions>
        </CodeBlock.Header>
      </CodeBlock>
    </ScrollView>
  );
}

function Thinking({ label }: { label: string }) {
  return (
    <Message className="pb-2" testID="chat-thinking">
      <Message.Avatar>
        <Avatar accessibilityLabel="Wave" fallback="W" size="sm" />
      </Message.Avatar>
      <Message.Content>
        <Message.Bubble>
          <Shimmer textClassName="text-base">{label}</Shimmer>
        </Message.Bubble>
      </Message.Content>
    </Message>
  );
}

function formatToolName(name: string) {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!words) return 'Hermes tool';
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
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
