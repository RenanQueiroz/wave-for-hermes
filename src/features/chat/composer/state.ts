export type ComposerAction =
  | {
      disabled: boolean;
      kind: 'run';
      label: string;
      loading: boolean;
    }
  | {
      disabled: true;
      kind: 'correction-loading';
      label: 'Sending correction';
      loading: true;
    }
  | {
      disabled: boolean;
      kind: 'correct';
      label: 'Correct current Wave response';
      loading: false;
    }
  | {
      disabled: boolean;
      kind: 'stop';
      label: 'Stop Wave response';
      loading: false;
    }
  | {
      disabled: boolean;
      kind: 'send';
      label: 'Send message to Wave';
      loading: false;
    }
  | {
      disabled: boolean;
      kind: 'live';
      label: 'Start live voice';
      loading: false;
    };

const NONEMPTY_DRAFT_PROJECTION = '\uFFFC';

/**
 * Keep ordinary native typing off React's render path. JavaScript needs the
 * exact text only while resolving a slash trigger; otherwise empty/non-empty
 * state is enough for the trailing action and attachment hints.
 */
export function projectComposerDraft(value: string): string {
  if (value.includes('/')) return value;
  return value.trim() ? NONEMPTY_DRAFT_PROJECTION : '';
}

/**
 * Infer the collapsed caret after a native text edit. SwiftUI's TextField can
 * deliver `onTextChange` without a matching `onSelectionChange`, so slash
 * completion cannot depend on the selection callback alone. Text before or
 * after the changed span stays anchored; an edit at the caret lands after the
 * replacement, matching ordinary keyboard behavior.
 */
export function inferComposerSelectionAfterTextChange(
  previous: string,
  next: string,
  selection: { end: number; start: number },
): { end: number; start: number } {
  const previousCaret = Math.max(0, Math.min(selection.end, previous.length));
  if (previous === next) {
    return { end: previousCaret, start: previousCaret };
  }

  let prefix = 0;
  const commonLength = Math.min(previous.length, next.length);
  while (prefix < commonLength && previous[prefix] === next[prefix]) {
    prefix += 1;
  }

  let previousChangedEnd = previous.length;
  let nextChangedEnd = next.length;
  while (
    previousChangedEnd > prefix &&
    nextChangedEnd > prefix &&
    previous[previousChangedEnd - 1] === next[nextChangedEnd - 1]
  ) {
    previousChangedEnd -= 1;
    nextChangedEnd -= 1;
  }

  const inferred =
    previousCaret < prefix
      ? previousCaret
      : previousCaret > previousChangedEnd
        ? previousCaret + nextChangedEnd - previousChangedEnd
        : nextChangedEnd;
  const caret = Math.max(0, Math.min(inferred, next.length));
  return { end: caret, start: caret };
}

export interface ResolveComposerActionInput {
  activePrompt: boolean;
  attachmentCount: number;
  blocked: boolean;
  busy: boolean;
  cancelling: boolean;
  commandName?: string;
  correcting: boolean;
  hasRecognizedCommand: boolean;
  hasText: boolean;
  slashRunning: boolean;
}

/**
 * The composer has one trailing action lane. Keeping its precedence in a pure
 * resolver prevents the iOS and Android native trees from drifting apart.
 */
export function resolveComposerAction({
  activePrompt,
  attachmentCount,
  blocked,
  busy,
  cancelling,
  commandName,
  correcting,
  hasRecognizedCommand,
  hasText,
  slashRunning,
}: ResolveComposerActionInput): ComposerAction {
  if (hasRecognizedCommand && hasText) {
    return {
      disabled: blocked || slashRunning,
      kind: 'run',
      label: `Run the ${commandName ?? 'slash'} command`,
      loading: slashRunning,
    };
  }

  if (correcting) {
    return {
      disabled: true,
      kind: 'correction-loading',
      label: 'Sending correction',
      loading: true,
    };
  }

  if (
    busy &&
    !cancelling &&
    !activePrompt &&
    attachmentCount === 0 &&
    hasText
  ) {
    return {
      disabled: blocked,
      kind: 'correct',
      label: 'Correct current Wave response',
      loading: false,
    };
  }

  if (busy) {
    return {
      disabled: cancelling,
      kind: 'stop',
      label: 'Stop Wave response',
      loading: false,
    };
  }

  if (hasText) {
    return {
      disabled: blocked,
      kind: 'send',
      label: 'Send message to Wave',
      loading: false,
    };
  }

  return {
    disabled: blocked,
    kind: 'live',
    label: 'Start live voice',
    loading: false,
  };
}

export interface DraftReplacement {
  selection: { end: number; start: number };
  text: string;
}

const MAX_MODEL_TRIGGER_NAME_CHARS = 22;

export function displayModelName(modelId: string): string {
  let base = (modelId.split('/').pop() ?? modelId).trim();
  base = base.replace(/-fast$/i, '').replace(/-\d{8}$/, '');
  if (/^gpt-/i.test(base)) return base.replace(/^gpt-/i, 'GPT-');
  if (/^claude-/i.test(base)) {
    base = base.replace(/^claude-/i, '');
  } else if (/^gemini-/i.test(base)) {
    base = base.replace(/^gemini-/i, 'Gemini-');
  }
  return base
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function modelTriggerLabel(
  modelId: string | undefined,
  reasoningEffort: string | undefined,
): string {
  if (!modelId) return 'Model';
  const tail = displayModelName(modelId);
  const boundedModel =
    tail.length > MAX_MODEL_TRIGGER_NAME_CHARS
      ? `${tail.slice(0, MAX_MODEL_TRIGGER_NAME_CHARS - 1)}…`
      : tail;
  const effort = reasoningEffort?.trim();
  if (!effort) return boundedModel;
  const effortLabel =
    effort.toLowerCase() === 'none'
      ? 'Off'
      : effort.toLowerCase() === 'xhigh'
        ? 'XHigh'
        : effort.charAt(0).toUpperCase() + effort.slice(1).toLowerCase();
  return `${boundedModel} · ${effortLabel}`;
}

export function replaceSlashSuggestion(
  draft: string,
  caret: number,
  command: string,
): DraftReplacement | undefined {
  const boundedCaret = Math.max(0, Math.min(caret, draft.length));
  const replaceFrom = draft.slice(0, boundedCaret).lastIndexOf('/');
  if (replaceFrom < 0) return undefined;

  const insertion = `${command} `;
  const nextCaret = replaceFrom + insertion.length;
  return {
    selection: { end: nextCaret, start: nextCaret },
    text: `${draft.slice(0, replaceFrom)}${insertion}${draft.slice(boundedCaret)}`,
  };
}

export function appendDictationTranscript(
  draft: string,
  transcript: string,
): DraftReplacement {
  const existing = draft.trim();
  const text = existing ? `${existing} ${transcript}` : transcript;
  return {
    selection: { end: text.length, start: text.length },
    text,
  };
}

export function restoredCorrectionDraft(current: string, failedDraft: string) {
  return current.trim() ? current : failedDraft;
}
