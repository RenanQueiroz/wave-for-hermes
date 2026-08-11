import {
  Column,
  Icon,
  Row,
  Shape,
  Spacer,
  Surface,
  Text,
  TextButton,
} from '@expo/ui/jetpack-compose';
import {
  background,
  border,
  clickable,
  clip,
  fillMaxWidth,
  height,
  padding,
  testID as testIDModifier,
  verticalScroll,
  weight,
} from '@expo/ui/jetpack-compose/modifiers';
import type { ImageSourcePropType } from 'react-native';

import { NativeIconButton } from '@/components/native-icon-button';
import { CHAT_COMPOSER_ICONS } from '@/features/chat/composer/icons';
import { ChatComposerInput } from '@/features/chat/composer/input';
import { NativeModelPill } from '@/features/chat/composer/model/pill';
import { nativeComposerSurfaceModifiers } from '@/features/chat/composer/surface';
import {
  composerHasAccessoryContent,
  trailingActionTestID,
  type ChatComposerNativeViewProps,
  type ComposerColors,
} from '@/features/chat/composer/view.types';
import type { SlashCommandRunResult } from '@/features/chat/composer/slash';
import type { WaveCommandCatalogEntry } from '@/services/gateway/gateway-commands';

export function ChatComposerNativeView(props: ChatComposerNativeViewProps) {
  const {
    action,
    blocked,
    busy,
    canDictate,
    colors,
    dictationStatus,
    inputEditable,
    inputRef,
    modelLabel,
    nativeSelection,
    nativeText,
    onAttachmentPress,
    onChangeText,
    onDictationPress,
    onInvokeTrailingAction,
    onModelPress,
    onSelectionChange,
    onSubmit,
    onSurfaceHeightChange,
    showModel,
  } = props;

  return (
    <Column
      horizontalAlignment="start"
      modifiers={[fillMaxWidth()]}
      verticalArrangement="top">
      <ComposerAccessoryContent {...props} />
      <Surface
        color={colors.opaqueMuted}
        shape={Shape.RoundedCorner({
          cornerRadii: {
            bottomEnd: 28,
            bottomStart: 28,
            topEnd: 28,
            topStart: 28,
          },
        })}
        modifiers={[
          fillMaxWidth(),
          testIDModifier('chat-composer-box'),
          ...nativeComposerSurfaceModifiers(onSurfaceHeightChange),
        ]}>
        <Column
          horizontalAlignment="start"
          modifiers={[fillMaxWidth(), padding(0, 0, 0, 10)]}
          verticalArrangement={{ spacedBy: 2 }}>
          <ChatComposerInput
            ref={inputRef}
            accessibilityLabel={
              busy ? 'Correct the current response' : 'Ask anything'
            }
            editable={inputEditable}
            foregroundColor={colors.foreground}
            mutedColor={colors.mutedForeground}
            placeholder={busy ? 'Add a correction' : 'Ask anything'}
            primaryColor={colors.primary}
            selection={nativeSelection}
            text={nativeText}
            testID="chat-composer-input"
            onChangeText={onChangeText}
            onSelectionChange={onSelectionChange}
            onSubmit={onSubmit}
          />
          <Row
            verticalAlignment="center"
            horizontalArrangement={{ spacedBy: 8 }}
            modifiers={[fillMaxWidth(), padding(12, 0, 12, 0)]}>
            <NativeIconButton
              accessibilityLabel="Add an attachment"
              backgroundColor={colors.secondary}
              disabled={busy || blocked}
              foregroundColor={colors.secondaryForeground}
              icon={CHAT_COMPOSER_ICONS.add}
              testID="chat-attachment-button"
              variant="tonal"
              onPress={onAttachmentPress}
            />
            {showModel ? (
              <NativeModelPill
                accessibilityLabel="Change the model for this conversation"
                backgroundColor={colors.secondary}
                disabled={blocked}
                foregroundColor={colors.secondaryForeground}
                label={modelLabel}
                testID="chat-model-pill"
                onPress={onModelPress}
              />
            ) : null}
            <Spacer modifiers={[weight(1)]} />
            {canDictate ? (
              <NativeIconButton
                accessibilityLabel={
                  dictationStatus === 'recording'
                    ? 'Stop dictating and insert the transcript'
                    : 'Dictate a message'
                }
                backgroundColor={
                  dictationStatus === 'recording'
                    ? colors.destructive
                    : colors.secondary
                }
                disabled={busy || blocked}
                foregroundColor={
                  dictationStatus === 'recording'
                    ? colors.primaryForeground
                    : colors.secondaryForeground
                }
                icon={CHAT_COMPOSER_ICONS.microphone}
                loading={dictationStatus === 'transcribing'}
                testID="chat-dictate-button"
                variant={dictationStatus === 'recording' ? 'filled' : 'tonal'}
                onPress={onDictationPress}
              />
            ) : null}
            <NativeIconButton
              accessibilityLabel={action.label}
              backgroundColor={
                action.kind === 'stop' ? colors.card : colors.primary
              }
              disabled={action.disabled}
              foregroundColor={
                action.kind === 'stop'
                  ? colors.foreground
                  : colors.primaryForeground
              }
              icon={trailingActionIcon(action.kind)}
              loading={action.loading}
              testID={trailingActionTestID(action.kind)}
              variant={action.kind === 'stop' ? 'tonal' : 'filled'}
              onPress={onInvokeTrailingAction}
            />
          </Row>
        </Column>
      </Surface>
    </Column>
  );
}

