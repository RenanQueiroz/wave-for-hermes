/**
 * Where Branch and Refresh aim, computed only from server-fetched timeline
 * entries — never from local projections.
 *
 * The gateway's regenerate ordinal space is "user rows without a
 * `display_kind`", so rows Wave itself injected (`source: 'wave'`, the
 * correction journal) and server rows flagged `ordinalExempt` are excluded.
 * An assistant id the timeline does not know belongs to a just-completed
 * live turn, which is by definition the tail: Refresh replays the last
 * qualifying user message and Branch copies the whole history (`count`
 * omitted — the exact case, with no ordinal math to get wrong).
 */
import type { WaveTimelineResponse } from '@wave/contracts';

type WaveTimelineEntry = WaveTimelineResponse['entries'][number];

function qualifiesForOrdinal(entry: WaveTimelineEntry): boolean {
  return (
    entry.type === 'message' &&
    entry.source === 'hermes' &&
    entry.message.role === 'user' &&
    entry.message.ordinalExempt !== true &&
    Boolean(entry.message.content.trim())
  );
}

export interface RegenerateTarget {
  /** Timeline id of the user entry being replayed (for cache pruning). */
  entryId: string;
  /** The visible user ordinal in the gateway's own counting space. */
  ordinal: number;
  /** The exact user text to re-send. */
  text: string;
}

/**
 * The user turn a Refresh on `assistantEntryId` replays. Entries must be the
 * full timeline in display order (oldest first).
 */
export function regenerateTarget(
  entries: readonly WaveTimelineEntry[],
  assistantEntryId: string,
): RegenerateTarget | undefined {
  const anchor = entries.findIndex((entry) => entry.id === assistantEntryId);
  const scanFrom = anchor === -1 ? entries.length - 1 : anchor;
  let ordinal = -1;
  let target: RegenerateTarget | undefined;
  for (let index = 0; index <= scanFrom && index < entries.length; index += 1) {
    const entry = entries[index];
    if (!qualifiesForOrdinal(entry)) continue;
    ordinal += 1;
    if (entry.type === 'message') {
      target = { entryId: entry.id, ordinal, text: entry.message.content };
    }
  }
  return target;
}

/**
 * Optimistically drop the replayed user entry and everything after it (in
 * display order) from every cached timeline page; the post-turn refetch is
 * authoritative either way, and a refused regenerate restores the rows.
 */
export function collectPrunedEntryIds(
  displayOrderedEntries: readonly WaveTimelineEntry[],
  fromEntryId: string,
): Set<string> {
  const start = displayOrderedEntries.findIndex(
    (entry) => entry.id === fromEntryId,
  );
  if (start === -1) return new Set();
  return new Set(displayOrderedEntries.slice(start).map((entry) => entry.id));
}

/**
 * The `session.branch` count for a branch at `assistantEntryId`: the number
 * of visible transcript messages up to and including it — Desktop's own
 * approximation of the agent-history slice. `undefined` means "branch the
 * whole history" (the tail case, exact by construction).
 */
export function branchCount(
  entries: readonly WaveTimelineEntry[],
  assistantEntryId: string,
): number | undefined {
  const anchor = entries.findIndex((entry) => entry.id === assistantEntryId);
  if (anchor === -1) return undefined;
  const isLastMessage = !entries
    .slice(anchor + 1)
    .some((entry) => entry.type === 'message' && entry.source === 'hermes');
  if (isLastMessage) return undefined;
  let count = 0;
  for (let index = 0; index <= anchor; index += 1) {
    const entry = entries[index];
    if (entry.type === 'message' && entry.source === 'hermes') count += 1;
  }
  return count;
}
