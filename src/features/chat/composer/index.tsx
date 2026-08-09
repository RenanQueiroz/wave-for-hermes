import {
  BottomSheet,
  Button,
  Column,
  Icon,
  List,
  Picker,
  Row,
  ScrollView,
  Spacer,
  Switch,
  Text,
  useNativeState,
  type IconName,
} from '@expo/ui';
import type { WaveTurnInput } from '@wave/contracts';
import { useRouter } from 'expo-router';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Keyboard } from 'react-native';
import { useCSSVariable } from 'uniwind';

import { useChatAttachments } from '@/features/chat/composer/attachments';
import { ChatComposerDock } from '@/features/chat/composer/dock';
import { CHAT_COMPOSER_ICONS } from '@/features/chat/composer/icons';
import { NativeComposerIconButton } from '@/features/chat/composer/icons/button';
import { ChatComposerHost } from '@/features/chat/composer/host';
import { ChatComposerInput } from '@/features/chat/composer/input';
import type { ChatComposerInputRef } from '@/features/chat/composer/input.types';
import {
  nativeAccessibilityModifiers,
  nativeContainerTestIDModifiers,
  nativeFillWidthModifiers,
} from '@/features/chat/composer/modifiers';
import {
  appendDictationTranscript,
  displayModelName,
  inferComposerSelectionAfterTextChange,
  projectComposerDraft,
  replaceSlashSuggestion,
  resolveComposerAction,
  restoredCorrectionDraft,
} from '@/features/chat/composer/state';
import {
  MODEL_EFFORT_LABELS,
  modelOptionDescription,
  useSessionModelPicker,
  type SessionModelPickerController,
} from '@/features/chat/composer/model/picker';
import { NativeModelConfirmation } from '@/features/chat/composer/model/confirmation';
import { NativeModelPill } from '@/features/chat/composer/model/pill';
import {
  useSlashComposer,
  type SlashCommandRunResult,
} from '@/features/chat/composer/slash';
import {
  resolveSlashSubmission,
  type WaveSlashResolution,
} from '@/features/chat/slash-commands';
import type { WaveCorrectionResult } from '@/features/chat/use-wave-chat';
import { useDictation } from '@/features/voice/use-dictation';
import { useTheme } from '@/hooks/use-theme';
import type { GatewayClient } from '@/services/gateway/gateway-client';
import type { WaveCommandCatalogEntry } from '@/services/gateway/gateway-commands';
import { modelFamilies } from '@/services/gateway/gateway-models';
import type { WaveChatClient } from '@/services/wave/wave-chat-client';

const SHEET_TO_PICKER_DELAY_MS = 300;

export interface ChatComposerProps {
  activePrompt: boolean;
  activityLabel?: string;
  baseUrl: string;
  blocked: boolean;
  busy: boolean;
  canDictate: boolean;
  cancelling: boolean;
  client: WaveChatClient;
  connectionId: string;
  correctionError?: string;
  correcting: boolean;
  gatewayClient?: GatewayClient;
  onCorrect(text: string): Promise<WaveCorrectionResult>;
  onDismissTurnActionError(): void;
  onSend(input: WaveTurnInput, optimisticText?: string): Promise<void>;
  onStop(): Promise<void>;
  prompt?: ReactNode;
  sessionId: string;
  turnActionError?: string;
}

interface ComposerColors {
  background: string;
  border: string;
  card: string;
  destructive: string;
  foreground: string;
  muted: string;
  mutedForeground: string;
  primary: string;
  primaryForeground: string;
  secondary: string;
  secondaryForeground: string;
}