function ComposerAccessoryContent(props: ChatComposerNativeViewProps) {
  const {
    activePrompt,
    activityLabel,
    attachments,
    blocked,
    busy,
    colors,
    correctionError,
    dictationError,
    dictationStatus,
    draft,
    modelNotice,
    onAcceptSuggestion,
    onDismissAttachmentError,
    onDismissDictationError,
    onDismissSlashResult,
    onDismissTurnActionError,
    onRemoveAttachment,
    slashResolution,
    slashResult,
    suggestions,
    turnActionError,
  } = props;
  const hasContent = composerHasAccessoryContent(props);

  // Keep one native child mounted ahead of the input. Replacing the focused
  // Compose subtree when slash suggestions appear dismisses the IME.
  return (
    <Column
      horizontalAlignment="start"
      verticalArrangement={{ spacedBy: 8 }}
      modifiers={[fillMaxWidth(), padding(0, 0, 0, hasContent ? 8 : 0)]}>
      {attachments.attachments.length > 0 ? (
        <Column
          horizontalAlignment="start"
          verticalArrangement={{ spacedBy: 4 }}
          modifiers={[fillMaxWidth(), testIDModifier('chat-attachments')]}>
          {attachments.attachments.map((attachment) => (
            <Surface
              key={attachment.id}
              border={{ color: colors.border, width: 1 }}
              color={colors.card}
              shape={Shape.RoundedCorner({
                cornerRadii: {
                  bottomEnd: 14,
                  bottomStart: 14,
                  topEnd: 14,
                  topStart: 14,
                },
              })}
              modifiers={[fillMaxWidth()]}>
              <Row
                verticalAlignment="center"
                horizontalArrangement={{ spacedBy: 10 }}
                modifiers={[fillMaxWidth(), padding(8, 8, 8, 8)]}>
                <Icon
                  contentDescription={
                    attachment.part.type === 'image' ? 'Image' : 'Text file'
                  }
                  source={
                    (attachment.part.type === 'image'
                      ? CHAT_COMPOSER_ICONS.image
                      : CHAT_COMPOSER_ICONS.file) as ImageSourcePropType
                  }
                  size={18}
                  tint={colors.foreground}
                />
                <Column
                  horizontalAlignment="start"
                  verticalArrangement={{ spacedBy: 1 }}>
                  <Text
                    color={colors.foreground}
                    maxLines={1}
                    overflow="ellipsis"
                    style={{ fontSize: 14 }}>
                    {attachment.part.name}
                  </Text>
                  <Text
                    color={colors.mutedForeground}
                    maxLines={1}
                    overflow="ellipsis"
                    style={{ fontSize: 12 }}>
                    {attachment.description}
                  </Text>
                </Column>
                <Spacer modifiers={[weight(1)]} />
                <NativeIconButton
                  accessibilityLabel={`Remove ${attachment.part.name}`}
                  foregroundColor={colors.foreground}
                  icon={CHAT_COMPOSER_ICONS.remove}
                  iconSize={15}
                  testID={`remove-attachment-${attachment.id}`}
                  onPress={() => onRemoveAttachment(attachment.id)}
                />
              </Row>
            </Surface>
          ))}
        </Column>
      ) : null}

      {correctionError ? (
        <ComposerMessage
          colors={colors}
          destructive
          testID="chat-correction-error"
          text={`Correction not sent. ${correctionError}`}
        />
      ) : null}
      {attachments.error ? (
        <ComposerMessage
          colors={colors}
          destructive
          testID="attachment-error"
          text={attachments.error}
          onPress={onDismissAttachmentError}
        />
      ) : busy && attachments.attachments.length > 0 ? (
        <ComposerMessage
          centered
          colors={colors}
          testID="chat-correction-attachment-hint"
          text="Corrections are text only. Remove the attachments or wait for this response to finish."
        />
      ) : attachments.attachments.length > 0 && !draft.trim() ? (
        <ComposerMessage
          colors={colors}
          testID="chat-attachment-message-hint"
          text="Add a message to send the selected attachments."
        />
      ) : busy && activePrompt && draft.trim() ? (
        <ComposerMessage
          centered
          colors={colors}
          testID="chat-correction-prompt-hint"
          text="Answer the prompt above before correcting this response."
        />
      ) : null}

      {dictationStatus === 'recording' ? (
        <ComposerMessage
          centered
          colors={colors}
          testID="chat-dictation-hint"
          text="Listening — tap the microphone again to insert what you said."
        />
      ) : dictationError ? (
        <ComposerMessage
          centered
          colors={colors}
          testID="chat-dictation-error"
          text={`${dictationError} Tap to dismiss.`}
          onPress={onDismissDictationError}
        />
      ) : null}
      {modelNotice ? (
        <ComposerMessage
          centered
          colors={colors}
          testID="chat-model-notice"
          text={modelNotice}
        />
      ) : null}
      {turnActionError ? (
        <ComposerMessage
          centered
          colors={colors}
          testID="chat-turn-action-error"
          text={`${turnActionError} Tap to dismiss.`}
          onPress={onDismissTurnActionError}
        />
      ) : null}
      {blocked ? (
        <ComposerMessage
          centered
          colors={colors}
          testID="chat-composer-blocked-hint"
          text="Sending and live voice are paused until this conversation can refresh."
        />
      ) : null}
      {busy && activityLabel && !activePrompt ? (
        <ComposerMessage
          centered
          colors={colors}
          testID="chat-activity-status"
          text={activityLabel}
        />
      ) : null}
      {slashResolution ? (
        <Text
          color={colors.primary}
          style={{ fontSize: 12, fontWeight: '600' }}
          modifiers={[
            padding(8, 0, 8, 0),
            testIDModifier('chat-slash-highlight'),
          ]}>
          {`Recognized command: ${draft.trim().split(/\s/)[0]}`}
        </Text>
      ) : null}
      {suggestions.length > 0 ? (
        <SlashSuggestionList
          colors={colors}
          suggestions={suggestions}
          onAccept={onAcceptSuggestion}
        />
      ) : null}
      {slashResult ? (
        <SlashResult
          colors={colors}
          result={slashResult}
          onDismiss={onDismissSlashResult}
        />
      ) : null}
    </Column>
  );
}

