/**
 * Wave's slash-command surface: which commands exist here, how a typed `/`
 * is detected, and which lane a submission takes.
 *
 * The registry is deliberately conversation-level (see AGENTS.md): skills
 * and quick commands, the model picker, compression, status/usage reads, and
 * steering. Administration-flavored commands stay out and render an honest
 * "not in Wave" line instead of silently chatting the text at the model —
 * `prompt.submit` does not parse slash commands server-side.
 *
 * Trigger regexes are ported from Hermes Desktop (`composer/text-utils.ts`):
 * a `/` at position 0 is an invocation whose popover stays live through the
 * argument stage; a `/` after whitespace mid-message suggests skills only.
 */

// Relative import with extension: this module runs under the node test
// runner, which resolves neither `@/` nor extensionless paths.
import type { WaveCommandCatalog } from '../../services/gateway/gateway-commands.ts';

/** Text before the caret, from position 0: an invocation (+ argument stage). */
const SLASH_COMMAND_TRIGGER_RE = /^(\/)((?:[a-zA-Z][\w-]*(?:\s+\S*)*)?)$/;
/** A `/` after whitespace mid-message: an inline (skills-only) reference. */
const SLASH_INLINE_TRIGGER_RE = /[\s￼](\/)([a-zA-Z][\w-]*)?$/;
/** A submission whose first token is a slash command. */
const SLASH_SUBMIT_RE = /^\/[^\s/]+(?:\s|$)/;

export type WaveSlashTrigger =
  { kind: 'inline'; query: string } | { kind: 'invocation'; query: string };

/** Detect an open slash trigger in the text before the caret. */
export function detectSlashTrigger(
  textBeforeCaret: string,
): WaveSlashTrigger | undefined {
  const invocation = SLASH_COMMAND_TRIGGER_RE.exec(textBeforeCaret);
  if (invocation) return { kind: 'invocation', query: invocation[2] ?? '' };
  const inline = SLASH_INLINE_TRIGGER_RE.exec(textBeforeCaret);
  if (inline) return { kind: 'inline', query: inline[2] ?? '' };
  return undefined;
}

/** The leading `/command` token of a composed text, when there is one. */
export function leadingSlashToken(
  text: string,
): { arg: string; name: string } | undefined {
  const trimmed = text.trimStart();
  if (!SLASH_SUBMIT_RE.test(trimmed)) return undefined;
  const withoutSlash = trimmed.slice(1);
  const spaceIndex = withoutSlash.search(/\s/);
  const name =
    spaceIndex === -1 ? withoutSlash : withoutSlash.slice(0, spaceIndex);
  const arg =
    spaceIndex === -1 ? '' : withoutSlash.slice(spaceIndex + 1).trim();
  return { arg, name: name.toLowerCase() };
}

/** Local actions the chat screen wires up. */
export type WaveSlashLocalAction = 'model' | 'new' | 'resume' | 'stop';

export type WaveSlashSurface =
  | { action: WaveSlashLocalAction; kind: 'local' }
  | { kind: 'compress' }
  | { kind: 'execute' }
  | { kind: 'title' }
  | { kind: 'unavailable'; reason: string };

interface RegistryEntry {
  aliases?: string[];
  surface: WaveSlashSurface;
}

const NOT_IN_WAVE = 'is not part of Wave — use the Hermes desktop app or CLI.';

/**
 * The Wave registry. `execute` routes through the gateway's `slash.exec`
 * (which internally forwards skills, bundles, and pending-input commands to
 * `command.dispatch`); everything administration-flavored is explicitly
 * unavailable rather than absent, so it never leaks into a chat turn.
 */
