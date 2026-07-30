import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect } from 'expo-router';
import {
  Alert,
  Avatar,
  Button,
  Input,
  KeyboardAvoider,
  Message,
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
import { FlatList, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useWaveConnection } from '@/features/connection/connection-provider';
import {
  historyToWaveChatMessages,
  type WaveChatMessage,
} from '@/features/chat/chat-state';
import { useWaveChat } from '@/features/chat/use-wave-chat';
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
      queryClient.fetchQuery({
        queryFn: ({ signal }) =>
          client.getSessionHistory(sessionId, signal),
        queryKey: historyKey,
        staleTime: 0,
      }),
    [client, historyKey, queryClient, sessionId],
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
          <Button
            size="icon"
            accessibilityLabel="Send message to Hermes"
            disabled={!input.trim()}
            testID="chat-send-button"
            onPress={send}>
            <SendIcon size={18} />
          </Button>
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
            if (part.type === 'text') {
              return (
                <Message.Bubble key={`${message.id}-text-${index}`}>
                  <Message.BubbleContent>
                    {part.text}
                  </Message.BubbleContent>
                </Message.Bubble>
              );
            }
            return (
              <Task
                key={part.id}
                status={part.status}
                testID={`chat-task-${part.id}`}>
                <Task.Trigger title={part.title} />
                <Task.Content>
                  <Task.Item>
                    {taskDescription(part.status)}
                  </Task.Item>
                </Task.Content>
              </Task>
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

function taskDescription(
  status: 'complete' | 'error' | 'pending' | 'running',
) {
  switch (status) {
    case 'pending':
    case 'running':
      return 'Hermes is working';
    case 'complete':
      return 'Completed by Hermes';
    case 'error':
      return 'Hermes could not complete this step';
  }
}
