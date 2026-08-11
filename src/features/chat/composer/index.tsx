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
import { ChatComposerHost } from '@/features/chat/composer/host';
import type { ChatComposerInputRef } from '@/features/chat/composer/input.types';
import { useSessionModelPicker } from '@/features/chat/composer/model/picker';
import { NativeModelConfirmation } from '@/features/chat/composer/model/confirmation';
import { useNativeState } from '@/features/chat/composer/native-state';
import {
  AttachmentSourceSheet,
  ModelPickerSheet,
} from '@/features/chat/composer/sheets';
import {
  appendDictationTranscript,
  inferComposerSelectionAfterTextChange,
  projectComposerDraft,
  replaceSlashSuggestion,
  resolveComposerAction,
  restoredCorrectionDraft,
} from '@/features/chat/composer/state';
import { useSlashComposer } from '@/features/chat/composer/slash';
import { ChatComposerNativeView } from '@/features/chat/composer/view';
import type { ComposerColors } from '@/features/chat/composer/view.types';
import {
  resolveSlashSubmission,
  type WaveSlashResolution,
} from '@/features/chat/slash-commands';
import type { WaveCorrectionResult } from '@/features/chat/use-wave-chat';
import { useDictation } from '@/features/voice/use-dictation';
import { useTheme } from '@/hooks/use-theme';
import type { GatewayClient } from '@/services/gateway/gateway-client';
import type { WaveCommandCatalogEntry } from '@/services/gateway/gateway-commands';
import type { WaveChatClient } from '@/services/wave/wave-chat-client';
import { compositeOverlay } from '@/utils/colors';

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
  onBottomOffsetChange(offset: number): void;
  onRestingOffsetChange(offset: number): void;
  onSend(input: WaveTurnInput, optimisticText?: string): Promise<void>;
  onStop(): Promise<void>;
  prompt?: ReactNode;
  sessionId: string;
  turnActionError?: string;
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
  onBottomOffsetChange,
  onRestingOffsetChange,
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
  const colors = useMemo<ComposerColors>(() => {
    const muted = resolveColor(mutedToken, theme.backgroundElement);
    return {
      background: theme.background,
      border: resolveColor(borderToken, theme.backgroundSelected),
      card: resolveColor(cardToken, theme.backgroundElement),
      destructive: resolveColor(destructiveToken, '#ef4444'),
      foreground: theme.text,
      muted,
      mutedForeground: theme.textSecondary,
      opaqueMuted: compositeOverlay(theme.background, muted),
      primary: theme.primary,
      primaryForeground: resolveColor(primaryForegroundToken, theme.background),
      secondary: resolveColor(secondaryToken, theme.backgroundElement),
      secondaryForeground: resolveColor(secondaryForegroundToken, theme.text),
    };
  }, [
    borderToken,
    cardToken,
    destructiveToken,
    mutedToken,
    primaryForegroundToken,
    secondaryForegroundToken,
    secondaryToken,
    theme,
  ]);

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
  const [surfaceHeight, setSurfaceHeight] = useState(100);
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
      onStartNewChat: () => router.replace('/new'),
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

  const updateSurfaceHeight = useCallback((height: number) => {
    setSurfaceHeight((current) =>
      Math.abs(current - height) < 0.5 ? current : height,
    );
  }, []);

  const handleChangeText = useCallback(
    (value: string) => {
      const inferredSelection = inferComposerSelectionAfterTextChange(
        draftRef.current,
        value,
        selectionRef.current,
      );
      draftRef.current = value;
      selectionRef.current = inferredSelection;
      setDraft(projectComposerDraft(value));
      if (value.includes('/')) setCaret(inferredSelection.end);
      slash.observeDraft(value);
    },
    [slash],
  );

  const handleSelectionChange = useCallback(
    (selection: { end: number; start: number }) => {
      selectionRef.current = selection;
      if (draftRef.current.includes('/')) setCaret(selection.end);
      slash.observeDraft(draftRef.current.slice(0, selection.end));
    },
    [slash],
  );

  return (
    <>
      <ChatComposerDock
        colorScheme={theme.mode}
        onBottomOffsetChange={onBottomOffsetChange}
        onRestingOffsetChange={onRestingOffsetChange}
        surfaceBackgroundColor={colors.opaqueMuted}
        surfaceHeight={surfaceHeight}>
        {prompt}
        <ChatComposerHost seedColor={colors.primary}>
          <NativeModelConfirmation
            isPresented={model.confirm !== undefined}
            message={model.confirm?.message}
            onCancel={model.closeConfirmation}
            onConfirm={model.confirmSelection}>
            <ChatComposerNativeView
              action={action}
              activePrompt={activePrompt}
              activityLabel={activityLabel}
              attachments={attachments}
              blocked={blocked}
              busy={busy}
              canDictate={canDictate}
              colors={colors}
              correctionError={correctionError}
              dictationError={dictation.state.error}
              dictationStatus={dictation.state.status}
              draft={draft}
              inputEditable={!(cancelling || correcting)}
              inputRef={inputRef}
              modelLabel={model.label}
              modelNotice={model.notice}
              nativeSelection={nativeSelection}
              nativeText={nativeText}
              showModel={Boolean(gatewayClient)}
              slashResolution={slashResolution}
              slashResult={slash.result}
              suggestions={suggestions}
              turnActionError={turnActionError}
              onAcceptSuggestion={acceptSuggestion}
              onAttachmentPress={openAttachmentSheet}
              onChangeText={handleChangeText}
              onDictationPress={() => void toggleDictation()}
              onDismissAttachmentError={attachments.dismissError}
              onDismissDictationError={dictation.dismissError}
              onDismissSlashResult={slash.dismissResult}
              onDismissTurnActionError={onDismissTurnActionError}
              onInvokeTrailingAction={invokeTrailingAction}
              onModelPress={openModelPicker}
              onRemoveAttachment={attachments.remove}
              onSelectionChange={handleSelectionChange}
              onSubmit={submit}
              onSurfaceHeightChange={updateSurfaceHeight}
            />
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

function resolveColor(
  value: string | number | undefined,
  fallback: string,
): string {
  return typeof value === 'string' ? value : fallback;
}
