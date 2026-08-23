/**
 * Hermes gateway → Wave contract normalization.
 *
 * Pure functions only: the gateway's protocol shapes stop here and screens
 * keep consuming the normalized Wave types. Gateway payloads are untrusted
 * input — every field is validated or defaulted, never spread through.
 *
 * Compatibility baseline: `docs/hermes-connectivity.md`.
 */
import {
  WAVE_TOOL_DETAIL_MAX_CHARS,
  type WaveConversationMessage,
  type WaveSessionLiveStatus,
  type WaveSessionSource,
  type WaveSessionSummary,
  type WaveTimelineEntry,
  type WaveToolDetail,
} from '@wave/contracts';

/** Session row from `GET /api/sessions` (many columns; we take a few). */
export interface GatewaySessionRow {
  id?: unknown;
  title?: unknown;
  message_count?: unknown;
  tool_call_count?: unknown;
  started_at?: unknown;
  last_active?: unknown;
  ended_at?: unknown;
  preview?: unknown;
  pinned?: unknown;
  source?: unknown;
  is_active?: unknown;
  status?: unknown;
  unread?: unknown;
}

/** Message row from `GET /api/sessions/{id}/messages`. */
export interface GatewayMessageRow {
  id?: unknown;
  role?: unknown;
  display_kind?: unknown;
  content?: unknown;
  timestamp?: unknown;
  tool_name?: unknown;
  tool_calls?: unknown;
  tool_call_id?: unknown;
  reasoning?: unknown;
  reasoning_content?: unknown;
  reasoning_details?: unknown;
}

const MAX_TITLE_CHARS = 300;
const MAX_PREVIEW_CHARS = 1_000;
const MAX_CONTENT_CHARS = 1_000_000;
const MAX_TOOL_NAME_CHARS = 100;
const MAX_TOOL_DETAIL_CHARS = 4_000;

// Mirrors the source families in Hermes Desktop v2026.8.13, but collapses
// them into stable Wave-owned presentation categories. The upstream field is
// deliberately open-ended; unknown future sources stay reachable as `other`.
const CHAT_SESSION_SOURCES = new Set([
  'cli',
  'codex',
  'desktop',
  'gateway',
  'local',
  'tui',
  'wave',
]);
const AUTOMATION_SESSION_SOURCES = new Set(['cron', 'kanban']);
const EXTERNAL_SESSION_SOURCES = new Set([
  'a2a',
  'api_server',
  'bluebubbles',
  'dingtalk',
  'discord',
  'email',
  'feishu',
  'homeassistant',
  'matrix',
  'mattermost',
  'photon',
  'qqbot',
  'signal',
  'slack',
  'sms',
  'telegram',
  'webhook',
  'wecom',
  'weixin',
  'whatsapp',
  'yuanbao',
]);

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function count(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : undefined;
}

export function normalizeSessionSource(value: unknown): WaveSessionSource {
  // Missing source is the compatibility path for v0.19 and for Wave-created
  // gateway chats that predate source persistence.
  if (value === undefined || value === null || value === '') return 'chat';
  if (typeof value !== 'string') return 'other';
  const source = value.trim().toLocaleLowerCase();
  if (!source) return 'chat';
  if (CHAT_SESSION_SOURCES.has(source)) return 'chat';
  if (AUTOMATION_SESSION_SOURCES.has(source)) return 'automation';
  if (EXTERNAL_SESSION_SOURCES.has(source)) return 'external';
  return 'other';
}

function normalizeSessionLiveStatus(
  row: GatewaySessionRow,
): WaveSessionLiveStatus {
  if (
    row.status === 'idle' ||
    row.status === 'starting' ||
    row.status === 'waiting' ||
    row.status === 'working'
  ) {
    return row.status;
  }
  // Hermes's legacy `is_active` list field means "recent and not ended", not
  // "a turn is executing". Mapping it to working would fabricate liveness.
  // Exact phases are adopted when the list exposes them; older rows are idle.
  return 'idle';
}

/**
 * Gateway timestamps are epoch seconds (floats). Wave contracts use ISO
 * strings with offsets; anything unparseable is dropped rather than faked.
 */
