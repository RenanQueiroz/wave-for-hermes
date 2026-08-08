/**
 * Slash-command protocol shapes: normalization for `commands.catalog`,
 * `complete.slash`, and the `slash.exec`/`command.dispatch` result family.
 *
 * Catalog descriptions, completion labels, and command outputs are
 * gateway-authored text and stay bounded inert strings — never markdown,
 * never executed. Skill/bundle expansion messages (`send` directives) are
 * model-facing scaffolding: they go to `prompt.submit` verbatim while only
 * the bounded `display` projection may reach the screen.
 */

const MAX_CATALOG_ENTRIES = 200;
const MAX_COMPLETION_ITEMS = 30;
const MAX_COMMAND_CHARS = 60;
const MAX_DESCRIPTION_CHARS = 160;
const MAX_OUTPUT_CHARS = 8_000;
const MAX_SEND_MESSAGE_CHARS = 64_000;
const MAX_DISPLAY_CHARS = 500;

export interface WaveCommandCatalogEntry {
  command: string;
  description: string;
  kind: 'command' | 'skill';
  /** Recorded uses, for ranking skills the way Desktop does. */
  usage: number;
}

export interface WaveCommandCatalog {
  /** Lowercased alias → canonical command (both with the leading slash). */
  canon: Record<string, string>;
  entries: WaveCommandCatalogEntry[];
}

export interface WaveSlashCompletionItem {
  display: string;
  kind: 'command' | 'skill';
  meta: string;
  text: string;
}

export interface WaveSlashCompletion {
  items: WaveSlashCompletionItem[];
  /** > 1 marks an argument-stage completion that replaces from that column. */
  replaceFrom?: number;
}

/** What one executed command asks the client to do. */
export type WaveCommandDirective =
  | { kind: 'output'; output: string }
  | { kind: 'prefill'; message: string }
  | {
      display?: string;
      kind: 'send';
      message: string;
      notice?: string;
    };

function boundedText(value: unknown, cap: number): string {
  if (typeof value !== 'string') return '';
  const cleaned = value.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '');
  return cleaned.length > cap ? `${cleaned.slice(0, cap - 1)}…` : cleaned;
}

function slashName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!/^\/[A-Za-z][\w-]*$/.test(trimmed)) return undefined;
  return trimmed.length > MAX_COMMAND_CHARS ? undefined : trimmed;
}

export function normalizeCommandCatalog(payload: unknown): WaveCommandCatalog {
  const record =
    payload && typeof payload === 'object'
      ? (payload as Record<string, unknown>)
      : {};
  const skills =
    record.skills && typeof record.skills === 'object'
      ? (record.skills as Record<string, unknown>)
      : {};

  const entries: WaveCommandCatalogEntry[] = [];
  const seen = new Set<string>();
  const pairs = Array.isArray(record.pairs) ? record.pairs : [];
  for (const pair of pairs) {
    if (entries.length >= MAX_CATALOG_ENTRIES) break;
    if (!Array.isArray(pair)) continue;
    const command = slashName(pair[0]);
    if (!command || seen.has(command)) continue;
    seen.add(command);
    const skill =
      skills[command] && typeof skills[command] === 'object'
        ? (skills[command] as Record<string, unknown>)
        : undefined;
    entries.push({
      command,
      description: boundedText(pair[1], MAX_DESCRIPTION_CHARS).replace(
        /\s+/g,
        ' ',
      ),
      kind: skill ? 'skill' : 'command',
      usage:
        skill && typeof skill.usage === 'number' && skill.usage >= 0
          ? Math.min(skill.usage, 1_000_000)
          : 0,
    });
  }

  const canon: Record<string, string> = {};
  const canonRaw =
    record.canon && typeof record.canon === 'object'
      ? (record.canon as Record<string, unknown>)
      : {};
  for (const [alias, target] of Object.entries(canonRaw)) {
    if (Object.keys(canon).length >= MAX_CATALOG_ENTRIES * 2) break;
    const aliasName = slashName(alias);
    const targetName = slashName(target);
    if (aliasName && targetName) canon[aliasName.toLowerCase()] = targetName;
  }
  // Every catalog entry canonicalizes to itself even if `canon` was partial.
  for (const entry of entries) {
    canon[entry.command.toLowerCase()] ??= entry.command;
  }

  return { canon, entries };
}

export function normalizeSlashCompletion(
  payload: unknown,
): WaveSlashCompletion {
  const record =
    payload && typeof payload === 'object'
      ? (payload as Record<string, unknown>)
      : {};
  const items: WaveSlashCompletionItem[] = [];
  const rows = Array.isArray(record.items) ? record.items : [];
  for (const row of rows) {
    if (items.length >= MAX_COMPLETION_ITEMS) break;
    if (!row || typeof row !== 'object') continue;
    const item = row as Record<string, unknown>;
    const text = boundedText(item.text, MAX_COMMAND_CHARS * 2).trim();
    if (!text) continue;
    items.push({
      display: boundedText(item.display, MAX_DESCRIPTION_CHARS).trim() || text,
      kind: item.kind === 'skill' ? 'skill' : 'command',
      meta: boundedText(item.meta, MAX_DESCRIPTION_CHARS).replace(/\s+/g, ' '),
      text,
    });
  }
  const replaceFrom = record.replace_from;
  return {
    items,
    ...(typeof replaceFrom === 'number' &&
    Number.isInteger(replaceFrom) &&
    replaceFrom > 1
      ? { replaceFrom }
      : {}),
  };
}

/**
 * One normalization for both `slash.exec` results and `command.dispatch`
 * directives (`slash.exec` routes several command classes to the dispatcher
 * internally, so a single call can answer in either family). `alias`
 * directives are resolved by the caller's registry, not here.
 */
export function normalizeCommandResult(payload: unknown): {
  aliasTarget?: string;
  directive?: WaveCommandDirective;
} {
  const record =
    payload && typeof payload === 'object'
      ? (payload as Record<string, unknown>)
      : {};

  if (record.type === 'alias' && typeof record.target === 'string') {
    const target = record.target.trim().slice(0, MAX_COMMAND_CHARS * 2);
    return target ? { aliasTarget: target } : {};
  }
  if (record.type === 'prefill' && typeof record.message === 'string') {
    return {
      directive: {
        kind: 'prefill',
        message: boundedText(record.message, MAX_OUTPUT_CHARS),
      },
    };
  }
  if (
    (record.type === 'send' || record.type === 'skill') &&
    typeof record.message === 'string' &&
    record.message.trim()
  ) {
    // The expanded message is model-facing and must survive intact (a
    // truncated skill body would silently change what the agent is asked to
    // do), so an overlong one is refused rather than clipped.
    if (record.message.length > MAX_SEND_MESSAGE_CHARS) return {};
    const display = boundedText(record.display, MAX_DISPLAY_CHARS).trim();
    const notice = boundedText(record.notice, MAX_DISPLAY_CHARS).trim();
    return {
      directive: {
        kind: 'send',
        message: record.message,
        ...(display ? { display } : {}),
        ...(notice ? { notice } : {}),
      },
    };
  }
  if (typeof record.output === 'string') {
    return {
      directive: {
        kind: 'output',
        output: boundedText(record.output, MAX_OUTPUT_CHARS),
      },
    };
  }
  return {};
}
