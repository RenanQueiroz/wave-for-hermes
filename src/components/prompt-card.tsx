/**
 * Inline surface for a mid-turn agent prompt: tool approval, a clarifying
 * question, or a secret/password request (which Wave always declines — the
 * phone never collects credentials).
 *
 * Shared by the chat screen and gateway voice mode so both render prompts
 * identically. Content is inert per the product contract: the command crosses
 * as a bounded detail inside a CodeBlock, never as Markdown.
 */
import {
  Alert,
  Button,
  CodeBlock,
  Input,
  KeyboardAvoider,
  Typography,
} from 'panelui-native';
import { useState } from 'react';
import { View } from 'react-native';

import type { WaveChatPrompt } from '@/features/chat/chat-state';

export type PromptCardResponse =
  | { choice: string; kind: 'approval' }
  | { answer: string; kind: 'clarify' }
  | { kind: 'decline' };

const APPROVAL_LABELS: Record<string, string> = {
  always: 'Always allow',
  deny: 'Deny',
  once: 'Allow once',
  session: 'Allow this chat',
};

function promptTitle(kind: WaveChatPrompt['kind']): string {
  switch (kind) {
    case 'approval':
      return 'Hermes needs your approval';
    case 'clarify':
      return 'Hermes has a question';
    case 'secret':
      return 'Hermes asked for a secret';
    case 'sudo':
      return 'Hermes asked for a password';
  }
}

export function PromptCard({
  busy,
  error,
  onRespond,
  prompt,
}: {
  busy: boolean;
  error?: string;
  onRespond: (response: PromptCardResponse) => void;
  prompt: WaveChatPrompt;
}) {
  const [answer, setAnswer] = useState('');
  const [answerFocused, setAnswerFocused] = useState(false);
  const declineOnly = prompt.kind === 'secret' || prompt.kind === 'sudo';

  return (
    <Alert testID="chat-prompt-card">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>{promptTitle(prompt.kind)}</Alert.Title>
        {prompt.question || prompt.description ? (
          <Alert.Description>
            {prompt.question ?? prompt.description}
          </Alert.Description>
        ) : null}
        {declineOnly ? (
          <Alert.Description>
            Wave never enters secrets from the phone. Decline and provide it
            through a trusted Hermes surface instead.
          </Alert.Description>
        ) : null}

        {prompt.command ? (
          <View className="mt-2 w-full">
            <CodeBlock
              className="w-full"
              code={prompt.command.text}
              language="text"
              testID="chat-prompt-command">
              <CodeBlock.Header>
                <CodeBlock.Filename>
                  {prompt.command.truncated
                    ? 'Requested command (truncated)'
                    : 'Requested command'}
                </CodeBlock.Filename>
              </CodeBlock.Header>
            </CodeBlock>
          </View>
        ) : null}

        {prompt.kind === 'approval' ? (
          <View className="mt-3 flex-row flex-wrap gap-2">
            {prompt.choices.map((choice) => (
              <Button
                key={choice}
                size="sm"
                accessibilityLabel={APPROVAL_LABELS[choice] ?? choice}
                disabled={busy}
                testID={`chat-prompt-choice-${choice}`}
                variant={choice === 'deny' ? 'destructive' : 'outline'}
                onPress={() => onRespond({ choice, kind: 'approval' })}>
                {APPROVAL_LABELS[choice] ?? choice}
              </Button>
            ))}
          </View>
        ) : null}

        {prompt.kind === 'clarify' ? (
          <View className="mt-3 w-full gap-2">
            {prompt.choices.length > 0 ? (
              <View className="flex-row flex-wrap gap-2">
                {prompt.choices.map((choice) => (
                  <Button
                    key={choice}
                    size="sm"
                    accessibilityLabel={`Answer: ${choice}`}
                    disabled={busy}
                    testID={`chat-prompt-choice-${choice}`}
                    variant="outline"
                    onPress={() =>
                      onRespond({ answer: choice, kind: 'clarify' })
                    }>
                    {choice}
                  </Button>
                ))}
              </View>
            ) : null}
            {/* Stacked rather than side-by-side: inside Alert.Content a
                `flex-1` input does not reserve room for a trailing button,
                and the button clips off the card's right edge. */}
            {prompt.allowsFreeText ? (
              // The input and its Send button lift together, gated on the
              // input's own focus. A no-op inside the chat screen's docked
              // composer stack (the overlap is already zero there); on the
              // voice screen — which has no other keyboard handling — it
              // keeps the whole answer section clear of the keyboard.
              <KeyboardAvoider active={answerFocused}>
                <View className="w-full gap-2">
                  <Input
                    accessibilityLabel="Answer Hermes"
                    className="w-full"
                    editable={!busy}
                    placeholder="Type an answer…"
                    testID="chat-prompt-answer-input"
                    value={answer}
                    onBlur={() => setAnswerFocused(false)}
                    onChangeText={setAnswer}
                    onFocus={() => setAnswerFocused(true)}
                  />
                  <Button
                    size="sm"
                    accessibilityLabel="Send answer"
                    className="self-start"
                    disabled={busy || !answer.trim()}
                    testID="chat-prompt-answer-send"
                    onPress={() =>
                      onRespond({ answer: answer.trim(), kind: 'clarify' })
                    }>
                    Send
                  </Button>
                </View>
              </KeyboardAvoider>
            ) : null}
          </View>
        ) : null}

        {declineOnly ? (
          <View className="mt-3 flex-row">
            <Button
              size="sm"
              accessibilityLabel="Decline this request"
              disabled={busy}
              testID="chat-prompt-decline"
              variant="destructive"
              onPress={() => onRespond({ kind: 'decline' })}>
              Decline
            </Button>
          </View>
        ) : null}

        {error ? (
          <Typography.Paragraph
            className="mt-2 text-destructive"
            testID="chat-prompt-error"
            type="small">
            {error}
          </Typography.Paragraph>
        ) : null}
      </Alert.Content>
    </Alert>
  );
}
