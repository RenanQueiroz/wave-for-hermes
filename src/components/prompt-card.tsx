/**
 * Inline surface for a mid-turn agent prompt: tool approval, a clarifying
 * question (single, multi-select, or a batch answered together), or a
 * secret/password request (which Wave always declines — the phone never
 * collects credentials).
 *
 * Shared by the chat screen and gateway voice mode so both render prompts
 * identically. Content is inert per the product contract: the command crosses
 * as a bounded detail inside a CodeBlock, never as Markdown.
 */
import type { WavePromptQuestion } from '@wave/contracts';
import {
  Alert,
  Button,
  CodeBlock,
  Input,
  KeyboardAvoider,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from 'panelui-native';
import { useState } from 'react';
import { View } from 'react-native';

import type { WaveChatPrompt } from '@/features/chat/chat-state';
import {
  clarifyAnswerValue,
  promptChoicePresentation,
  stageLockedClarifyAnswers,
  type StagedClarifyAnswer,
} from '@/features/chat/prompt-choice';

export type PromptCardResponse =
  | { choice: string; kind: 'approval' }
  /** An empty answer skips the question (the gateway's own cancel). */
  | { answer: string; kind: 'clarify' }
  | {
      answers: { answer: string; questionId: string }[];
      kind: 'clarify-batch';
    }
  | { kind: 'decline' };

const APPROVAL_LABELS: Record<string, string> = {
  always: 'Always allow',
  deny: 'Deny',
  once: 'Allow once',
  session: 'Allow this chat',
};

function promptTitle(prompt: WaveChatPrompt): string {
  switch (prompt.kind) {
    case 'approval':
      return 'Hermes needs your approval';
    case 'clarify':
      return prompt.questions
        ? 'Hermes has a few questions'
        : 'Hermes has a question';
    case 'mcp-setup':
      return 'Hermes proposed an integration';
    case 'secret':
      return 'Hermes asked for a secret';
    case 'sudo':
      return 'Hermes asked for a password';
  }
}

const EMPTY_STAGE: StagedClarifyAnswer = { choices: [], draft: '' };

function ChoiceToggles({
  choices,
  disabled,
  multiSelect,
  onChange,
  selected,
  testIDPrefix,
}: {
  choices: readonly string[];
  disabled: boolean;
  multiSelect: boolean;
  onChange(selected: string[]): void;
  selected: string[];
  testIDPrefix: string;
}) {
  return (
    <ToggleButtonGroup
      className="flex-row flex-wrap gap-2"
      disabled={disabled}
      selectionMode={multiSelect ? 'multiple' : 'single'}
      size="sm"
      value={selected}
      onValueChange={onChange}>
      {choices.map((choice) => {
        const presentation = promptChoicePresentation(choice);
        return (
          <ToggleButton
            key={choice}
            id={choice}
            accessibilityLabel={`${presentation.label}${presentation.recommended ? ', recommended' : ''}`}
            testID={`${testIDPrefix}-${choice}`}>
            {presentation.recommended
              ? `${presentation.label} · Recommended`
              : presentation.label}
          </ToggleButton>
        );
      })}
    </ToggleButtonGroup>
  );
}

function SingleClarify({
  busy,
  onRespond,
  prompt,
  setAnswerFocused,
}: {
  busy: boolean;
  onRespond: (response: PromptCardResponse) => void;
  prompt: WaveChatPrompt;
  setAnswerFocused(focused: boolean): void;
}) {
  const [answer, setAnswer] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const multiSelect = prompt.multiSelect === true && prompt.choices.length > 0;
  return (
    <View className="mt-3 w-full gap-2">
      {multiSelect ? (
        <ChoiceToggles
          choices={prompt.choices}
          disabled={busy}
          multiSelect
          selected={selected}
          testIDPrefix="chat-prompt-choice"
          onChange={setSelected}
        />
      ) : prompt.choices.length > 0 ? (
        <View className="flex-row flex-wrap gap-2">
          {prompt.choices.map((choice) => {
            const presentation = promptChoicePresentation(choice);
            return (
              <Button
                key={choice}
                size="sm"
                accessibilityLabel={`Answer: ${presentation.label}${presentation.recommended ? ', recommended' : ''}`}
                disabled={busy}
                testID={`chat-prompt-choice-${choice}`}
                variant={presentation.recommended ? 'primary' : 'outline'}
                onPress={() => onRespond({ answer: choice, kind: 'clarify' })}>
                {presentation.recommended
                  ? `${presentation.label} · Recommended`
                  : presentation.label}
              </Button>
            );
          })}
        </View>
      ) : null}
      {multiSelect ? (
        <Button
          size="sm"
          accessibilityLabel="Send selected answers"
          className="self-start"
          disabled={busy || selected.length === 0}
          testID="chat-prompt-send-selected"
          onPress={() => {
            const value = clarifyAnswerValue({
              choices: selected,
              draft: '',
              multiSelect: true,
            });
            if (value !== undefined) {
              onRespond({ answer: value, kind: 'clarify' });
            }
          }}>
          {selected.length > 1 ? `Send ${selected.length} selected` : 'Send'}
        </Button>
      ) : null}
      {/* Stacked rather than side-by-side: inside Alert.Content a `flex-1`
          input does not reserve room for a trailing button, and the button
          clips off the card's right edge. */}
      {prompt.allowsFreeText ? (
        <View className="w-full gap-2">
          <Input
            accessibilityLabel="Answer Hermes"
            className="w-full"
            editable={!busy}
            placeholder={
              prompt.choices.length > 0
                ? 'Or type an answer…'
                : 'Type an answer…'
            }
            testID="chat-prompt-answer-input"
            value={answer}
            onBlur={() => setAnswerFocused(false)}
            onChangeText={setAnswer}
            onFocus={() => setAnswerFocused(true)}
          />
          <View className="flex-row flex-wrap gap-2">
            <Button
              size="sm"
              accessibilityLabel="Send answer"
              disabled={busy || !answer.trim()}
              testID="chat-prompt-answer-send"
              onPress={() =>
                onRespond({ answer: answer.trim(), kind: 'clarify' })
              }>
              Send
            </Button>
            <Button
              size="sm"
              accessibilityLabel="Skip this question"
              disabled={busy}
              testID="chat-prompt-skip"
              variant="ghost"
              onPress={() => onRespond({ answer: '', kind: 'clarify' })}>
              Skip
            </Button>
          </View>
        </View>
      ) : null}
    </View>
  );
}

function BatchClarify({
  busy,
  onRespond,
  questions,
  setAnswerFocused,
}: {
  busy: boolean;
  onRespond: (response: PromptCardResponse) => void;
  questions: readonly WavePromptQuestion[];
  setAnswerFocused(focused: boolean): void;
}) {
  const [staged, setStaged] = useState<Record<string, StagedClarifyAnswer>>(
    () => stageLockedClarifyAnswers(questions),
  );
  const stageFor = (questionId: string) => staged[questionId] ?? EMPTY_STAGE;
  const answerFor = (question: WavePromptQuestion) =>
    clarifyAnswerValue({
      ...stageFor(question.questionId),
      multiSelect: question.multiSelect,
    });
  const answeredCount = questions.filter(
    (question) => answerFor(question) !== undefined,
  ).length;
  const allAnswered = answeredCount === questions.length;
  const update = (questionId: string, patch: Partial<StagedClarifyAnswer>) =>
    setStaged((current) => ({
      ...current,
      [questionId]: { ...(current[questionId] ?? EMPTY_STAGE), ...patch },
    }));
  return (
    <View className="mt-3 w-full gap-4" testID="chat-prompt-batch">
      {questions.map((question, index) => {
        const stage = stageFor(question.questionId);
        return (
          <View key={question.questionId} className="w-full gap-2">
            <Typography.Paragraph
              accessibilityRole="header"
              className="font-medium"
              testID={`chat-prompt-question-${question.questionId}`}
              type="small">
              {`${index + 1}. ${question.question}`}
            </Typography.Paragraph>
            {question.choices.length > 0 ? (
              <ChoiceToggles
                choices={question.choices}
                disabled={busy}
                multiSelect={question.multiSelect}
                selected={stage.choices}
                testIDPrefix={`chat-prompt-question-${question.questionId}-choice`}
                onChange={(choices) =>
                  update(question.questionId, { choices, draft: '' })
                }
              />
            ) : null}
            <Input
              accessibilityLabel={`Answer question ${index + 1}`}
              className="w-full"
              editable={!busy}
              placeholder={
                question.choices.length > 0
                  ? 'Or type an answer…'
                  : 'Type an answer…'
              }
              testID={`chat-prompt-question-${question.questionId}-input`}
              value={stage.draft}
              onBlur={() => setAnswerFocused(false)}
              onChangeText={(draft) =>
                update(question.questionId, { choices: [], draft })
              }
              onFocus={() => setAnswerFocused(true)}
            />
          </View>
        );
      })}
      <Typography.Paragraph
        className="text-muted-foreground"
        testID="chat-prompt-batch-progress"
        type="small">
        {`${answeredCount} of ${questions.length} answered`}
      </Typography.Paragraph>
      <View className="flex-row flex-wrap gap-2">
        <Button
          size="sm"
          accessibilityLabel="Send all answers"
          disabled={busy || !allAnswered}
          testID="chat-prompt-confirm"
          onPress={() =>
            onRespond({
              answers: questions.map((question) => ({
                answer: answerFor(question) ?? '',
                questionId: question.questionId,
              })),
              kind: 'clarify-batch',
            })
          }>
          Send answers
        </Button>
        <Button
          size="sm"
          accessibilityLabel="Skip these questions"
          disabled={busy}
          testID="chat-prompt-skip"
          variant="ghost"
          onPress={() => onRespond({ answer: '', kind: 'clarify' })}>
          Skip
        </Button>
      </View>
    </View>
  );
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
  const [answerFocused, setAnswerFocused] = useState(false);
  const declineOnly =
    prompt.kind === 'mcp-setup' ||
    prompt.kind === 'secret' ||
    prompt.kind === 'sudo';

  return (
    <Alert testID="chat-prompt-card">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>{promptTitle(prompt)}</Alert.Title>
        {prompt.question || prompt.description ? (
          <Alert.Description>
            {prompt.question ?? prompt.description}
          </Alert.Description>
        ) : null}
        {declineOnly ? (
          <Alert.Description>
            {prompt.kind === 'mcp-setup'
              ? 'Wave does not install, enable, or authorize Hermes integrations. Decline and manage it through Hermes Desktop instead.'
              : 'Wave never enters secrets from the phone. Decline and provide it through a trusted Hermes surface instead.'}
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
          // The answer inputs and their buttons lift together, gated on an
          // input's own focus. A no-op inside the chat screen's docked
          // composer stack (the overlap is already zero there); on the voice
          // screen — which has no other keyboard handling — it keeps the
          // whole answer section clear of the keyboard. Keyed by prompt so a
          // new question never inherits a previous one's staged answers.
          <KeyboardAvoider active={answerFocused}>
            {prompt.questions ? (
              <BatchClarify
                key={prompt.promptId}
                busy={busy}
                questions={prompt.questions}
                setAnswerFocused={setAnswerFocused}
                onRespond={onRespond}
              />
            ) : (
              <SingleClarify
                key={prompt.promptId}
                busy={busy}
                prompt={prompt}
                setAnswerFocused={setAnswerFocused}
                onRespond={onRespond}
              />
            )}
          </KeyboardAvoider>
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
