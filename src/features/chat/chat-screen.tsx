import {
  useInfiniteQuery,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';
import type { WaveTimelineResponse, WaveTurnInput } from '@wave/contracts';
import { Redirect, useFocusEffect, useRouter } from 'expo-router';
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
  PlusIcon,
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
import { FlatList, Keyboard, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useCSSVariable } from 'uniwind';

import { CameraIcon } from '@/components/icons/camera-icon';
import { registerMobileAgentStateProvider } from '@/dev/mobile-agent-state';
import {
  timelineToWaveChatMessages,
  type WaveChatMessage,
  type WaveChatPart,
} from '@/features/chat/chat-state';
import { useChatAttachments } from '@/features/chat/use-chat-attachments';
import { useWaveChat } from '@/features/chat/use-wave-chat';
import { useWaveConnection } from '@/features/connection/connection-provider';
import { refreshWaveSessionTimeline } from '@/features/sessions/refresh-session-timeline';
import {
  waveSessionQueryKey,
  waveTimelineQueryKey,
} from '@/features/sessions/session-query-keys';
import { ActiveSessionStore } from '@/services/sessions/active-session-store';
import {
  WaveBackendError,
  type WaveBackendClient,
} from '@/services/wave/wave-backend-client';

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
  const { client, state: connection } = useWaveConnection();

  if (connection.phase !== 'connected' || !client || !sessionId) {
    return <Redirect href={sessionId ? '/' : '/new'} />;
  }
  return (
    <ConnectedChatScreen
      baseUrl={connection.summary.baseUrl}
      client={client}
      connectionId={connection.summary.device.id}
      sessionId={sessionId}
    />
  );
}

