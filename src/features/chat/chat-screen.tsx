import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';
import type {
  WaveTimelineResponse,
  WaveToolDetail,
  WaveTurnInput,
} from '@wave/contracts';
import { Redirect, Stack, useFocusEffect, useRouter } from 'expo-router';
import {
  Alert,
  AlertTriangleIcon,
  Attachment,
  BottomSheet,
  Button,
  ChevronRightIcon,
  CircleIcon,
  FileIcon,
  ImageIcon,
  Input,
  KeyboardAvoider,
  LinkIcon,
  Marker,
  Message,
  PaperclipIcon,
  MicIcon,
  PencilIcon,
  PlusIcon,
  Reasoning,
  Response,
  // RotateCcwIcon deliberately: the package's runtime entry exports only the
  // counter-clockwise variant even though the typings declare both.
  RotateCcwIcon,
  SearchIcon,
  SendIcon,
  Shimmer,
  Soundwave,
  SparklesIcon,
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
import { Animated, Keyboard, Pressable, View } from 'react-native';
import { useKeyboardAnimation } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCSSVariable } from 'uniwind';

import { CameraIcon } from '@/components/icons/camera-icon';
import { ConversationScroller } from '@/components/conversation-scroller';
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
import { initialConversationAnchor } from '@/features/chat/conversation-anchor';
import {
  deriveToolAction,
  toolActionLabel,
} from '@/features/chat/tool-actions';
import { SessionModelPill } from '@/features/chat/model-picker';
import {
  SlashCommandResult,
  SlashHighlightMirror,
  SlashSuggestionList,
  shouldMirrorHighlight,
  useSlashComposer,
} from '@/features/chat/slash-composer';
import {
  highlightedCommandLength,
  resolveSlashSubmission,
} from '@/features/chat/slash-commands';
import {
  branchCount,
  collectPrunedEntryIds,
  regenerateTarget,
} from '@/features/chat/turn-action-targets';
import { TurnActionRow } from '@/features/chat/turn-action-row';
import { useChatAttachments } from '@/features/chat/use-chat-attachments';
import { useWaveChat } from '@/features/chat/use-wave-chat';
import { useConnectedWave } from '@/state/use-connected-wave';
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
import { activeSessionStore } from '@/services/sessions/active-session-store';
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
  // The empty state centers on the area the keyboard leaves visible: the
  // docked composer translates up by the keyboard height, so shifting the
  // centered overlay by half of it keeps it centered in what remains
  // (`height` animates 0 → -keyboardHeight, so half of it moves up).
  const { height: animatedKeyboardHeight } = useKeyboardAnimation();
  const emptyStateShift = useMemo(
    () => Animated.multiply(animatedKeyboardHeight, 0.5),
    [animatedKeyboardHeight],
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

  const [caret, setCaret] = useState(0);
  const [modelPickerNonce, setModelPickerNonce] = useState(0);
  const slash = useSlashComposer({
    actions: {
      onOpenModelPicker: () => setModelPickerNonce((nonce) => nonce + 1),
      onOpenResume: () => router.navigate('/search'),
      onPrefill: setInput,
      onSendExpanded: (message, display) => void chat.send(message, display),
      onStartNewChat: () => router.navigate('/new'),
      onStopTurn: () => void chat.stop(),
    },
    baseUrl,
    chatClient: client,
    connectionId,
    gatewayClient,
    sessionId,
  });
  // The command lane: leading recognized slash text runs as a command in both
  // idle and busy composers; it never becomes a prompt or a correction.
  const slashResolution = useMemo(
    () =>
      attachmentState.attachments.length === 0
        ? resolveSlashSubmission(input, slash.catalog)
        : undefined,
    [attachmentState.attachments.length, input, slash.catalog],
  );
  const runSlashFromComposer = useCallback(() => {
    if (!slashResolution || composerBlocked || slash.running) return;
    setInput('');
    void slash.run(slashResolution);
  }, [composerBlocked, slash, slashResolution]);
  const slashSuggestions = useMemo(
    () => (composerBlocked ? [] : slash.suggestionsFor(input.slice(0, caret))),
    [caret, composerBlocked, input, slash],
  );
  const acceptSlashSuggestion = useCallback(
    (entry: { command: string }) => {
      const before = input.slice(0, caret);
      const replaceFrom = before.lastIndexOf('/');
      if (replaceFrom < 0) return;
      const next = `${input.slice(0, replaceFrom)}${entry.command} ${input.slice(caret)}`;
      setInput(next);
      setCaret(replaceFrom + entry.command.length + 1);
    },
    [caret, input],
  );
  const slashHighlight = useMemo(
    () =>
      slashResolution ? highlightedCommandLength(input, slash.catalog) : 0,
    [input, slash.catalog, slashResolution],
  );

  const send = useCallback(() => {
    const value = input.trim();
    if (slashResolution) {
      runSlashFromComposer();
      return;
    }
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
  }, [
    attachmentState,
    busy,
    chat,
    composerBlocked,
    input,
    runSlashFromComposer,
    slashResolution,
  ]);

  const correct = useCallback(() => {
    const value = input;
    if (slashResolution) {
      // Desktop parity: a recognized command dispatches through its own RPC
      // lane even while a turn runs, and never rides session.redirect.
      runSlashFromComposer();
      return;
    }
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
    runSlashFromComposer,
    slashResolution,
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

  const [turnActionError, setTurnActionError] = useState<string>();
  const [modelNotice, setModelNotice] = useState<string>();

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
          router.push({
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
        truncateBeforeUserOrdinal: target.ordinal,
      });
    },
    [busy, chat, composerBlocked, queryClient, timelineEntries, timelineKey],
  );

  // Icon `color` is a native prop, so the theme token is resolved here.
  const foreground = useCSSVariable('--color-foreground');
  const attachmentIconColor =
    typeof foreground === 'string' ? foreground : undefined;

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
        <ConversationScroller
          initialAnchor={initialConversationAnchor}
          // Turns hold disclosure state (open Tasks), which recycled rows
          // would carry between messages — so no recycling; the draw buffer
          // covers fast flings instead.
          recycleItems={false}
          drawDistance={500}
          contentContainerClassName="px-4 py-3"
          data={messages}
          extraData={rowExtraData}
          ItemSeparatorComponent={ChatTurnSeparator}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
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
        />
        {!timeline.isPending && messages.length === 0 ? (
          <View
            pointerEvents="none"
            className="absolute inset-0 px-6"
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

        {modelNotice ? (
          <Typography.Paragraph
            muted
            className="px-2 text-center text-xs"
            testID="chat-model-notice">
            {modelNotice}
          </Typography.Paragraph>
        ) : null}

        {turnActionError ? (
          <Pressable onPress={() => setTurnActionError(undefined)}>
            <Typography.Paragraph
              muted
              className="px-2 text-center text-xs"
              testID="chat-turn-action-error">
              {turnActionError} Tap to dismiss.
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

        {slashSuggestions.length > 0 ? (
          <SlashSuggestionList
            suggestions={slashSuggestions}
            onAccept={acceptSlashSuggestion}
          />
        ) : null}
        {slash.result ? (
          <SlashCommandResult
            result={slash.result}
            onDismiss={slash.dismissResult}
          />
        ) : null}

        {/* Two-row composer: the expandable text row on top, every control
            on the row below — attachments and the model pill on the left,
            dictation and the trailing action on the right. */}
        <View
          className="overflow-hidden rounded-[28px] bg-muted pb-1.5"
          testID="chat-composer-box">
          <View className="relative">
            <Input
              multiline
              accessibilityLabel={
                busy ? 'Correct the current response' : 'Ask anything'
              }
              // Explicit font classes so the slash-highlight mirror can use
              // the exact same metrics; the input's own text goes transparent
              // only while the mirror is active.
              className={`max-h-32 min-h-12 border-0 bg-transparent px-4 pb-1 pt-3.5 text-base leading-6 ${
                shouldMirrorHighlight(input, slashHighlight)
                  ? 'text-transparent'
                  : ''
              }`}
              editable={!(cancelling || correcting)}
              placeholder={busy ? 'Add a correction' : 'Ask anything'}
              submitBehavior="submit"
              testID="chat-composer-input"
              value={input}
              onChangeText={(value) => {
                setInput(value);
                slash.observeDraft(value);
              }}
              onSelectionChange={(event) =>
                setCaret(event.nativeEvent.selection.end)
              }
              onSubmitEditing={submitComposer}
            />
            {shouldMirrorHighlight(input, slashHighlight) ? (
              <SlashHighlightMirror
                highlightLength={slashHighlight}
                paddingLeft={16}
                paddingRight={16}
                text={input}
              />
            ) : null}
          </View>
          <View className="flex-row items-center gap-1 px-2">
            {/* The dim lives on a wrapper View: the button's press-feedback
                animation drives opacity from the UI thread, overriding both
                class- and style-based opacity on the button itself. */}
            <View
              style={composerBlocked ? BLOCKED_COMPOSER_BUTTON_STYLE : null}>
              <Button
                size="icon"
                variant="ghost"
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
            {gatewayClient ? (
              <SessionModelPill
                baseUrl={baseUrl}
                connectionId={connectionId}
                disabled={composerBlocked}
                gatewayClient={gatewayClient}
                openNonce={modelPickerNonce}
                sessionId={sessionId}
                onNotice={setModelNotice}
              />
            ) : null}
            <View className="flex-1" />
            {canDictate ? (
              <View
                style={composerBlocked ? BLOCKED_COMPOSER_BUTTON_STYLE : null}>
                <Button
                  size="icon"
                  variant={
                    dictation.state.status === 'recording'
                      ? 'destructive'
                      : 'ghost'
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
            {slashResolution && input.trim() ? (
              // The command lane is visibly distinct from Send/Correct: this
              // runs the recognized /command, in idle and busy composers alike.
              <View
                style={composerBlocked ? BLOCKED_COMPOSER_BUTTON_STYLE : null}>
                <Button
                  size="icon"
                  accessibilityLabel={`Run the ${input.trim().split(/\s/)[0]} command`}
                  className="rounded-full"
                  disabled={composerBlocked || slash.running}
                  loading={slash.running}
                  testID="chat-run-command-button"
                  onPress={runSlashFromComposer}>
                  <ChevronRightIcon size={18} />
                </Button>
              </View>
            ) : correcting ? (
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
                {/* A drawn square: the icon set has no stop glyph, and a
                    text character sits off-baseline and renders unevenly. */}
                <View className="h-3.5 w-3.5 rounded-[2px] bg-foreground" />
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
          </View>
        </View>
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
    playbackStatus,
  }: {
    busy: boolean;
    isStreaming: boolean;
    message: WaveChatMessage;
    onBranch?: (messageId: string) => void;
    onPlay?: (messageId: string, text: string) => void;
    onRegenerate?: (messageId: string) => void;
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
            <ChatToolRun key={group.key} parts={group.parts} />
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
  parts,
}: {
  parts: Extract<WaveChatPart, { type: 'task' }>[];
}) {
  return (
    <View className="gap-1">
      {parts.map((part) => (
        <ChatToolMarker key={part.id} part={part} />
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
      return <CircleIcon size={14} />;
  }
}

function ChatToolMarker({
  part,
}: {
  part: Extract<WaveChatPart, { type: 'task' }>;
}) {
  const action = deriveToolAction(part);
  const label = toolActionLabel(action);
  const failed = part.status === 'error';
  const destructive = useCSSVariable('--color-destructive');
  return (
    <Marker
      accessibilityLabel={`${label}. ${toolStatusDescription(part.status)}`}
      testID={`chat-task-${part.id}`}>
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