export function toIsoTimestamp(value: unknown): string | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  const millis = value < 1e12 ? value * 1000 : value;
  const date = new Date(millis);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export function normalizeSessionRow(
  row: GatewaySessionRow,
): WaveSessionSummary | undefined {
  const id = text(row.id, 256);
  if (!id) return undefined;
  const title = text(row.title, MAX_TITLE_CHARS);
  // Session previews are the newest user prompt, so they carry the same
  // image annotations as the stored message; fold them the same way. A
  // preview truncated mid-annotation will not match and renders as-is.
  const preview = text(
    typeof row.preview === 'string'
      ? foldImageAnnotations(row.preview)
      : row.preview,
    MAX_PREVIEW_CHARS,
  );
  const messageCount = count(row.message_count);
  const toolCallCount = count(row.tool_call_count);
  const startedAt = toIsoTimestamp(row.started_at);
  const lastActiveAt =
    toIsoTimestamp(row.last_active) ?? toIsoTimestamp(row.ended_at);
  return {
    id,
    ...(lastActiveAt ? { lastActiveAt } : {}),
    liveStatus: normalizeSessionLiveStatus(row),
    ...(messageCount === undefined ? {} : { messageCount }),
    pinned: row.pinned === true || row.pinned === 1,
    ...(preview ? { preview } : {}),
    source: normalizeSessionSource(row.source),
    ...(startedAt ? { startedAt } : {}),
    ...(title ? { title } : {}),
    ...(toolCallCount === undefined ? {} : { toolCallCount }),
    // The read watermark is server-derived (`last_read_at` vs `last_active`);
    // a missing field is "never tracked", which the gateway defines as read.
    unread: row.unread === true,
  };
}

export function normalizeSessionRows(value: unknown): WaveSessionSummary[] {
  const record = value as { data?: unknown; sessions?: unknown } | null;
  const rawRows = Array.isArray(record?.sessions)
    ? record.sessions
    : Array.isArray(record?.data)
      ? record.data
      : [];
  const rows = rawRows as GatewaySessionRow[];
  const seen = new Set<string>();
  const sessions: WaveSessionSummary[] = [];
  for (const row of rows) {
    const session = normalizeSessionRow(row ?? {});
    if (!session || seen.has(session.id)) continue;
    seen.add(session.id);
    sessions.push(session);
  }
  return sessions;
}

const ROLES = new Set(['assistant', 'system', 'tool', 'user']);

function normalizeRole(value: unknown): WaveConversationMessage['role'] {
  return typeof value === 'string' && ROLES.has(value)
    ? (value as WaveConversationMessage['role'])
    : 'unknown';
}

/**
 * Tool payloads cross as bounded inert text, per the Wave contract: never
 * rendered as Markdown, always explicitly truncated.
 */
export function toToolDetail(value: unknown) {
  if (value === undefined || value === null || value === '') return undefined;
  let serialized: string;
  if (typeof value === 'string') {
    serialized = value;
  } else {
    try {
      serialized = JSON.stringify(value) ?? '';
    } catch {
      return undefined;
    }
  }
  if (!serialized) return undefined;
  const truncated = serialized.length > MAX_TOOL_DETAIL_CHARS;
  return {
    text: truncated ? serialized.slice(0, MAX_TOOL_DETAIL_CHARS) : serialized,
    truncated,
  };
}

/**
 * The stored row's plain-text reasoning, with Hermes Desktop's precedence:
 * `reasoning`, then `reasoning_content`, then a string `reasoning_details`.
 * Opaque provider replay structures (`codex_*` items, detail arrays) never
 * cross — only already-plain text, bounded with an explicit truncation flag.
 */
function toReasoningDetail(row: GatewayMessageRow) {
  const value = [
    row.reasoning,
    row.reasoning_content,
    row.reasoning_details,
  ].find((candidate) => typeof candidate === 'string' && candidate.trim()) as
    string | undefined;
  if (!value) return undefined;
  const trimmed = value.trim();
  const truncated = trimmed.length > WAVE_TOOL_DETAIL_MAX_CHARS;
  return {
    text: truncated ? trimmed.slice(0, WAVE_TOOL_DETAIL_MAX_CHARS) : trimmed,
    truncated,
  };
}