function ConnectedChatScreen({
  baseUrl,
  client,
  connectionId,
  sessionId,
}: {
  baseUrl: string;
  client: WaveBackendClient;
  connectionId: string;
  sessionId: string;
}) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [input, setInput] = useState('');
  const [attachmentSheetOpen, setAttachmentSheetOpen] = useState(false);
  const attachmentState = useChatAttachments();
  const activeSessionStore = useMemo(() => new ActiveSessionStore(), []);
  const timelineKey = useMemo(
    () => waveTimelineQueryKey(connectionId, baseUrl, sessionId),
    [baseUrl, connectionId, sessionId],
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
    queryFn: ({ pageParam, signal }) =>
      client.getSessionTimeline(
        sessionId,
        {
          ...(pageParam ? { before: pageParam } : {}),
          limit: 100,
        },
        signal,
      ),
    queryKey: timelineKey,
  });
  const reconcileTimeline = useCallback(async () => {
    const result = await refreshWaveSessionTimeline({
      baseUrl,
      connectionId,
      load: (before, signal) =>
        client.getSessionTimeline(
          sessionId,
          {
            ...(before ? { before } : {}),
            limit: 100,
          },
          signal,
        ),
      queryClient,
      sessionId,
    });
    await queryClient.invalidateQueries({
      queryKey: waveSessionQueryKey(connectionId, baseUrl),
    });
    return result;
  }, [baseUrl, client, connectionId, queryClient, sessionId]);
  const chat = useWaveChat({
    client,
    reconcileTimeline,
    sessionId,
  });

  useEffect(() => {
    if (!__DEV__) return;
    return registerMobileAgentStateProvider({
      name: 'wave-chat',
      read: () => ({
        sessionId,
        status: chat.state.status,
      }),
    });
  }, [chat.state.status, sessionId]);

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

  const timelineEntries = useMemo(
    () =>
      [...(timeline.data?.pages ?? [])]
        .reverse()
        .flatMap((page) => page.entries),
    [timeline.data?.pages],
  );
  const timelineMessages = useMemo(
    () => timelineToWaveChatMessages(timelineEntries),
    [timelineEntries],
  );
  const messages = useMemo(
    () => [...timelineMessages, ...chat.state.messages].reverse(),
    [chat.state.messages, timelineMessages],
  );
  const emptyStateTitle = useMemo(
    () => emptyStateTitleForSession(sessionId),
    [sessionId],
  );
  const busy =
    chat.state.status === 'submitting' ||
    chat.state.status === 'streaming' ||
    chat.state.status === 'cancelling';
  const activeAssistantId = chat.state.messages.findLast(
    (message) => message.role === 'assistant',
  )?.id;

  const send = useCallback(() => {
    const value = input.trim();
    if (!value || busy) return;
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
  }, [attachmentState, busy, chat, input]);

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
      />
    ),
    [activeAssistantId, busy],
  );

  return (
    <View className="flex-1 bg-background">
      {timeline.error ? (
        <Alert
          className="mx-4 mt-3"
          variant="destructive"
          testID="chat-history-error">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>Conversation unavailable</Alert.Title>
            <Alert.Description>
              Wave could not refresh this conversation.
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}

      {chat.state.error ? (
        <Alert
          className="mx-4 mt-3"
          variant="destructive"
          testID="chat-turn-error">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>Turn interrupted</Alert.Title>
            <Alert.Description>{chat.state.error.message}</Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}

      <View className="flex-1">
        <FlatList
          className="flex-1"
          contentContainerClassName="gap-3 px-4 py-3"
          data={messages}
          inverted
          initialNumToRender={12}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          keyExtractor={(message) => message.id}
          ListFooterComponent={
            timeline.isPending || timeline.isFetchingNextPage ? (
              <Thinking label="Loading conversation…" />
            ) : chat.state.status === 'submitting' ? (
              <Thinking label="Wave is thinking…" />
            ) : null
          }
          maxToRenderPerBatch={8}
          onEndReached={() => {
            if (timeline.hasNextPage && !timeline.isFetchingNextPage) {
              void timeline.fetchNextPage();
            }
          }}
          onEndReachedThreshold={0.25}
          renderItem={renderItem}
          windowSize={9}
        />
        {!timeline.isPending && messages.length === 0 ? (
          <View
            pointerEvents="none"
            className="absolute inset-0 items-center justify-center gap-2 px-6">
            <Typography.Heading type="h2" className="text-center">
              {emptyStateTitle}
            </Typography.Heading>
            <Typography.Paragraph muted className="text-center">
              Chat naturally. Wave delegates work when your Hermes agent is
              needed.
            </Typography.Paragraph>
          </View>
        ) : null}
      </View>

      <KeyboardAvoider
        bottomInset={Math.max(insets.bottom, 12) - KEYBOARD_GAP}
        className="gap-2 bg-background px-4 pt-2"
        mode="dock"
        style={{ paddingBottom: Math.max(insets.bottom, 12) }}>
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

        {attachmentState.error ? (
          <Alert variant="destructive" testID="attachment-error">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Description>{attachmentState.error}</Alert.Description>
            </Alert.Content>
          </Alert>
        ) : attachmentState.attachments.length > 0 && !input.trim() ? (
          <Typography.Paragraph muted className="px-2 text-xs">
            Add a message to send the selected attachments.
          </Typography.Paragraph>
        ) : null}

        <InputGroup
          className="min-h-14 overflow-hidden rounded-[28px] bg-muted"
          isDisabled={busy}>
          <InputGroup.Prefix className="px-2">
            <Button
              size="icon"
              variant="secondary"
              accessibilityLabel="Add an attachment"
              disabled={busy}
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
          </InputGroup.Prefix>
          <InputGroup.Input
            multiline
            accessibilityLabel="Message Wave"
            className="max-h-32 min-h-14 rounded-[28px] border-0 bg-muted py-4"
            placeholder="Message Wave"
            style={{ paddingLeft: 60, paddingRight: 56 }}
            submitBehavior="submit"
            testID="chat-composer-input"
            value={input}
            onChangeText={setInput}
            onSubmitEditing={send}
          />
          <InputGroup.Suffix className="px-2">
            {busy ? (
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
              <Button
                size="icon"
                accessibilityLabel="Send message to Wave"
                className="rounded-full"
                testID="chat-send-button"
                onPress={send}>
                <SendIcon size={18} />
              </Button>
            ) : (
              <Button
                size="icon"
                accessibilityLabel="Start live voice"
                className="rounded-full"
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
  }: {
    isStreaming: boolean;
    message: WaveChatMessage;
  }) {
    const isUser = message.role === 'user';
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
              return (
                <Message.Bubble
                  key={`${message.id}-text-${index}`}
                  className={
                    isLastPart
                      ? undefined
                      : isUser
                        ? 'rounded-ee-2xl'
                        : 'rounded-es-2xl'
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
            <Message.Bubble>
              <Shimmer textClassName="text-base">Wave is thinking…</Shimmer>
            </Message.Bubble>
          ) : null}
        </Message.Content>
      </Message>
    );
  },
  (previous, next) =>
    previous.isStreaming === next.isStreaming &&
    previous.message.id === next.message.id &&
    previous.message.parts === next.message.parts,
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
        isLast ? 'rounded-es-md' : '',
        status === 'error' ? 'border border-destructive/30' : '',
      ].join(' ')}
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
