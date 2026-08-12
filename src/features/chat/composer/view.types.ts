import type { Ref } from 'react';

import type { useChatAttachments } from '@/features/chat/composer/attachments';
import type { ChatComposerInputRef } from '@/features/chat/composer/input.types';
import type { ComposerAction } from '@/features/chat/composer/state';
import type { SlashCommandRunResult } from '@/features/chat/composer/slash';
import type { WaveSlashResolution } from '@/features/chat/slash-commands';
import type { DictationStatus } from '@/features/voice/use-dictation';
import type { WaveCommandCatalogEntry } from '@/services/gateway/gateway-commands';

export interface ComposerColors {
  background: string;
  border: string;
  card: string;
  destructive: string;
  foreground: string;
  muted: string;
  mutedForeground: string;
  opaqueMuted: string;
  primary: string;
  primaryForeground: string;
  secondary: string;
  secondaryForeground: string;
}

export interface ChatComposerNativeViewProps {
  action: ComposerAction;
  activePrompt: boolean;
  activityLabel?: string;
  attachments: ReturnType<typeof useChatAttachments>;
  blocked: boolean;
  busy: boolean;
  canDictate: boolean;
  colors: ComposerColors;
  correctionError?: string;
  dictationError?: string;
  dictationStatus: DictationStatus;
  draft: string;
  inputEditable: boolean;
  inputRef: Ref<ChatComposerInputRef>;
  modelLabel: string;
  modelNotice?: string;
  nativeSelection: { value: { end: number; start: number } };
  nativeText: { value: string };
  showModel: boolean;
  slashResolution?: WaveSlashResolution;
  slashResult?: SlashCommandRunResult;
  suggestions: WaveCommandCatalogEntry[];
  turnActionError?: string;
  onAcceptSuggestion(entry: WaveCommandCatalogEntry): void;
  onAttachFile(): void;
  onAttachImage(): void;
  onAttachPhoto(): void;
  onChangeText(value: string): void;
  onDictationPress(): void;
  onDismissAttachmentError(): void;
  onDismissDictationError(): void;
  onDismissSlashResult(): void;
  onDismissTurnActionError(): void;
  onInvokeTrailingAction(): void;
  onModelPress(): void;
  onRemoveAttachment(id: string): void;
  onSelectionChange(selection: { end: number; start: number }): void;
  onSubmit(): void;
  onSurfaceHeightChange(height: number): void;
}

export function composerHasAccessoryContent({
  activePrompt,
  activityLabel,
  attachments,
  blocked,
  busy,
  correctionError,
  dictationError,
  dictationStatus,
  draft,
  modelNotice,
  slashResolution,
  slashResult,
  suggestions,
  turnActionError,
}: Pick<
  ChatComposerNativeViewProps,
  | 'activePrompt'
  | 'activityLabel'
  | 'attachments'
  | 'blocked'
  | 'busy'
  | 'correctionError'
  | 'dictationError'
  | 'dictationStatus'
  | 'draft'
  | 'modelNotice'
  | 'slashResolution'
  | 'slashResult'
  | 'suggestions'
  | 'turnActionError'
>): boolean {
  return (
    attachments.attachments.length > 0 ||
    Boolean(correctionError) ||
    Boolean(attachments.error) ||
    (busy && attachments.attachments.length > 0) ||
    (attachments.attachments.length > 0 && !draft.trim()) ||
    (busy && activePrompt && Boolean(draft.trim())) ||
    dictationStatus === 'recording' ||
    Boolean(dictationError) ||
    Boolean(modelNotice) ||
    Boolean(turnActionError) ||
    blocked ||
    Boolean(busy && activityLabel && !activePrompt) ||
    Boolean(slashResolution) ||
    suggestions.length > 0 ||
    Boolean(slashResult)
  );
}

export function trailingActionTestID(kind: ComposerAction['kind']) {
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