// The gateway prepends an annotation pair to the stored user prompt for every
// attached image (verified on the v0.19/v0.20 baseline, including the two-image layout —
// one pair per image, each followed by a blank line, then the typed text):
//   [The user attached an image:\n<vision description>]\n
//   [You can examine it with vision_analyze using image_url: <server path>]
// Rendering that verbatim leaks the server's filesystem path and buries the
// typed message, so display normalization folds each pair into a bounded
// Wave-owned marker placed after the text, mirroring the optimistic composer
// presentation. Parsing is display-only and conservative: content that does
// not match exactly renders unchanged, and nothing here is executed.
const IMAGE_ANNOTATION_PATTERN =
  /^\[The user attached an image:\n([\s\S]*?)\]\n\[You can examine it with vision_analyze using image_url: [^\n]*\]\n?\n?/;
const MAX_IMAGE_MARKERS = 8;
const MAX_MARKER_DESCRIPTION_CHARS = 140;

export function foldImageAnnotations(content: string): string {
  const markers: string[] = [];
  let rest = content;
  while (markers.length < MAX_IMAGE_MARKERS) {
    const match = IMAGE_ANNOTATION_PATTERN.exec(rest);
    if (!match) break;
    const description = match[1].replace(/\s+/g, ' ').trim();
    const bounded =
      description.length > MAX_MARKER_DESCRIPTION_CHARS
        ? `${description.slice(0, MAX_MARKER_DESCRIPTION_CHARS)}…`
        : description;
    markers.push(bounded ? `[Attached image: ${bounded}]` : '[Attached image]');
    rest = rest.slice(match[0].length);
  }
  if (markers.length === 0) return content;
  return [rest.trim(), ...markers].filter(Boolean).join('\n');
}

export function normalizeMessageRow(
  row: GatewayMessageRow,
): WaveConversationMessage | undefined {
  const role = normalizeRole(row.role);
  // `display_kind: 'hidden'` rows are model-facing scaffolding the gateway
  // persists for off-screen sends (v0.20.5 widget intents); no client renders
  // them as a bubble, and Hermes Desktop drops their content the same way.
  if (row.display_kind === 'hidden') return undefined;
  const rawContent = typeof row.content === 'string' ? row.content : '';
  let content =
    rawContent.length > MAX_CONTENT_CHARS
      ? rawContent.slice(0, MAX_CONTENT_CHARS)
      : rawContent;
  if (role === 'user') {
    content = foldImageAnnotations(content);
  }
  const toolName = text(row.tool_name, MAX_TOOL_NAME_CHARS);
  const toolInput = toToolDetail(row.tool_calls);
  const createdAt = toIsoTimestamp(row.timestamp);
  const reasoning = role === 'assistant' ? toReasoningDetail(row) : undefined;
  // A row with no content, tool identity, or reasoning carries nothing to
  // render. Thinking-only assistant rows (reasoning without visible text)
  // are real and must survive.
  if (!content && !toolName && !reasoning) return undefined;
  return {
    content,
    ...(createdAt ? { createdAt } : {}),
    // display_kind rows are presentational; the gateway excludes them from
    // its regenerate ordinal space, so Wave records that exemption.
    ...(typeof row.display_kind === 'string' && row.display_kind
      ? { ordinalExempt: true }
      : {}),
    ...(reasoning ? { reasoning } : {}),
    role,
    ...(toolInput ? { toolInput } : {}),
    ...(toolName ? { toolName } : {}),
    ...(role === 'tool' && content
      ? { toolOutput: { text: content, truncated: false } }
      : {}),
  };
}

const MAX_CORRELATED_TOOL_CALLS = 32;
const MAX_TOOL_CALL_ID_CHARS = 200;

interface CorrelatedToolCall {
  id?: string;
  input: WaveToolDetail;
  name?: string;
}

/**
 * The arguments of one assistant row's `tool_calls`, parsed defensively.
 * Entries follow the OpenAI-style layout (`{ id, function: { name,
 * arguments } }`) with flat `name`/`arguments` variants tolerated; anything
 * unrecognized simply yields no correlation rather than a guess.
 */