export function ChatComposer({
  activePrompt,
  activityLabel,
  baseUrl,
  blocked,
  busy,
  canDictate,
  cancelling,
  client,
  connectionId,
  correctionError,
  correcting,
  gatewayClient,
  onCorrect,
  onDismissTurnActionError,
  onSend,
  onStop,
  prompt,
  sessionId,
  turnActionError,
}: ChatComposerProps) {
  const router = useRouter();
  const theme = useTheme();
  const [
    borderToken,
    cardToken,
    destructiveToken,
    mutedToken,
    primaryForegroundToken,
    secondaryToken,
    secondaryForegroundToken,
  ] = useCSSVariable([
    '--color-border',
    '--color-card',
    '--color-destructive',
    '--color-muted',
    '--color-primary-foreground',
    '--color-secondary',
    '--color-secondary-foreground',
  ]);
  const colors = useMemo<ComposerColors>(
    () => ({
      background: theme.background,
      border: resolveColor(borderToken, theme.backgroundSelected),
      card: resolveColor(cardToken, theme.backgroundElement),
      destructive: resolveColor(destructiveToken, '#ef4444'),
      foreground: theme.text,
      muted: resolveColor(mutedToken, theme.backgroundElement),
      mutedForeground: theme.textSecondary,
      primary: theme.primary,
      primaryForeground: resolveColor(primaryForegroundToken, theme.background),
      secondary: resolveColor(secondaryToken, theme.backgroundElement),
      secondaryForeground: resolveColor(secondaryForegroundToken, theme.text),
    }),
    [
      borderToken,
      cardToken,
      destructiveToken,
      mutedToken,
      primaryForegroundToken,
      secondaryForegroundToken,
      secondaryToken,
      theme,
    ],
  );

  const nativeText = useNativeState('');
  const nativeSelection = useNativeState({ end: 0, start: 0 });
  const inputRef = useRef<ChatComposerInputRef>(null);
  const draftRef = useRef('');
  const selectionRef = useRef({ end: 0, start: 0 });
  const sessionRef = useRef(sessionId);
  const mountedRef = useRef(true);
  const attachmentPickerTimer = useRef<
    ReturnType<typeof setTimeout> | undefined
  >(undefined);
  const [draft, setDraft] = useState('');
  const [caret, setCaret] = useState(0);
  const [attachmentSheetOpen, setAttachmentSheetOpen] = useState(false);
  const attachments = useChatAttachments();
  const dictation = useDictation({ client: gatewayClient });
  const model = useSessionModelPicker({
    baseUrl,
    connectionId,
    gatewayClient,
    sessionId,
  });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (attachmentPickerTimer.current) {
        clearTimeout(attachmentPickerTimer.current);
      }
    };
  }, []);

  // ChatScreen keys the composer by session. Keep the explicit guard too: a
  // delayed correction/dictation result must never write into another chat.
  useEffect(() => {
    sessionRef.current = sessionId;
  }, [sessionId]);

  const writeDraft = useCallback(
    async (
      next: string,
      selection = { end: next.length, start: next.length },
      focus = false,
    ) => {
      const owner = sessionRef.current;
      draftRef.current = next;
      selectionRef.current = selection;
      setDraft(projectComposerDraft(next));
      if (next.includes('/')) setCaret(selection.end);
      await inputRef.current?.setText(next);
      if (!mountedRef.current || sessionRef.current !== owner) return;
      await inputRef.current?.setSelection(selection.start, selection.end);
      if (focus) await inputRef.current?.focus();
    },
    [],
  );

  const readDraft = useCallback(() => {
    const observed = nativeText.value;
    return typeof observed === 'string' ? observed : draftRef.current;
  }, [nativeText]);

  const openModelPicker = useCallback(() => {
    void (async () => {
      await inputRef.current?.blur();
      Keyboard.dismiss();
      setAttachmentSheetOpen(false);
      model.openPicker();
    })();
  }, [model]);

  const slashActions = useMemo(
    () => ({
      onOpenModelPicker: openModelPicker,
      onOpenResume: () => router.navigate('/search'),
      onPrefill: (text: string) => void writeDraft(text, undefined, true),
      onSendExpanded: (message: string, display: string) =>
        void onSend(message, display),
      onStartNewChat: () => router.navigate('/new'),
      onStopTurn: () => void onStop(),
    }),
    [onSend, onStop, openModelPicker, router, writeDraft],
  );
  const slash = useSlashComposer({
    actions: slashActions,
    baseUrl,
    chatClient: client,
    connectionId,
    gatewayClient,
    sessionId,
  });

  const slashResolution = useMemo(
    () =>
      attachments.attachments.length === 0
        ? resolveSlashSubmission(draft, slash.catalog)
        : undefined,
    [attachments.attachments.length, draft, slash.catalog],
  );
  const suggestions = useMemo(
    () => (blocked ? [] : slash.suggestionsFor(draft.slice(0, caret))),
    [blocked, caret, draft, slash],
  );

  const runSlash = useCallback(
    (resolution: WaveSlashResolution | undefined = slashResolution) => {
      if (!resolution || blocked || slash.running) return;
      void writeDraft('', { end: 0, start: 0 });
      void slash.run(resolution);
    },
    [blocked, slash, slashResolution, writeDraft],
  );

  const send = useCallback(() => {
    const raw = readDraft();
    const value = raw.trim();
    const resolution =
      attachments.attachments.length === 0
        ? resolveSlashSubmission(raw, slash.catalog)
        : undefined;
    if (resolution) {
      runSlash(resolution);
      return;
    }
    if (!value || busy || blocked) return;
    const pending = attachments.attachments;
    const turnInput: WaveTurnInput =
      pending.length === 0
        ? value
        : [
            { text: value, type: 'text' },
            ...pending.map((attachment) => attachment.part),
          ];
    const optimisticText = [
      value,
      ...pending.map((attachment) => `[Attached: ${attachment.part.name}]`),
    ].join('\n');
    void writeDraft('', { end: 0, start: 0 });
    attachments.clear();
    void onSend(turnInput, optimisticText);
  }, [
    attachments,
    blocked,
    busy,
    onSend,
    readDraft,
    runSlash,
    slash.catalog,
    writeDraft,
  ]);

  const correct = useCallback(() => {
    const originalDraft = readDraft();
    const originalSelection = selectionRef.current;
    const resolution = resolveSlashSubmission(originalDraft, slash.catalog);
    if (resolution && attachments.attachments.length === 0) {
      runSlash(resolution);
      return;
    }
    if (
      !originalDraft.trim() ||
      !busy ||
      cancelling ||
      correcting ||
      blocked ||
      activePrompt ||
      attachments.attachments.length > 0
    ) {
      return;
    }
    const owner = sessionRef.current;
    void writeDraft('', { end: 0, start: 0 });
    void onCorrect(originalDraft).then((result) => {
      if (
        result.status !== 'failed' &&
        result.status !== 'rejected' &&
        result.status !== 'unavailable'
      ) {
        return;
      }
      if (!mountedRef.current || sessionRef.current !== owner) return;
      const current = readDraft();
      const restored = restoredCorrectionDraft(current, originalDraft);
      if (restored === current) return;
      void writeDraft(restored, originalSelection, true);
    });
  }, [
    activePrompt,
    attachments.attachments.length,
    blocked,
    busy,
    cancelling,
    correcting,
    onCorrect,
    readDraft,
    runSlash,
    slash.catalog,
    writeDraft,
  ]);

  const submit = useCallback(() => {
    const current = readDraft();
    const resolution =
      attachments.attachments.length === 0
        ? resolveSlashSubmission(current, slash.catalog)
        : undefined;
    if (resolution) runSlash(resolution);
    else if (busy) correct();
    else send();
  }, [
    attachments.attachments.length,
    busy,
    correct,
    readDraft,
    runSlash,
    send,
    slash.catalog,
  ]);

  const toggleDictation = useCallback(async () => {
    if (dictation.state.status === 'recording') {
      const owner = sessionRef.current;
      const transcript = await dictation.stop();
      if (!transcript || !mountedRef.current || sessionRef.current !== owner) {
        return;
      }
      const replacement = appendDictationTranscript(readDraft(), transcript);
      await writeDraft(replacement.text, replacement.selection, true);
      return;
    }
    if (dictation.state.status === 'idle') await dictation.start();
  }, [dictation, readDraft, writeDraft]);

  const acceptSuggestion = useCallback(
    (entry: WaveCommandCatalogEntry) => {
      const replacement = replaceSlashSuggestion(
        readDraft(),
        caret,
        entry.command,
      );
      if (!replacement) return;
      void writeDraft(replacement.text, replacement.selection, true);
    },
    [caret, readDraft, writeDraft],
  );

  const openAttachmentSheet = useCallback(() => {
    void (async () => {
      await inputRef.current?.blur();
      Keyboard.dismiss();
      model.closePicker();
      setAttachmentSheetOpen(true);
    })();
  }, [model]);

  const selectAttachmentSource = useCallback((action: () => Promise<void>) => {
    const owner = sessionRef.current;
    setAttachmentSheetOpen(false);
    if (attachmentPickerTimer.current) {
      clearTimeout(attachmentPickerTimer.current);
    }
    attachmentPickerTimer.current = setTimeout(() => {
      attachmentPickerTimer.current = undefined;
      if (!mountedRef.current || sessionRef.current !== owner) return;
      void action();
    }, SHEET_TO_PICKER_DELAY_MS);
  }, []);

  const action = resolveComposerAction({
    activePrompt,
    attachmentCount: attachments.attachments.length,
    blocked,
    busy,
    cancelling,
    commandName: slashResolution ? draft.trim().split(/\s/)[0] : undefined,
    correcting,
    hasRecognizedCommand: Boolean(slashResolution),
    hasText: Boolean(draft.trim()),
    slashRunning: slash.running,
  });

  const invokeTrailingAction = useCallback(() => {
    switch (action.kind) {
      case 'run':
        runSlash();
        break;
      case 'correct':
        correct();
        break;
      case 'stop':
        void onStop();
        break;
      case 'send':
        send();
        break;
      case 'live':
        router.push({
          pathname: '/conversation/[sessionId]/voice',
          params: { sessionId },
        });
        break;
      case 'correction-loading':
        break;
    }
  }, [action.kind, correct, onStop, router, runSlash, send, sessionId]);

  return (
    <>
      <ChatComposerDock>
        {prompt}
        <ChatComposerHost seedColor={colors.primary}>
          <NativeModelConfirmation
            isPresented={model.confirm !== undefined}
            message={model.confirm?.message}
            onCancel={model.closeConfirmation}
            onConfirm={model.confirmSelection}>
            <Column
              alignment="start"
              spacing={8}
              modifiers={nativeFillWidthModifiers()}>
              <ComposerAccessoryContent
                activePrompt={activePrompt}
                activityLabel={activityLabel}
                attachments={attachments}
                blocked={blocked}
                busy={busy}
                colors={colors}
                correctionError={correctionError}
                dictation={dictation}
                draft={draft}
                modelNotice={model.notice}
                slashResolution={slashResolution}
                slashResult={slash.result}
                suggestions={suggestions}
                turnActionError={turnActionError}
                onAcceptSuggestion={acceptSuggestion}
                onDismissDictationError={dictation.dismissError}
                onDismissSlashResult={slash.dismissResult}
                onDismissTurnActionError={onDismissTurnActionError}
              />

              <Column
                alignment="start"
                spacing={2}
                style={{
                  backgroundColor: colors.muted,
                  borderRadius: 28,
                  paddingBottom: 10,
                }}
                modifiers={[
                  ...nativeFillWidthModifiers(),
                  ...nativeContainerTestIDModifiers('chat-composer-box'),
                ]}>
                <ChatComposerInput
                  ref={inputRef}
                  accessibilityLabel={
                    busy ? 'Correct the current response' : 'Ask anything'
                  }
                  editable={!(cancelling || correcting)}
                  foregroundColor={colors.foreground}
                  mutedColor={colors.mutedForeground}
                  placeholder={busy ? 'Add a correction' : 'Ask anything'}
                  primaryColor={colors.primary}
                  selection={nativeSelection}
                  text={nativeText}
                  testID="chat-composer-input"
                  onChangeText={(value) => {
                    const inferredSelection =
                      inferComposerSelectionAfterTextChange(
                        draftRef.current,
                        value,
                        selectionRef.current,
                      );
                    draftRef.current = value;
                    selectionRef.current = inferredSelection;
                    setDraft(projectComposerDraft(value));
                    if (value.includes('/')) {
                      setCaret(inferredSelection.end);
                    }
                    slash.observeDraft(value);
                  }}
                  onSelectionChange={(selection) => {
                    selectionRef.current = selection;
                    if (draftRef.current.includes('/')) {
                      setCaret(selection.end);
                    }
                    slash.observeDraft(
                      draftRef.current.slice(0, selection.end),
                    );
                  }}
                  onSubmit={submit}
                />
                <Row
                  alignment="center"
                  spacing={8}
                  style={{ paddingHorizontal: 12 }}
                  modifiers={nativeFillWidthModifiers()}>
                  <NativeComposerIconButton
                    accessibilityLabel="Add an attachment"
                    backgroundColor={colors.secondary}
                    disabled={busy || blocked}
                    foregroundColor={colors.secondaryForeground}
                    icon={CHAT_COMPOSER_ICONS.add}
                    testID="chat-attachment-button"
                    variant="tonal"
                    onPress={openAttachmentSheet}
                  />
                  {gatewayClient ? (
                    <NativeModelPill
                      accessibilityLabel="Change the model for this conversation"
                      backgroundColor={colors.secondary}
                      disabled={blocked}
                      foregroundColor={colors.secondaryForeground}
                      label={model.label}
                      testID="chat-model-pill"
                      onPress={openModelPicker}
                    />
                  ) : null}
                  <Spacer flexible />
                  {canDictate ? (
                    <NativeComposerIconButton
                      accessibilityLabel={
                        dictation.state.status === 'recording'
                          ? 'Stop dictating and insert the transcript'
                          : 'Dictate a message'
                      }
                      backgroundColor={
                        dictation.state.status === 'recording'
                          ? colors.destructive
                          : colors.secondary
                      }
                      disabled={busy || blocked}
                      foregroundColor={
                        dictation.state.status === 'recording'
                          ? colors.primaryForeground
                          : colors.secondaryForeground
                      }
                      icon={CHAT_COMPOSER_ICONS.microphone}
                      loading={dictation.state.status === 'transcribing'}
                      testID="chat-dictate-button"
                      variant={
                        dictation.state.status === 'recording'
                          ? 'filled'
                          : 'tonal'
                      }
                      onPress={() => void toggleDictation()}
                    />
                  ) : null}
                  <NativeComposerIconButton
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
                    onPress={invokeTrailingAction}
                  />
                </Row>
              </Column>
            </Column>
          </NativeModelConfirmation>
        </ChatComposerHost>
      </ChatComposerDock>

      <AttachmentSourceSheet
        colors={colors}
        isPresented={attachmentSheetOpen}
        onDismiss={() => setAttachmentSheetOpen(false)}
        onPickFile={() => selectAttachmentSource(attachments.pickFile)}
        onPickImage={() => selectAttachmentSource(attachments.pickImage)}
        onTakePhoto={() => selectAttachmentSource(attachments.takePhoto)}
      />
      {gatewayClient ? (
        <ModelPickerSheet colors={colors} model={model} />
      ) : null}
    </>
  );
}

