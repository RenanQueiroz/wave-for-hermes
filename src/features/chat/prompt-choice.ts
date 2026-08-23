import type { WavePromptQuestion } from '@wave/contracts';

/** Presentation-only parsing for Hermes clarification choice labels. */
export function promptChoicePresentation(choice: string): {
  label: string;
  recommended: boolean;
} {
  const label = choice.replace(/\s+\(recommended\)$/i, '').trim();
  const recommended = label !== choice.trim();
  return { label: label || choice, recommended };
}

/**
 * The answer string the gateway's clarify tool parses: one choice verbatim
 * (the tool strips a trailing "(Recommended)" marker itself), several choices
 * as a JSON list — Hermes Desktop's multi-select encoding — or typed text.
 * `undefined` means nothing has been answered yet.
 */
export function clarifyAnswerValue(input: {
  choices: readonly string[];
  draft: string;
  multiSelect: boolean;
}): string | undefined {
  if (input.choices.length > 0) {
    return input.multiSelect ? JSON.stringify(input.choices) : input.choices[0];
  }
  const draft = input.draft.trim();
  return draft ? draft : undefined;
}

export interface StagedClarifyAnswer {
  choices: string[];
  draft: string;
}

/**
 * Seed a batch form from the answers the gateway already locked (a reconnect
 * replay): an answer matching a choice re-selects it, anything else becomes
 * the typed draft.
 */
export function stageLockedClarifyAnswers(
  questions: readonly WavePromptQuestion[],
): Record<string, StagedClarifyAnswer> {
  const staged: Record<string, StagedClarifyAnswer> = {};
  for (const question of questions) {
    if (question.answer === undefined) continue;
    const asChoice = question.choices.find(
      (choice) => choice === question.answer,
    );
    staged[question.questionId] = asChoice
      ? { choices: [asChoice], draft: '' }
      : { choices: [], draft: question.answer };
  }
  return staged;
}
