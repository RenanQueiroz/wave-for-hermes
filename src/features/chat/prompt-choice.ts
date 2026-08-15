/** Presentation-only parsing for Hermes clarification choice labels. */
export function promptChoicePresentation(choice: string): {
  label: string;
  recommended: boolean;
} {
  const label = choice.replace(/\s+\(recommended\)$/i, '').trim();
  const recommended = label !== choice.trim();
  return { label: label || choice, recommended };
}