function ComposerAccessoryContent({
  activePrompt,
  activityLabel,
  attachments,
  blocked,
  busy,
  colors,
  correctionError,
  dictation,
  draft,
  modelNotice,
  onAcceptSuggestion,
  onDismissDictationError,
  onDismissSlashResult,
  onDismissTurnActionError,
  slashResolution,
  slashResult,
  suggestions,
  turnActionError,
}: {
  activePrompt: boolean;
  activityLabel?: string;
  attachments: ReturnType<typeof useChatAttachments>;
  blocked: boolean;
  busy: boolean;
  colors: ComposerColors;
  correctionError?: string;
  dictation: ReturnType<typeof useDictation>;
  draft: string;
  modelNotice?: string;
  onAcceptSuggestion(entry: WaveCommandCatalogEntry): void;
  onDismissDictationError(): void;
  onDismissSlashResult(): void;
  onDismissTurnActionError(): void;
  slashResolution?: WaveSlashResolution;
  slashResult?: SlashCommandRunResult;
  suggestions: WaveCommandCatalogEntry[];
  turnActionError?: string;
}) {
  return (
    <>
      {attachments.attachments.length > 0 ? (
        <Column
          alignment="start"
          spacing={4}
          modifiers={[
            ...nativeFillWidthModifiers(),
            ...nativeContainerTestIDModifiers('chat-attachments'),
          ]}>
          {attachments.attachments.map((attachment) => (
            <Row
              key={attachment.id}
              alignment="center"
              spacing={10}
              style={{
                backgroundColor: colors.card,
                borderColor: colors.border,
                borderRadius: 14,
                borderWidth: 1,
                padding: 8,
              }}
              modifiers={nativeFillWidthModifiers()}>
              <Icon
                accessibilityLabel={
                  attachment.part.type === 'image' ? 'Image' : 'Text file'
                }
                color={colors.foreground}
                name={
                  attachment.part.type === 'image'
                    ? CHAT_COMPOSER_ICONS.image
                    : CHAT_COMPOSER_ICONS.file
                }
                size={18}
              />
              <Column alignment="start" spacing={1}>
                <Text
                  numberOfLines={1}
                  textStyle={{ color: colors.foreground, fontSize: 14 }}>
                  {attachment.part.name}
                </Text>
                <Text
                  numberOfLines={1}
                  textStyle={{ color: colors.mutedForeground, fontSize: 12 }}>
                  {attachment.description}
                </Text>
              </Column>
              <Spacer flexible />
              <NativeComposerIconButton
                accessibilityLabel={`Remove ${attachment.part.name}`}
                foregroundColor={colors.foreground}
                icon={CHAT_COMPOSER_ICONS.remove}
                iconSize={15}
                testID={`remove-attachment-${attachment.id}`}
                onPress={() => attachments.remove(attachment.id)}
              />
            </Row>
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
          onPress={attachments.dismissError}
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

      {dictation.state.status === 'recording' ? (
        <ComposerMessage
          centered
          colors={colors}
          testID="chat-dictation-hint"
          text="Listening — tap the microphone again to insert what you said."
        />
      ) : dictation.state.error ? (
        <ComposerMessage
          centered
          colors={colors}
          testID="chat-dictation-error"
          text={`${dictation.state.error} Tap to dismiss.`}
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
          testID="chat-slash-highlight"
          textStyle={{ color: colors.primary, fontSize: 12, fontWeight: '600' }}
          style={{ paddingHorizontal: 8 }}>
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
    </>
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
      testID={testID}
      textStyle={{
        color: destructive ? colors.destructive : colors.mutedForeground,
        fontSize: 12,
        textAlign: centered ? 'center' : 'left',
      }}
      style={{ paddingHorizontal: 8, paddingVertical: destructive ? 6 : 2 }}
      modifiers={nativeFillWidthModifiers()}
      onPress={onPress}>
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
  const height = Math.min(252, suggestions.length * 56);
  return (
    <ScrollView
      style={{
        backgroundColor: colors.card,
        borderColor: colors.border,
        borderRadius: 16,
        borderWidth: 1,
        height,
      }}
      modifiers={nativeContainerTestIDModifiers('chat-slash-suggestions')}>
      <Column
        alignment="start"
        spacing={2}
        modifiers={nativeFillWidthModifiers()}>
        {suggestions.map((entry) => {
          const testID = `chat-slash-suggestion-${entry.command.slice(1)}`;
          return (
            <Button
              key={entry.command}
              testID={testID}
              variant="text"
              style={{ paddingHorizontal: 12, paddingVertical: 7 }}
              modifiers={[
                ...nativeFillWidthModifiers(),
                ...nativeAccessibilityModifiers(`Use ${entry.command}`, testID),
              ]}
              onPress={() => onAccept(entry)}>
              <Column
                alignment="start"
                spacing={1}
                modifiers={nativeFillWidthModifiers()}>
                <Text
                  numberOfLines={1}
                  textStyle={{
                    color: colors.foreground,
                    fontSize: 14,
                    fontWeight: '600',
                  }}>
                  {`${entry.command}${entry.kind === 'skill' ? '  ·  skill' : ''}`}
                </Text>
                {entry.description ? (
                  <Text
                    numberOfLines={1}
                    textStyle={{ color: colors.mutedForeground, fontSize: 12 }}>
                    {entry.description}
                  </Text>
                ) : null}
              </Column>
            </Button>
          );
        })}
      </Column>
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
    <Column
      alignment="start"
      spacing={4}
      style={{
        backgroundColor: colors.card,
        borderColor: colors.border,
        borderRadius: 16,
        borderWidth: 1,
        padding: 10,
      }}
      modifiers={[
        ...nativeFillWidthModifiers(),
        ...nativeContainerTestIDModifiers('chat-slash-result'),
      ]}>
      <Row
        alignment="center"
        spacing={4}
        modifiers={nativeFillWidthModifiers()}>
        <Text
          textStyle={{
            color: colors.foreground,
            fontSize: 12,
            fontWeight: '600',
          }}>
          {result.title}
        </Text>
        <Spacer flexible />
        <NativeComposerIconButton
          accessibilityLabel="Dismiss command result"
          foregroundColor={colors.foreground}
          icon={CHAT_COMPOSER_ICONS.remove}
          iconSize={14}
          testID="chat-slash-result-dismiss"
          onPress={onDismiss}
        />
      </Row>
      {result.output ? (
        <ScrollView style={{ height: 120 }}>
          <Text
            textStyle={{
              color: colors.mutedForeground,
              fontFamily: 'monospace',
              fontSize: 11,
              lineHeight: 16,
            }}>
            {result.output}
          </Text>
        </ScrollView>
      ) : null}
    </Column>
  );
}

function AttachmentSourceSheet({
  colors,
  isPresented,
  onDismiss,
  onPickFile,
  onPickImage,
  onTakePhoto,
}: {
  colors: ComposerColors;
  isPresented: boolean;
  onDismiss(): void;
  onPickFile(): void;
  onPickImage(): void;
  onTakePhoto(): void;
}) {
  return (
    <BottomSheet
      isPresented={isPresented}
      testID="chat-attachment-sheet"
      onDismiss={onDismiss}>
      <Row
        alignment="center"
        spacing={8}
        modifiers={nativeFillWidthModifiers()}>
        <AttachmentSourceButton
          accessibilityLabel="Take a photo"
          colors={colors}
          icon={CHAT_COMPOSER_ICONS.camera}
          label="Camera"
          testID="attachment-source-camera"
          onPress={onTakePhoto}
        />
        <Spacer flexible />
        <AttachmentSourceButton
          accessibilityLabel="Choose a photo"
          colors={colors}
          icon={CHAT_COMPOSER_ICONS.photos}
          label="Photos"
          testID="attachment-source-photos"
          onPress={onPickImage}
        />
        <Spacer flexible />
        <AttachmentSourceButton
          accessibilityLabel="Choose a text file"
          colors={colors}
          icon={CHAT_COMPOSER_ICONS.paperclip}
          label="Files"
          testID="attachment-source-files"
          onPress={onPickFile}
        />
      </Row>
    </BottomSheet>
  );
}

function AttachmentSourceButton({
  accessibilityLabel,
  colors,
  icon,
  label,
  onPress,
  testID,
}: {
  accessibilityLabel: string;
  colors: ComposerColors;
  icon: IconName;
  label: string;
  onPress(): void;
  testID: string;
}) {
  return (
    <Button
      testID={testID}
      variant="text"
      style={{
        backgroundColor: colors.muted,
        borderRadius: 16,
        height: 84,
        width: 96,
      }}
      modifiers={nativeAccessibilityModifiers(accessibilityLabel, testID)}
      onPress={onPress}>
      <Column alignment="center" spacing={8}>
        <Icon
          accessibilityLabel={accessibilityLabel}
          color={colors.foreground}
          name={icon}
          size={22}
        />
        <Text
          textStyle={{
            color: colors.foreground,
            fontSize: 13,
            fontWeight: '500',
          }}>
          {label}
        </Text>
      </Column>
    </Button>
  );
}

function ModelPickerSheet({
  colors,
  model,
}: {
  colors: ComposerColors;
  model: SessionModelPickerController;
}) {
  return (
    <BottomSheet
      isPresented={model.open}
      showDragIndicator
      snapPoints={['half', 'full']}
      testID="chat-model-sheet"
      onDismiss={model.closePicker}>
      <List>
        <Text
          testID="chat-model-picker"
          textStyle={{
            color: colors.foreground,
            fontSize: 20,
            fontWeight: '700',
          }}
          style={{ paddingBottom: 8, paddingHorizontal: 8 }}>
          Model for this chat
        </Text>
        {model.isLoading ? (
          <ComposerMessage
            centered
            colors={colors}
            testID="chat-model-loading"
            text="Loading models…"
          />
        ) : model.isInitialError ? (
          <ComposerMessage
            centered
            colors={colors}
            destructive
            testID="chat-model-initial-error"
            text="Wave could not load the model list. Close and try again."
          />
        ) : model.catalog ? (
          <>
            {model.showReasoning ? (
              <Switch
                disabled={model.busyControl !== undefined}
                label="Thinking"
                testID="chat-model-thinking"
                value={model.thinkingEnabled}
                onValueChange={model.setThinking}
              />
            ) : null}
            {model.showFast ? (
              <Switch
                disabled={model.busyControl !== undefined}
                label="Fast mode"
                testID="chat-model-fast"
                value={model.fastEnabled}
                onValueChange={model.setFastMode}
              />
            ) : null}
            {model.showReasoning && model.thinkingEnabled ? (
              <Row
                alignment="center"
                spacing={8}
                style={{ paddingHorizontal: 8, paddingVertical: 6 }}
                modifiers={[
                  ...nativeFillWidthModifiers(),
                  ...nativeContainerTestIDModifiers('chat-model-reasoning-row'),
                ]}>
                <Text
                  textStyle={{
                    color: colors.foreground,
                    fontSize: 14,
                    fontWeight: '600',
                  }}>
                  Effort
                </Text>
                <Spacer flexible />
                <Picker
                  enabled={model.busyControl === undefined}
                  selectedValue={model.selectedReasoning}
                  testID="chat-model-reasoning"
                  onValueChange={model.setReasoning}>
                  {model.reasoningEfforts.map((effort) => (
                    <Picker.Item
                      key={effort}
                      label={MODEL_EFFORT_LABELS[effort]}
                      value={effort}
                    />
                  ))}
                </Picker>
              </Row>
            ) : null}
            <Row
              alignment="center"
              spacing={8}
              style={{ paddingHorizontal: 8, paddingVertical: 6 }}
              modifiers={nativeFillWidthModifiers()}>
              <Text
                textStyle={{
                  color: colors.mutedForeground,
                  fontSize: 12,
                  fontWeight: '600',
                }}>
                Models
              </Text>
              <Spacer flexible />
              <Button
                disabled={model.refreshing}
                testID="chat-model-refresh"
                variant="text"
                style={{ height: 36, paddingHorizontal: 8 }}
                modifiers={nativeAccessibilityModifiers(
                  'Refresh the model list',
                  'chat-model-refresh',
                )}
                onPress={() => void model.refreshModels()}>
                <Row alignment="center" spacing={5}>
                  <Icon
                    accessibilityLabel="Refresh"
                    color={colors.foreground}
                    name={CHAT_COMPOSER_ICONS.refresh}
                    size={15}
                  />
                  <Text textStyle={{ color: colors.foreground, fontSize: 13 }}>
                    {model.refreshing ? 'Refreshing…' : 'Refresh'}
                  </Text>
                </Row>
              </Button>
            </Row>
            {model.catalog.providers.length === 0 ? (
              <ComposerMessage
                centered
                colors={colors}
                testID="chat-model-empty"
                text="This server lists no switchable models."
              />
            ) : (
              model.catalog.providers.flatMap((provider) => [
                <Text
                  key={`${provider.slug}-header`}
                  textStyle={{
                    color: colors.mutedForeground,
                    fontSize: 12,
                    fontWeight: '600',
                  }}
                  style={{ paddingHorizontal: 8, paddingTop: 10 }}>
                  {provider.name}
                </Text>,
                ...modelFamilies(provider.models).map((family) => {
                  const option = family.option;
                  const selected =
                    provider.current &&
                    (option.id === model.catalog?.currentModel ||
                      family.fastVariant?.id === model.catalog?.currentModel);
                  const description = modelOptionDescription(option);
                  const testID = `chat-model-${provider.slug}-${option.id}`;
                  return (
                    <Button
                      key={`${provider.slug}-${option.id}`}
                      disabled={option.unavailable || Boolean(model.busyModel)}
                      testID={testID}
                      variant="text"
                      style={{
                        opacity: option.unavailable ? 0.45 : 1,
                        paddingHorizontal: 10,
                        paddingVertical: 8,
                      }}
                      modifiers={[
                        ...nativeFillWidthModifiers(),
                        ...nativeAccessibilityModifiers(
                          `Use model ${option.id}`,
                          testID,
                        ),
                      ]}
                      onPress={() => {
                        if (selected) {
                          model.closePicker();
                          return;
                        }
                        void model.select({
                          model: option.id,
                          provider: provider.slug,
                        });
                      }}>
                      <Row
                        alignment="center"
                        spacing={8}
                        modifiers={nativeFillWidthModifiers()}>
                        <Column alignment="start" spacing={2}>
                          <Text
                            numberOfLines={1}
                            textStyle={{
                              color: colors.foreground,
                              fontSize: 14,
                              fontWeight: '500',
                            }}>
                            {displayModelName(option.id)}
                          </Text>
                          {description ? (
                            <Text
                              numberOfLines={1}
                              textStyle={{
                                color: colors.mutedForeground,
                                fontSize: 12,
                              }}>
                              {description}
                            </Text>
                          ) : null}
                        </Column>
                        <Spacer flexible />
                        {model.busyModel === option.id ? (
                          <Text
                            textStyle={{
                              color: colors.mutedForeground,
                              fontSize: 12,
                            }}>
                            Switching…
                          </Text>
                        ) : selected ? (
                          <Icon
                            accessibilityLabel="Selected"
                            color={colors.primary}
                            name={CHAT_COMPOSER_ICONS.check}
                            size={18}
                          />
                        ) : null}
                      </Row>
                    </Button>
                  );
                }),
              ])
            )}
          </>
        ) : null}
        {model.error ? (
          <ComposerMessage
            colors={colors}
            destructive
            testID="chat-model-error"
            text={model.error}
          />
        ) : null}
      </List>
    </BottomSheet>
  );
}

function trailingActionIcon(
  kind: ReturnType<typeof resolveComposerAction>['kind'],
): IconName {
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

function trailingActionTestID(
  kind: ReturnType<typeof resolveComposerAction>['kind'],
) {
  switch (kind) {
    case 'run':
      return 'chat-run-command-button';
    case 'correction-loading':
      return 'chat-correction-loading-button';
    case 'correct':
      return 'chat-correct-button';
    case 'stop':
      return 'chat-stop-button';
    case 'send':
      return 'chat-send-button';
    case 'live':
      return 'chat-live-button';
  }
}

function resolveColor(
  value: string | number | undefined,
  fallback: string,
): string {
  return typeof value === 'string' ? value : fallback;
}
