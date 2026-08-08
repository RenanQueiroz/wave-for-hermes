/**
 * Compact relative timestamps for the turn action row, Desktop-style: the
 * coarsest elapsed unit only, so the row never grows ("now", "5s ago",
 * "3m ago", "2h ago", "4d ago"). The absolute form appears on tap.
 */

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** A missing or unparsable timestamp reads as a freshly created message. */
export function formatTimeAgo(iso: string | undefined, now: number): string {
  const time = iso ? Date.parse(iso) : Number.NaN;
  if (!Number.isFinite(time)) return 'now';
  const elapsed = now - time;
  if (elapsed < 2_000) return 'now';
  if (elapsed < MINUTE_MS) return `${Math.floor(elapsed / 1_000)}s ago`;
  if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)}m ago`;
  if (elapsed < DAY_MS) return `${Math.floor(elapsed / HOUR_MS)}h ago`;
  return `${Math.floor(elapsed / DAY_MS)}d ago`;
}

/** "Today 14:30", "Yesterday 09:05", or "5 Jun 14:30". */
export function formatAbsoluteTime(
  iso: string | undefined,
  now: number,
): string {
  const time = iso ? Date.parse(iso) : Number.NaN;
  if (!Number.isFinite(time)) return 'just now';
  const date = new Date(time);
  const nowDate = new Date(now);
  const hours = `${date.getHours()}`.padStart(2, '0');
  const minutes = `${date.getMinutes()}`.padStart(2, '0');
  const clock = `${hours}:${minutes}`;
  const sameDay =
    date.getFullYear() === nowDate.getFullYear() &&
    date.getMonth() === nowDate.getMonth() &&
    date.getDate() === nowDate.getDate();
  if (sameDay) return `Today ${clock}`;
  const yesterday = new Date(now - DAY_MS);
  const isYesterday =
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate();
  if (isYesterday) return `Yesterday ${clock}`;
  const month = date.toLocaleString('en', { month: 'short' });
  return `${date.getDate()} ${month} ${clock}`;
}
