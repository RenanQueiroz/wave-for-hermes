import type { WaveSessionSummary } from '@wave/contracts';

export type WaveSessionFilter = 'activity' | 'all' | 'chats';
export type WaveSessionSectionId =
  'older' | 'pinned' | 'previous-seven-days' | 'today' | 'yesterday';

export interface WaveSessionSection {
  id: WaveSessionSectionId;
  label: string;
  sessions: WaveSessionSummary[];
}

const SECTION_LABELS: Record<WaveSessionSectionId, string> = {
  older: 'Older',
  pinned: 'Pinned',
  'previous-seven-days': 'Previous 7 days',
  today: 'Today',
  yesterday: 'Yesterday',
};

function sessionTimestamp(session: WaveSessionSummary): number {
  const parsed = Date.parse(session.lastActiveAt ?? session.startedAt ?? '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function compareRecent(
  left: WaveSessionSummary,
  right: WaveSessionSummary,
): number {
  return (
    sessionTimestamp(right) - sessionTimestamp(left) ||
    left.id.localeCompare(right.id)
  );
}

export function waveSessionMatchesFilter(
  session: WaveSessionSummary,
  filter: WaveSessionFilter,
): boolean {
  if (filter === 'all') return true;
  if (filter === 'chats') return session.source === 'chat';
  return session.source !== 'chat';
}

function calendarDayNumber(date: Date): number {
  return Math.floor(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000,
  );
}

function dateSection(
  session: WaveSessionSummary,
  today: number,
): Exclude<WaveSessionSectionId, 'pinned'> {
  const timestamp = sessionTimestamp(session);
  if (!timestamp) return 'older';
  const difference = today - calendarDayNumber(new Date(timestamp));
  if (difference <= 0) return 'today';
  if (difference === 1) return 'yesterday';
  if (difference <= 7) return 'previous-seven-days';
  return 'older';
}

/**
 * Build one mutually-exclusive pinned/date organization from normalized rows.
 * Pinned conversations never appear twice, and every matching row lands in a
 * section even when its timestamp is absent or malformed.
 */
export function organizeWaveSessions(
  sessions: readonly WaveSessionSummary[],
  filter: WaveSessionFilter,
  now = new Date(),
): WaveSessionSection[] {
  const matching = sessions
    .filter((session) => waveSessionMatchesFilter(session, filter))
    .sort(compareRecent);
  const buckets = new Map<WaveSessionSectionId, WaveSessionSummary[]>([
    ['pinned', []],
    ['today', []],
    ['yesterday', []],
    ['previous-seven-days', []],
    ['older', []],
  ]);
  const today = calendarDayNumber(now);
  for (const session of matching) {
    const section = session.pinned ? 'pinned' : dateSection(session, today);
    buckets.get(section)?.push(session);
  }
  return (
    ['pinned', 'today', 'yesterday', 'previous-seven-days', 'older'] as const
  ).flatMap((id) => {
    const grouped = buckets.get(id) ?? [];
    return grouped.length
      ? [{ id, label: SECTION_LABELS[id], sessions: grouped }]
      : [];
  });
}