const REGISTRY: Record<string, RegistryEntry> = {
  compress: { aliases: ['compact'], surface: { kind: 'compress' } },
  goal: { surface: { kind: 'execute' } },
  model: { surface: { action: 'model', kind: 'local' } },
  new: { surface: { action: 'new', kind: 'local' } },
  queue: { aliases: ['q'], surface: { kind: 'execute' } },
  resume: {
    aliases: ['sessions', 'switch'],
    surface: { action: 'resume', kind: 'local' },
  },
  retry: { surface: { kind: 'execute' } },
  status: { surface: { kind: 'execute' } },
  steer: { surface: { kind: 'execute' } },
  stop: { surface: { action: 'stop', kind: 'local' } },
  title: { surface: { kind: 'title' } },
  usage: { surface: { kind: 'execute' } },
};

/** Administration surface Wave deliberately refuses (AGENTS.md). */
const UNAVAILABLE = new Set([
  'agents',
  'approvals',
  'background',
  'browser',
  'clear',
  'config',
  'density',
  'cron',
  'debug',
  'exit',
  'fork',
  'handoff',
  'hatch',
  'journey',
  'personality',
  'pet',
  'profile',
  'reasoning',
  'rollback',
  'save',
  'skin',
  'snapshot',
  'statusbar',
  'tools',
  'undo',
  'version',
  'voice',
  'wake',
  'yolo',
]);

const ALIAS_TO_NAME: Record<string, string> = {};
for (const [name, entry] of Object.entries(REGISTRY)) {
  ALIAS_TO_NAME[name] = name;
  for (const alias of entry.aliases ?? []) ALIAS_TO_NAME[alias] = name;
}

export interface WaveSlashResolution {
  arg: string;
  /** The canonical name without the slash. */
  name: string;
  surface: WaveSlashSurface;
}

/**
 * Route a submitted text. `undefined` means "not a slash submission" —
 * ordinary prompt (or correction) text. Unknown names resolve through the
 * catalog: cataloged commands and skills execute on the gateway; a name the
 * catalog has never heard of stays ordinary text, so a stray "/shrug" cannot
 * become a failed command by accident.
 */
export function resolveSlashSubmission(
  text: string,
  catalog: WaveCommandCatalog | undefined,
): WaveSlashResolution | undefined {
  const token = leadingSlashToken(text);
  if (!token) return undefined;

  const canonical = catalog?.canon[`/${token.name}`];
  const canonicalName = canonical
    ? canonical.slice(1).toLowerCase()
    : token.name;

  const registryName =
    ALIAS_TO_NAME[canonicalName] ?? ALIAS_TO_NAME[token.name];
  if (registryName) {
    return {
      arg: token.arg,
      name: registryName,
      surface: REGISTRY[registryName].surface,
    };
  }
  if (UNAVAILABLE.has(canonicalName)) {
    return {
      arg: token.arg,
      name: canonicalName,
      surface: {
        kind: 'unavailable',
        reason: `/${canonicalName} ${NOT_IN_WAVE}`,
      },
    };
  }
  if (canonical) {
    // Cataloged but not special-cased: skills, quick commands, and the rest
    // of the conversation-level registry run on the gateway.
    return {
      arg: token.arg,
      name: canonicalName,
      surface: { kind: 'execute' },
    };
  }
  return undefined;
}

/**
 * The busy-composer lane decision (Desktop parity): recognized slash text
 * dispatches as a command even while a turn runs; anything else keeps Wave's
 * correction semantics. Slash text must never reach `session.redirect`.
 */
export function busyComposerLane(
  text: string,
  catalog: WaveCommandCatalog | undefined,
): 'command' | 'correction' {
  return resolveSlashSubmission(text, catalog) ? 'command' : 'correction';
}

/** The `/name` prefix length to highlight in the composer, or 0. */
export function highlightedCommandLength(
  text: string,
  catalog: WaveCommandCatalog | undefined,
): number {
  const resolution = resolveSlashSubmission(text, catalog);
  if (!resolution) return 0;
  const token = leadingSlashToken(text);
  return token ? text.indexOf('/') + 1 + token.name.length : 0;
}
