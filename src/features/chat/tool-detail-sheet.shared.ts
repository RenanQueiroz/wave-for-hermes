/**
 * Shared contract and formatting for the tool-detail bottom sheet: tapping a
 * tool Marker row presents the call's bounded input and output. Everything
 * shown here is the Wave-owned `WaveToolDetail` fields — inert plain text
 * with explicit truncation, never markdown, never raw ids.
 */
import type { WaveToolDetail } from '@wave/contracts';

export interface WaveToolCallDetail {
  input?: WaveToolDetail;
  output?: WaveToolDetail;
  outputIsPreview: boolean;
  status: 'complete' | 'error' | 'pending' | 'running';
  /** Humanized tool name or `Asked Hermes` — never a raw identifier. */
  title: string;
}

export interface ToolDetailSheetProps {
  /** The sheet is presented while a detail is set. */
  detail?: WaveToolCallDetail;
  onDismiss(): void;
}

export interface ToolDetailSection {
  key: 'input' | 'output';
  label: string;
  text: string;
  truncated: boolean;
}

/**
 * Pretty-printing can expand a payload well past the transfer bound; past
 * this point the raw text is shown instead of an even larger reflow.
 */
const MAX_PRETTY_CHARS = 96_000;

/**
 * Tool payloads are usually JSON: re-indent complete, parseable objects and
 * arrays for reading, and fall back to the raw bounded text for everything
 * else (XML, plain text, truncated JSON that no longer parses).
 */
export function formatToolDetailText(detail: WaveToolDetail): string {
  const trimmed = detail.text.trim();
  if (detail.truncated || !trimmed) return detail.text;
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return detail.text;
  try {
    const pretty = JSON.stringify(JSON.parse(trimmed), null, 2);
    if (typeof pretty === 'string' && pretty.length <= MAX_PRETTY_CHARS) {
      return pretty;
    }
  } catch {
    // Not valid JSON — show it exactly as it crossed the boundary.
  }
  return detail.text;
}

export function toolDetailSections(
  detail: WaveToolCallDetail,
): ToolDetailSection[] {
  const sections: ToolDetailSection[] = [];
  if (detail.input?.text.trim()) {
    sections.push({
      key: 'input',
      label: 'Input',
      text: formatToolDetailText(detail.input),
      truncated: detail.input.truncated,
    });
  }
  if (detail.output?.text.trim()) {
    sections.push({
      key: 'output',
      label:
        detail.outputIsPreview || detail.status === 'running'
          ? 'Output so far'
          : 'Output',
      text: formatToolDetailText(detail.output),
      truncated: detail.output.truncated,
    });
  }
  return sections;
}

export const TOOL_DETAIL_EMPTY_COPY =
  "Hermes didn't report input or output for this call.";

export const TOOL_DETAIL_TRUNCATED_COPY = "Truncated to fit Wave's size limit.";