function ComposerMessage({
  centered,
  colors,
  destructive,
  onPress,
  testID,
  text,
}: {
  centered?: boolean;
  colors: ComposerColors;
  destructive?: boolean;
  onPress?: () => void;
  testID: string;
  text: string;
}) {
  return (
    <Text
      color={destructive ? colors.destructive : colors.mutedForeground}
      style={{ fontSize: 12, textAlign: centered ? 'center' : 'left' }}
      modifiers={[
        fillMaxWidth(),
        padding(8, destructive ? 6 : 2, 8, destructive ? 6 : 2),
        testIDModifier(testID),
        ...(onPress ? [clickable(onPress)] : []),
      ]}>
      {text}
    </Text>
  );
}

function SlashSuggestionList({
  colors,
  onAccept,
  suggestions,
}: {
  colors: ComposerColors;
  onAccept(entry: WaveCommandCatalogEntry): void;
  suggestions: WaveCommandCatalogEntry[];
}) {
  const listHeight = Math.min(252, suggestions.length * 56);
  const shape = clip({ type: 'roundedCorner', radius: 16 });
  return (
    <Column
      horizontalAlignment="start"
      modifiers={[
        fillMaxWidth(),
        height(listHeight),
        shape,
        background(colors.card),
        border(1, colors.border),
        verticalScroll(),
        testIDModifier('chat-slash-suggestions'),
      ]}>
      {suggestions.map((entry) => {
        const testID = `chat-slash-suggestion-${entry.command.slice(1)}`;
        return (
          <TextButton
            key={entry.command}
            colors={{ contentColor: colors.foreground }}
            contentPadding={{ bottom: 7, end: 12, start: 12, top: 7 }}
            modifiers={[fillMaxWidth(), testIDModifier(testID)]}
            onClick={() => onAccept(entry)}>
            <Column
              horizontalAlignment="start"
              verticalArrangement={{ spacedBy: 1 }}
              modifiers={[fillMaxWidth()]}>
              <Text
                color={colors.foreground}
                maxLines={1}
                overflow="ellipsis"
                style={{ fontSize: 14, fontWeight: '600' }}>
                {`${entry.command}${entry.kind === 'skill' ? '  ·  skill' : ''}`}
              </Text>
              {entry.description ? (
                <Text
                  color={colors.mutedForeground}
                  maxLines={1}
                  overflow="ellipsis"
                  style={{ fontSize: 12 }}>
                  {entry.description}
                </Text>
              ) : null}
            </Column>
          </TextButton>
        );
      })}
    </Column>
  );
}

