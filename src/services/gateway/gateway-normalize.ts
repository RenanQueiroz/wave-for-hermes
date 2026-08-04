/**
 * Hermes gateway → Wave contract normalization.
 *
 * Pure functions only: the gateway's protocol shapes stop here and screens
 * keep consuming the normalized Wave types. Gateway payloads are untrusted
 * input — every field is validated or defaulted, never spread through.
 *
 * Compatibility baseline: `docs/hermes-connectivity.md`.
 */
import type {
  WaveConversationMessage,
  WaveSessionLiveStatus,
  WaveSessionSource,
  WaveSessionSummary,
  WaveTimelineEntry,
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
}

/** Message row from `GET /api/sessions/{id}/messages`. */
export interface GatewayMessageRow {
  id?: unknown;
  role?: unknown;
  content?: unknown;
  timestamp?: unknown;
  tool_name?: unknown;
  tool_calls?: unknown;
  tool_call_id?: unknown;
}

const MAX_TITLE_CHARS = 300;
const MAX_PREVIEW_CHARS = 1_000;
const MAX_CONTENT_CHARS = 1_000_000;
const MAX_TOOL_NAME_CHARS = 100;
const MAX_TOOL_DETAIL_CHARS = 4_000;

// Mirrors the source families in Hermes Desktop v2026.8.3, but collapses
// them into stable Wave-owned presentation categories. The upstream field is
// deliberately open-ended; unknown future sources stay reachable as `other`.
const CHAT_SESSION_SOURCES = new Set([
  'cli',
  'codex',
  'desktop',
  'gateway',
  'local',
  'tui',
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
  // A row with neither content nor a tool identity carries nothing to render.
  if (!content && !toolName) return undefined;
  return {
    content,
    ...(createdAt ? { createdAt } : {}),
    role,
    ...(toolInput ? { toolInput } : {}),
    ...(toolName ? { toolName } : {}),
    ...(role === 'tool' && content
      ? { toolOutput: { text: content, truncated: false } }
      : {}),
  };
}

/**
 * Gateway message rows → Wave timeline entries. The gateway has no handoff
 * concept (that was the companion's ledger), so every entry is a message.
 * Entry ids must be stable: the timeline uses them as list keys, so when a
 * row carries no id the fallback uses the row's absolute offset in the full
 * history (`indexBase` + position) rather than its position within one page.
 */
export function normalizeTimelineEntries(
  value: unknown,
  indexBase = 0,
): WaveTimelineEntry[] {
  const rows = Array.isArray((value as { messages?: unknown })?.messages)
    ? ((value as { messages: unknown[] }).messages as GatewayMessageRow[])
    : [];
  const entries: WaveTimelineEntry[] = [];
  rows.forEach((row, index) => {
    const message = normalizeMessageRow(row ?? {});
    if (!message) return;
    const rawId = row?.id;
    const id =
      typeof rawId === 'number' || typeof rawId === 'string'
        ? `msg-${String(rawId)}`
        : `msg-index-${indexBase + index}`;
    entries.push({
      id,
      message,
      source: 'hermes',
      // The gateway does not group rows into turns; each message stands alone
      // and the chat screen's turn grouping works from roles.
      turnId: id,
      type: 'message',
    });
  });
  return entries;
}
