import {
  Button,
  HStack,
  Image,
  ScrollView,
  Spacer,
  Text,
  VStack,
} from '@expo/ui/swift-ui';
import {
  accessibilityIdentifier,
  accessibilityLabel,
  background,
  buttonStyle,
  clipShape,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  multilineTextAlignment,
  onTapGesture,
  padding,
  shapes,
  strokeBorder,
} from '@expo/ui/swift-ui/modifiers';

import { NativeIconButton } from '@/components/native-icon-button';
import { AttachmentMenu } from '@/features/chat/composer/attachment-menu';
import { CHAT_COMPOSER_ICONS } from '@/features/chat/composer/icons';
import { ChatComposerInput } from '@/features/chat/composer/input';
import { NativeModelPill } from '@/features/chat/composer/model/pill';
import { nativeComposerSurfaceModifiers } from '@/features/chat/composer/surface';
import type { SlashCommandRunResult } from '@/features/chat/composer/slash';
import {
  composerHasAccessoryContent,
  trailingActionTestID,
  type ChatComposerNativeViewProps,
  type ComposerColors,
} from '@/features/chat/composer/view.types';
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
    onAttachFile,
    onAttachImage,
    onAttachPhoto,
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
    <VStack
      alignment="leading"
      spacing={0}
      modifiers={[frame({ alignment: 'leading', maxWidth: Infinity })]}>
      <ComposerAccessoryContent {...props} />
      <VStack
        alignment="leading"
        spacing={2}
        modifiers={[
          frame({ alignment: 'leading', maxWidth: Infinity }),
          background(
            'clear',
            shapes.roundedRectangle({
              cornerRadius: 28,
              roundedCornerStyle: 'continuous',
            }),
          ),
          clipShape('roundedRectangle', 28),
          padding({ bottom: 10 }),
          ...nativeComposerSurfaceModifiers(onSurfaceHeightChange),
        ]}>
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
        <HStack
          alignment="center"
          spacing={8}
          modifiers={[
            frame({ alignment: 'leading', maxWidth: Infinity }),
            padding({ horizontal: 12 }),
          ]}>
          <AttachmentMenu
            colors={colors}
            disabled={busy || blocked}
            onPickFile={onAttachFile}
            onPickImage={onAttachImage}
            onTakePhoto={onAttachPhoto}
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
          <Spacer />
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
        </HStack>
      </VStack>
    </VStack>
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

  return (
    <VStack
      alignment="leading"
      spacing={8}
      modifiers={[
        frame({ alignment: 'leading', maxWidth: Infinity }),
        padding({ bottom: hasContent ? 8 : 0 }),
      ]}>
      {attachments.attachments.length > 0 ? (
        <VStack
          alignment="leading"
          spacing={4}
          modifiers={[frame({ alignment: 'leading', maxWidth: Infinity })]}>
          {attachments.attachments.map((attachment) => (
            <HStack
              key={attachment.id}
              alignment="center"
              spacing={10}
              modifiers={[
                frame({ alignment: 'leading', maxWidth: Infinity }),
                padding({ all: 8 }),
                background(
                  colors.card,
                  shapes.roundedRectangle({
                    cornerRadius: 14,
                    roundedCornerStyle: 'continuous',
                  }),
                ),
                strokeBorder({
                  color: colors.border,
                  cornerRadius: 14,
                  shape: 'roundedRectangle',
                  style: { lineWidth: 1 },
                }),
              ]}>
              <Image
                color={colors.foreground}
                size={18}
                systemName={
                  attachment.part.type === 'image'
                    ? CHAT_COMPOSER_ICONS.image
                    : CHAT_COMPOSER_ICONS.file
                }
              />
              <VStack alignment="leading" spacing={1}>
                <Text
                  modifiers={[
                    foregroundStyle(colors.foreground),
                    font({ size: 14 }),
                    lineLimit(1),
                  ]}>
                  {attachment.part.name}
                </Text>
                <Text
                  modifiers={[
                    foregroundStyle(colors.mutedForeground),
                    font({ size: 12 }),
                    lineLimit(1),
                  ]}>
                  {attachment.description}
                </Text>
              </VStack>
              <Spacer />
              <NativeIconButton
                accessibilityLabel={`Remove ${attachment.part.name}`}
                foregroundColor={colors.foreground}
                icon={CHAT_COMPOSER_ICONS.remove}
                iconSize={15}
                testID={`remove-attachment-${attachment.id}`}
                onPress={() => onRemoveAttachment(attachment.id)}
              />
            </HStack>
          ))}
        </VStack>
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
          modifiers={[
            foregroundStyle(colors.primary),
            font({ size: 12, weight: 'semibold' }),
            padding({ horizontal: 8 }),
            accessibilityIdentifier('chat-slash-highlight'),
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
    </VStack>
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
      modifiers={[
        frame({
          alignment: centered ? 'center' : 'leading',
          maxWidth: Infinity,
        }),
        foregroundStyle(
          destructive ? colors.destructive : colors.mutedForeground,
        ),
        font({ size: 12 }),
        multilineTextAlignment(centered ? 'center' : 'leading'),
        padding({ horizontal: 8, vertical: destructive ? 6 : 2 }),
        accessibilityIdentifier(testID),
        ...(onPress ? [onTapGesture(onPress)] : []),
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
  return (
    <ScrollView
      showsIndicators
      modifiers={[
        frame({ height: listHeight, maxWidth: Infinity }),
        background(
          colors.card,
          shapes.roundedRectangle({
            cornerRadius: 16,
            roundedCornerStyle: 'continuous',
          }),
        ),
        strokeBorder({
          color: colors.border,
          cornerRadius: 16,
          shape: 'roundedRectangle',
          style: { lineWidth: 1 },
        }),
        clipShape('roundedRectangle', 16),
      ]}>
      <VStack
        alignment="leading"
        spacing={2}
        modifiers={[frame({ alignment: 'leading', maxWidth: Infinity })]}>
        {suggestions.map((entry) => {
          const testID = `chat-slash-suggestion-${entry.command.slice(1)}`;
          return (
            <Button
              key={entry.command}
              onPress={() => onAccept(entry)}
              modifiers={[
                buttonStyle('plain'),
                frame({ alignment: 'leading', maxWidth: Infinity }),
                padding({ horizontal: 12, vertical: 7 }),
                accessibilityLabel(`Use ${entry.command}`),
                accessibilityIdentifier(testID),
              ]}>
              <VStack
                alignment="leading"
                spacing={1}
                modifiers={[
                  frame({ alignment: 'leading', maxWidth: Infinity }),
                ]}>
                <Text
                  modifiers={[
                    foregroundStyle(colors.foreground),
                    font({ size: 14, weight: 'semibold' }),
                    lineLimit(1),
                  ]}>
                  {`${entry.command}${entry.kind === 'skill' ? '  ·  skill' : ''}`}
                </Text>
                {entry.description ? (
                  <Text
                    modifiers={[
                      foregroundStyle(colors.mutedForeground),
                      font({ size: 12 }),
                      lineLimit(1),
                    ]}>
                    {entry.description}
                  </Text>
                ) : null}
              </VStack>
            </Button>
          );
        })}
      </VStack>
    </ScrollView>
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
    <VStack
      alignment="leading"
      spacing={4}
      modifiers={[
        frame({ alignment: 'leading', maxWidth: Infinity }),
        padding({ all: 10 }),
        background(
          colors.card,
          shapes.roundedRectangle({
            cornerRadius: 16,
            roundedCornerStyle: 'continuous',
          }),
        ),
        strokeBorder({
          color: colors.border,
          cornerRadius: 16,
          shape: 'roundedRectangle',
          style: { lineWidth: 1 },
        }),
      ]}>
      <HStack
        alignment="center"
        spacing={4}
        modifiers={[frame({ alignment: 'leading', maxWidth: Infinity })]}>
        <Text
          modifiers={[
            foregroundStyle(colors.foreground),
            font({ size: 12, weight: 'semibold' }),
          ]}>
          {result.title}
        </Text>
        <Spacer />
        <NativeIconButton
          accessibilityLabel="Dismiss command result"
          foregroundColor={colors.foreground}
          icon={CHAT_COMPOSER_ICONS.remove}
          iconSize={14}
          testID="chat-slash-result-dismiss"
          onPress={onDismiss}
        />
      </HStack>
      {result.output ? (
        <ScrollView modifiers={[frame({ height: 120 })]}>
          <Text
            modifiers={[
              foregroundStyle(colors.mutedForeground),
              font({ design: 'monospaced', size: 11 }),
            ]}>
            {result.output}
          </Text>
        </ScrollView>
      ) : null}
    </VStack>
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