function SlashResult({
  colors,
  onDismiss,
  result,
}: {
  colors: ComposerColors;
  onDismiss(): void;
  result: SlashCommandRunResult;
}) {
  return (
    <Surface
      border={{ color: colors.border, width: 1 }}
      color={colors.card}
      shape={Shape.RoundedCorner({
        cornerRadii: {
          bottomEnd: 16,
          bottomStart: 16,
          topEnd: 16,
          topStart: 16,
        },
      })}
      modifiers={[fillMaxWidth(), testIDModifier('chat-slash-result')]}>
      <Column
        horizontalAlignment="start"
        verticalArrangement={{ spacedBy: 4 }}
        modifiers={[fillMaxWidth(), padding(10, 10, 10, 10)]}>
        <Row verticalAlignment="center" modifiers={[fillMaxWidth()]}>
          <Text
            color={colors.foreground}
            style={{ fontSize: 12, fontWeight: '600' }}>
            {result.title}
          </Text>
          <Spacer modifiers={[weight(1)]} />
          <NativeIconButton
            accessibilityLabel="Dismiss command result"
            foregroundColor={colors.foreground}
            icon={CHAT_COMPOSER_ICONS.remove}
            iconSize={14}
            testID="chat-slash-result-dismiss"
            onPress={onDismiss}
          />
        </Row>
        {result.output ? (
          <Column modifiers={[fillMaxWidth(), height(120), verticalScroll()]}>
            <Text
              color={colors.mutedForeground}
              style={{ fontFamily: 'monospace', fontSize: 11, lineHeight: 16 }}>
              {result.output}
            </Text>
          </Column>
        ) : null}
      </Column>
    </Surface>
  );
}

function trailingActionIcon(
  kind: ChatComposerNativeViewProps['action']['kind'],
) {
  switch (kind) {
    case 'run':
      return CHAT_COMPOSER_ICONS.run;
    case 'stop':
      return CHAT_COMPOSER_ICONS.stop;
    case 'live':
      return CHAT_COMPOSER_ICONS.liveVoice;
    case 'correct':
    case 'send':
    case 'correction-loading':
      return CHAT_COMPOSER_ICONS.send;
  }
}
