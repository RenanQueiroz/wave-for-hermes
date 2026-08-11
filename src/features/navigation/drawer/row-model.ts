import type { WaveSessionSummary } from '@wave/contracts';

// Relative .ts imports keep this module loadable by the node test runner,
// which cannot resolve the `@/` alias.
import type {
  WaveSessionFilter,
  WaveSessionSectionId,
} from '../../sessions/session-organization.ts';
import { WaveBackendError } from '../../../services/wave/wave-backend-error.ts';

export type DrawerSessionListItem =
  | {
      id: string;
      kind: 'section';
      label: string;
      sectionId: WaveSessionSectionId;
    }
  | { id: string; kind: 'session'; session: WaveSessionSummary };

/**
 * The reserved leading glyph column of a single-line session row. Live status
 * wins over the source symbol; idle chats leave the column empty so titles
 * stay aligned.
 */
export type DrawerRowGlyph =
  | { kind: 'live'; label: string; status: 'starting' | 'waiting' | 'working' }
  | { kind: 'none' }
  | {
      kind: 'source';
      label: string;
      source: 'automation' | 'external' | 'other';
    };

const LIVE_STATUS_LABELS = {
  starting: 'Starting',
  waiting: 'Waiting for input',
  working: 'Working',
} as const;

const SOURCE_LABELS = {
  automation: 'Automation',
  external: 'External activity',
  other: 'Other activity',
} as const;

export function sessionTitle(session: WaveSessionSummary) {
  return session.title ?? 'Untitled chat';
}

export function drawerRowGlyph(
  session: WaveSessionSummary,
  filter: WaveSessionFilter,
): DrawerRowGlyph {
  if (session.liveStatus !== 'idle') {
    return {
      kind: 'live',
      label: LIVE_STATUS_LABELS[session.liveStatus],
      status: session.liveStatus,
    };
  }
  // Source symbols only make sense where sources mix; the chats filter is
  // single-source by construction so its idle rows keep an empty column.
  if (filter === 'activity' && session.source !== 'chat') {
    return {
      kind: 'source',
      label: SOURCE_LABELS[session.source],
      source: session.source,
    };
  }
  return { kind: 'none' };
}

/** The row's accessible name keeps the status the glyph conveys visually. */
export function drawerRowAccessibilityLabel(
  session: WaveSessionSummary,
  glyph: DrawerRowGlyph,
) {
  const base = `Open conversation ${sessionTitle(session)}`;
  return glyph.kind === 'none' ? base : `${base}, ${glyph.label}`;
}

export function emptySessionFilterMessage(filter: WaveSessionFilter) {
  if (filter === 'activity') {
    return 'No conversations from other sources.';
  }
  return 'No previous chats.';
}

export function drawerErrorMessage(error: unknown) {
  if (error instanceof WaveBackendError) return error.message;
  return 'Wave could not update the conversation.';
}

export const SESSION_FILTERS: readonly {
  accessibilityLabel: string;
  label: string;
  value: WaveSessionFilter;
}[] = [
  { accessibilityLabel: 'Show chats', label: 'Chats', value: 'chats' },
  {
    accessibilityLabel: 'Show conversations from automations and other sources',
    label: 'Other sources',
    value: 'activity',
  },
];

export const DRAWER_COPY = {
  deleteMessage: (session: WaveSessionSummary | undefined) =>
    session
      ? `“${sessionTitle(session)}” will be permanently deleted from Hermes.`
      : 'This conversation will be permanently deleted from Hermes.',
  deleteTitle: 'Delete conversation?',
  offlineNotice: 'Offline — showing cached conversations',
  renameMessage: 'This changes the title in Hermes for every connected client.',
  renameTitle: 'Rename conversation',
} as const;
