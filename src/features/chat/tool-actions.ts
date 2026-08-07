/**
 * Wave-owned presentation mapping from tool calls to one-line actions.
 *
 * Tool names and arguments are untrusted data: everything produced here is
 * bounded, single-line, inert plain text — never markdown, never executed.
 * Unknown tools stay reachable through the generic fallback instead of
 * disappearing, mirroring how unknown session sources stay listed.
 */
import type { WaveToolDetail } from '@wave/contracts';

export interface WaveToolAction {
  /** Leading verb phrase, e.g. `Read` or `Asked Hermes`. */
  verb: string;
  /** Bounded free-text remainder (command, query, URL, instruction). */
  detail?: string;
  /** Path-shaped value for a file chip; mutually exclusive with detail. */
  file?: string;
}

const MAX_DETAIL_CHARS = 96;
const MAX_FILE_CHARS = 72;

/** Collapse to one bounded line with control characters stripped. */
function singleLine(value: string, max: number): string {
  const collapsed = value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (collapsed.length <= max) return collapsed;
  return `${collapsed.slice(0, max - 1)}…`;
}

/**
 * Parse the bounded input JSON defensively. Truncated or malformed payloads
 * simply yield no arguments — the action falls back to its verb alone.
 */
function parseArguments(
  input?: WaveToolDetail,
): Record<string, unknown> | undefined {
  if (!input || input.truncated) return undefined;
  try {
    const parsed: unknown = JSON.parse(input.text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Not JSON — treat as absent rather than guessing at structure.
  }
  return undefined;
}

function stringArgument(
  args: Record<string, unknown> | undefined,
  keys: readonly string[],
): string | undefined {
  if (!args) return undefined;
  for (const key of keys) {
    const value = args[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}

export function formatToolName(name: string) {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!words) return 'Hermes tool';
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

function normalizeToolKey(name: string): string {
  return name.toLowerCase().replace(/[\s_-]+/g, '');
}

interface ToolRule {
  argumentKeys: readonly string[];
  isFile?: boolean;
  verb: string;
}

const TOOL_RULES: Record<string, ToolRule> = {
  bash: { argumentKeys: ['command', 'cmd', 'script'], verb: 'Ran' },
  browse: { argumentKeys: ['url'], verb: 'Fetched' },
  cat: {
    argumentKeys: ['path', 'file_path', 'file'],
    isFile: true,
    verb: 'Read',
  },
  createfile: {
    argumentKeys: ['path', 'file_path', 'file'],
    isFile: true,
    verb: 'Wrote',
  },
  edit: {
    argumentKeys: ['path', 'file_path', 'file'],
    isFile: true,
    verb: 'Edited',
  },
  editfile: {
    argumentKeys: ['path', 'file_path', 'file'],
    isFile: true,
    verb: 'Edited',
  },
  exec: { argumentKeys: ['command', 'cmd', 'script'], verb: 'Ran' },
  fetch: { argumentKeys: ['url'], verb: 'Fetched' },
  grep: { argumentKeys: ['pattern', 'query', 'q'], verb: 'Searched' },
  httprequest: { argumentKeys: ['url'], verb: 'Fetched' },
  listdir: {
    argumentKeys: ['path', 'dir', 'directory'],
    isFile: true,
    verb: 'Listed',
  },
  ls: {
    argumentKeys: ['path', 'dir', 'directory'],
    isFile: true,
    verb: 'Listed',
  },
  openurl: { argumentKeys: ['url'], verb: 'Fetched' },
  read: {
    argumentKeys: ['path', 'file_path', 'file'],
    isFile: true,
    verb: 'Read',
  },
  readfile: {
    argumentKeys: ['path', 'file_path', 'file'],
    isFile: true,
    verb: 'Read',
  },
  runcommand: { argumentKeys: ['command', 'cmd', 'script'], verb: 'Ran' },
  search: { argumentKeys: ['query', 'q', 'pattern'], verb: 'Searched' },
  shell: { argumentKeys: ['command', 'cmd', 'script'], verb: 'Ran' },
  terminal: { argumentKeys: ['command', 'cmd', 'script'], verb: 'Ran' },
  webfetch: { argumentKeys: ['url'], verb: 'Fetched' },
  websearch: { argumentKeys: ['query', 'q'], verb: 'Searched' },
  write: {
    argumentKeys: ['path', 'file_path', 'file'],
    isFile: true,
    verb: 'Wrote',
  },
  writefile: {
    argumentKeys: ['path', 'file_path', 'file'],
    isFile: true,
    verb: 'Wrote',
  },
};

/**
 * Derive the bounded one-line action for a tool part. Handoffs are detected
 * by the Wave-constructed `-handoff` id suffix, not by their title, so a
 * tool whose name mimics the handoff label cannot impersonate one.
 */
export function deriveToolAction(part: {
  id: string;
  input?: WaveToolDetail;
  title: string;
}): WaveToolAction {
  if (part.id.endsWith('-handoff')) {
    const summary = part.title.startsWith('Hermes · ')
      ? part.title.slice('Hermes · '.length)
      : undefined;
    return {
      verb: 'Asked Hermes',
      ...(summary ? { detail: singleLine(summary, MAX_DETAIL_CHARS) } : {}),
    };
  }

  const rule = TOOL_RULES[normalizeToolKey(part.title)];
  if (!rule) {
    return { detail: formatToolName(part.title), verb: 'Called' };
  }
  const value = stringArgument(parseArguments(part.input), rule.argumentKeys);
  if (!value) return { verb: rule.verb };
  return rule.isFile
    ? { file: singleLine(value, MAX_FILE_CHARS), verb: rule.verb }
    : { detail: singleLine(value, MAX_DETAIL_CHARS), verb: rule.verb };
}

/** The action as one plain string, for Task trigger titles. */
export function toolActionLabel(action: WaveToolAction): string {
  const remainder = action.file ?? action.detail;
  return remainder ? `${action.verb} ${remainder}` : action.verb;
}
