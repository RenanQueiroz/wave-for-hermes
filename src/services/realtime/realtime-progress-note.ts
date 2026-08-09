/**
 * Sanitize one sealed interim narration segment into a bounded, inert
 * plain-text progress note for the Realtime session. Only assistant
 * narration ever reaches this (tool records, reasoning, and prompts have
 * their own event types and are never fed); this module owns the other
 * rules: no Markdown control syntax, no code, explicit truncation.
 */

export const WAVE_MAX_REALTIME_PROGRESS_NOTE_CHARS = 1_000;
const TRUNCATION_MARKER = ' […]';

export function sanitizeRealtimeProgressNote(text: string): string {
  let plain = text
    // Fenced code blocks vanish whole — code is never narrated as progress.
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/```[\s\S]*$/g, ' ')
    // Images drop entirely; links keep their label and drop the URL.
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    // Heading, quote, and list markers at line starts.
    .replace(/^[ \t]*(?:#{1,6}[ \t]+|>[ \t]?|[-*+][ \t]+|\d+\.[ \t]+)/gm, '')
    // Inline emphasis, code, strikethrough, and table markers. Underscore
    // emphasis is stripped only at word boundaries so snake_case survives.
    .replace(/[`*~]/g, '')
    .replace(/__/g, '')
    .replace(/(^|[^\p{L}\p{N}])_([^_]+)_(?=[^\p{L}\p{N}]|$)/gu, '$1$2')
    .replace(/\|/g, ' ')
    // One line, single spaces: these notes are context, not layout.
    .replace(/\s+/g, ' ')
    .trim();
  if (plain.length > WAVE_MAX_REALTIME_PROGRESS_NOTE_CHARS) {
    plain =
      plain.slice(
        0,
        WAVE_MAX_REALTIME_PROGRESS_NOTE_CHARS - TRUNCATION_MARKER.length,
      ) + TRUNCATION_MARKER;
  }
  return plain;
}