function parseAssistantToolCalls(value: unknown): CorrelatedToolCall[] {
  let calls: unknown = value;
  if (typeof calls === 'string') {
    try {
      calls = JSON.parse(calls);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(calls)) return [];
  const parsed: CorrelatedToolCall[] = [];
  for (const entry of calls.slice(0, MAX_CORRELATED_TOOL_CALLS)) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const fn =
      record.function && typeof record.function === 'object'
        ? (record.function as Record<string, unknown>)
        : undefined;
    const input = toToolDetail(
      fn?.arguments ?? record.arguments ?? record.args ?? record.input,
    );
    if (!input) continue;
    const id = text(record.id, MAX_TOOL_CALL_ID_CHARS);
    const name = text(
      fn?.name ?? record.tool_name ?? record.name,
      MAX_TOOL_NAME_CHARS,
    );
    parsed.push({
      ...(id ? { id } : {}),
      input,
      ...(name ? { name } : {}),
    });
  }
  return parsed;
}

/**
 * Gateway message rows → Wave timeline entries. The gateway has no handoff
 * concept (that was the companion's ledger), so every entry is a message.
 * Entry ids must be stable: the timeline uses them as list keys, so when a
 * row carries no id the fallback uses the row's absolute offset in the full
 * history (`indexBase` + position) rather than its position within one page.
 *
 * Hermes stores a call's arguments on the assistant row's `tool_calls` and
 * the result on the following tool rows (OpenAI-style history), so the walk
 * correlates them — by `tool_call_id` when both sides carry ids, else by
 * tool name in order — and the stored timeline keeps the same bounded input
 * the live stream carried in `tool.start`. Tool-call ids are consumed here
 * and never cross the boundary. A positive numeric message-row id crosses
 * separately as Wave's internal durable rewind address; it is never rendered.
 */
export function normalizeTimelineEntries(
  value: unknown,
  indexBase = 0,
): WaveTimelineEntry[] {
  const rows = Array.isArray((value as { messages?: unknown })?.messages)
    ? ((value as { messages: unknown[] }).messages as GatewayMessageRow[])
    : [];
  const entries: WaveTimelineEntry[] = [];
  let pendingCalls: (CorrelatedToolCall & { consumed: boolean })[] = [];
  rows.forEach((row, index) => {
    // The calling row's arguments are collected before the render check: an
    // assistant row carrying only tool_calls (no content, no reasoning)
    // renders nothing itself but still owns its results' inputs.
    if (normalizeRole(row?.role) === 'assistant') {
      const calls = parseAssistantToolCalls(row?.tool_calls);
      if (calls.length > 0) {
        // A fresh calling row supersedes leftovers from calls whose results
        // never arrived, so name-order matching cannot drift across turns.
        pendingCalls = calls.map((call) => ({ ...call, consumed: false }));
      }
    }
    let message = normalizeMessageRow(row ?? {});
    if (!message) return;
    if (message.role === 'tool' && !message.toolInput) {
      // One pending list with consumption: an id match must also retire the
      // call from name-order matching, or the same arguments would deliver
      // twice.
      const callId = text(row?.tool_call_id, MAX_TOOL_CALL_ID_CHARS);
      const match =
        (callId
          ? pendingCalls.find((call) => !call.consumed && call.id === callId)
          : undefined) ??
        (message.toolName
          ? pendingCalls.find(
              (call) => !call.consumed && call.name === message?.toolName,
            )
          : undefined);
      if (match) {
        match.consumed = true;
        message = { ...message, toolInput: match.input };
      }
    }
    const rawId = row?.id;
    const rowId =
      typeof rawId === 'number' && Number.isInteger(rawId) && rawId > 0
        ? rawId
        : undefined;
    const id =
      typeof rawId === 'number' || typeof rawId === 'string'
        ? `msg-${String(rawId)}`
        : `msg-index-${indexBase + index}`;
    entries.push({
      id,
      message,
      ...(rowId === undefined ? {} : { rowId }),
      source: 'hermes',
      // The gateway does not group rows into turns; each message carries its
      // own synthetic turn id and the chat grouping works from roles alone.
      turnId: id,
      type: 'message',
    });
  });
  return entries;
}
