import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect, useRouter } from 'expo-router';
import {
  Alert,
  Avatar,
  Button,
  CodeBlock,
  Input,
  KeyboardAvoider,
  Message,
  MicIcon,
  SendIcon,
  Shimmer,
  Task,
  Typography,
} from 'panelui-native';
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { FlatList, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useWaveConnection } from '@/features/connection/connection-provider';
import {
  historyToWaveChatMessages,
  type WaveChatPart,
  type WaveChatMessage,
} from '@/features/chat/chat-state';
import { useWaveChat } from '@/features/chat/use-wave-chat';
import { refreshWaveSessionHistory } from '@/features/sessions/refresh-session-history';
import { waveHistoryQueryKey } from '@/features/sessions/session-query-keys';
import { ActiveSessionStore } from '@/services/sessions/active-session-store';
import type { WaveBackendClient } from '@/services/wave/wave-backend-client';

interface ChatScreenProps {
  sessionId: string;
}

export function ChatScreen({ sessionId }: ChatScreenProps) {
  const { client, state: connection } = useWaveConnection();

  if (connection.phase !== 'connected' || !client || !sessionId) {
    return <Redirect href={sessionId ? '/' : '/sessions'} />;
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
  const activeSessionStore = useMemo(
    () => new ActiveSessionStore(),
    [],
  );
  const historyKey = useMemo(
    () => waveHistoryQueryKey(connectionId, baseUrl, sessionId),
    [baseUrl, connectionId, sessionId],
  );
  const history = useQuery({
    queryFn: ({ signal }) =>
      client.getSessionHistory(sessionId, signal),
    queryKey: historyKey,
  });
  const reconcileHistory = useCallback(
    () =>
      refreshWaveSessionHistory({
        baseUrl,
        connectionId,
        load: (signal) =>
          client.getSessionHistory(sessionId, signal),
        queryClient,
        sessionId,
      }),
    [
      baseUrl,
      client,
      connectionId,
      queryClient,
      sessionId,
    ],
  );
  const chat = useWaveChat({
    client,
    reconcileHistory,
    sessionId,
  });

  useEffect(() => {
    void activeSessionStore
      .save(connectionId, sessionId)
      .catch(() => undefined);
  }, [activeSessionStore, connectionId, sessionId]);

  const historyMessages = useMemo(
    () =>
      historyToWaveChatMessages(
        history.data?.messages ?? [],
      ),
    [history.data?.messages],
  );
  const messages = useMemo(
    () =>
      [...historyMessages, ...chat.state.messages].reverse(),
    [chat.state.messages, historyMessages],
  );
  const busy =
    chat.state.status === 'submitting' ||
    chat.state.status === 'streaming' ||
    chat.state.status === 'cancelling';
  const activeAssistantId =
    chat.state.messages.findLast(
      (message) => message.role === 'assistant',
    )?.id;

  const send = useCallback(() => {
    const value = input.trim();
    if (!value || busy) return;
    setInput('');
    void chat.send(value);
  }, [busy, chat, input]);

  const renderItem = useCallback(
    ({ item }: { item: WaveChatMessage }) => (
      <ChatTurn
        isStreaming={
          busy &&
          item.role === 'assistant' &&
          item.id === activeAssistantId
        }
        message={item}
      />
    ),
    [activeAssistantId, busy],
  );

  return (
    <View className="flex-1 bg-background">
      {history.error ? (
        <Alert
          className="mx-4 mt-3"
          variant="destructive"
          testID="chat-history-error">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>History unavailable</Alert.Title>
            <Alert.Description>
              Wave could not refresh this Hermes conversation.
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
            <Alert.Description>
              {chat.state.error.message}
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}

      <FlatList
        className="flex-1"
        contentContainerClassName="gap-3 px-4 py-3"
        data={messages}
        inverted
        initialNumToRender={12}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        keyExtractor={(message) => message.id}
        ListEmptyComponent={
          !history.isPending ? (
            <View className="items-center gap-2 px-6 py-16">
              <Typography.Heading type="h2">
                Start the conversation
              </Typography.Heading>
              <Typography.Paragraph muted className="text-center">
                Messages are sent through your Wave Companion to Hermes.
              </Typography.Paragraph>
            </View>
          ) : null
        }
        ListFooterComponent={
          history.isPending ? (
            <Thinking label="Loading history…" />
          ) : chat.state.status === 'submitting' ? (
            <Thinking label="Hermes is thinking…" />
          ) : null
        }
        maxToRenderPerBatch={8}
        renderItem={renderItem}
        windowSize={9}
      />

      <KeyboardAvoider
        bottomInset={insets.bottom}
        className="flex-row items-end gap-2 border-t border-border bg-background px-4 pt-3"
        mode="dock"
        style={{ paddingBottom: Math.max(insets.bottom, 12) }}>
        <Input
          multiline
          accessibilityLabel="Message Hermes"
          containerClassName="flex-1"
          placeholder="Message Hermes"
          submitBehavior="submit"
          testID="chat-composer-input"
          value={input}
          onChangeText={setInput}
          onSubmitEditing={send}
        />
        {busy ? (
          <Button
            size="icon"
            variant="outline"
            accessibilityLabel="Stop Hermes response"
            disabled={chat.state.status === 'cancelling'}
            testID="chat-stop-button"
            onPress={() => void chat.stop()}>
            ■
          </Button>
        ) : (
          <>
            <Button
              size="icon"
              variant="outline"
              accessibilityLabel="Start live voice"
              testID="chat-voice-button"
              onPress={() =>
                router.push({
                  pathname: '/sessions/[sessionId]/voice',
                  params: { sessionId },
                })
              }>
              <MicIcon size={18} />
            </Button>
            <Button
              size="icon"
              accessibilityLabel="Send message to Hermes"
              disabled={!input.trim()}
              testID="chat-send-button"
              onPress={send}>
              <SendIcon size={18} />
            </Button>
          </>
        )}
      </KeyboardAvoider>
    </View>
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
            <Avatar
              accessibilityLabel="Hermes"
              fallback="H"
              size="sm"
            />
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
                  <Message.BubbleContent>
                    {part.text}
                  </Message.BubbleContent>
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
              <Shimmer textClassName="text-base">
                Hermes is thinking…
              </Shimmer>
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
  outputIsPreview: Extract<
    WaveChatPart,
    { type: 'task' }
  >['outputIsPreview'];
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
        status === 'error'
          ? 'border border-destructive/30'
          : '',
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
        <Avatar accessibilityLabel="Hermes" fallback="H" size="sm" />
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
