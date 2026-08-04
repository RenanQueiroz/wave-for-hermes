import type { WaveTimelineEntry, WaveTimelineResponse } from '@wave/contracts';
import { WAVE_MAX_REDIRECT_CHARS } from '@wave/contracts';
import type { InfiniteData, QueryClient } from '@tanstack/react-query';

import {
  waveSessionDataQueryKey,
  waveTimelineQueryKey,
} from './session-query-keys.ts';

const MAX_CORRECTIONS_PER_SESSION = 32;

export interface WaveCorrectionJournalEntry {
  anchorText: string;
  createdAt: string;
  id: string;
  text: string;
}

export function waveCorrectionJournalQueryKey(
  connectionId: string,
  baseUrl: string,
  sessionId: string,
) {
  return [
    ...waveSessionDataQueryKey(connectionId, baseUrl, sessionId),
    'corrections',
  ] as const;
}

export function addWaveCorrectionJournalEntry(
  queryClient: QueryClient,
  {
    baseUrl,
    connectionId,
    entry,
    sessionId,
  }: {
    baseUrl: string;
    connectionId: string;
    entry: WaveCorrectionJournalEntry;
    sessionId: string;
  },
) {
  const normalized = normalizeJournalEntry(entry);
  if (!normalized) return;
  const journalKey = waveCorrectionJournalQueryKey(
    connectionId,
    baseUrl,
    sessionId,
  );
  queryClient.setQueryData<WaveCorrectionJournalEntry[]>(
    journalKey,
    (current = []) =>
      [
        ...current.filter((item) => item.id !== normalized.id),
        normalized,
      ].slice(-MAX_CORRECTIONS_PER_SESSION),
  );

  // Keep the mounted chat and the persisted timeline cache aligned
  // immediately. The reducer still owns the live optimistic row; this cache
  // update is the reload-safe copy used after the active turn settles.
  const timelineKey = waveTimelineQueryKey(connectionId, baseUrl, sessionId);
  queryClient.setQueryData<
    InfiniteData<WaveTimelineResponse, string | undefined>
  >(timelineKey, (current) =>
    current
      ? {
          ...current,
          pages: current.pages.map((page) =>
            mergeWaveCorrectionsIntoTimeline(page, [normalized]),
          ),
        }
      : current,
  );
}

export function getWaveCorrectionJournal(
  queryClient: QueryClient,
  connectionId: string,
  baseUrl: string,
  sessionId: string,
): WaveCorrectionJournalEntry[] {
  const value = queryClient.getQueryData<unknown>(
    waveCorrectionJournalQueryKey(connectionId, baseUrl, sessionId),
  );
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => normalizeJournalEntry(entry))
    .filter((entry): entry is WaveCorrectionJournalEntry => Boolean(entry))
    .slice(-MAX_CORRECTIONS_PER_SESSION);
}

/**
 * Add accepted, app-owned corrections to the authoritative Hermes page.
 *
 * Hermes persists model-time redirects as ordinary user rows. During a tool,
 * however, v0.20 safely injects the correction into the tool-result boundary,
 * which can leave no distinct user row in the HTTP transcript. Wave keeps the
 * accepted text in its account-scoped offline cache and projects it after the
 * prompt that initiated the turn. We never derive a correction from tool
 * output: external content cannot impersonate the user.
 */
export function mergeWaveCorrectionsIntoTimeline(
  page: WaveTimelineResponse,
  journal: readonly WaveCorrectionJournalEntry[],
): WaveTimelineResponse {
  const entries = mergeWaveCorrectionsIntoTimelineEntries(
    page.entries,
    journal,
  );
  return entries === page.entries ? page : { ...page, entries };
}

/** Reconcile journal rows across the complete loaded timeline. */
export function mergeWaveCorrectionsIntoTimelineEntries(
  timelineEntries: readonly WaveTimelineEntry[],
  journal: readonly WaveCorrectionJournalEntry[],
): WaveTimelineEntry[] {
  if (journal.length === 0 || timelineEntries.length === 0) {
    return timelineEntries as WaveTimelineEntry[];
  }
  const localIds = new Set(
    journal.map((correction) => `wave-correction-${correction.id.trim()}`),
  );
  let entries = timelineEntries.some((entry) => localIds.has(entry.id))
    ? timelineEntries.filter((entry) => !localIds.has(entry.id))
    : (timelineEntries as WaveTimelineEntry[]);

  for (const correction of journal) {
    const normalized = normalizeJournalEntry(correction);
    if (!normalized) continue;
    const anchorIndex = findAnchorIndex(entries, normalized);
    if (anchorIndex < 0) continue;
    if (hasCanonicalCorrection(entries, anchorIndex, normalized.text)) {
      continue;
    }
    const localId = `wave-correction-${normalized.id}`;
    if (entries.some((entry) => entry.id === localId)) continue;
    const entry: WaveTimelineEntry = {
      id: localId,
      message: {
        content: normalized.text,
        createdAt: normalized.createdAt,
        role: 'user',
      },
      source: 'wave',
      turnId: localId,
      type: 'message',
    };
    let insertAt = anchorIndex + 1;
    while (insertAt < entries.length) {
      const candidate = entries[insertAt];
      if (
        candidate.type !== 'message' ||
        candidate.source !== 'wave' ||
        candidate.message.role !== 'user'
      ) {
        break;
      }
      insertAt += 1;
    }
    entries = [
      ...entries.slice(0, insertAt),
      entry,
      ...entries.slice(insertAt),
    ];
  }

  return entries;
}

function normalizeJournalEntry(
  value: unknown,
): WaveCorrectionJournalEntry | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const entry = value as Partial<WaveCorrectionJournalEntry>;
  const anchorText =
    typeof entry.anchorText === 'string' ? entry.anchorText.trim() : '';
  const text = typeof entry.text === 'string' ? entry.text.trim() : '';
  const id = typeof entry.id === 'string' ? entry.id.trim() : '';
  const createdAt =
    typeof entry.createdAt === 'string' ? entry.createdAt.trim() : '';
  if (
    !anchorText ||
    anchorText.length > WAVE_MAX_REDIRECT_CHARS ||
    !text ||
    text.length > WAVE_MAX_REDIRECT_CHARS ||
    !id ||
    id.length > 256 ||
    !createdAt ||
    Number.isNaN(Date.parse(createdAt))
  ) {
    return undefined;
  }
  return { anchorText, createdAt, id, text };
}

function findAnchorIndex(
  entries: readonly WaveTimelineEntry[],
  correction: WaveCorrectionJournalEntry,
) {
  const correctionTime = Date.parse(correction.createdAt);
  let fallback = -1;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (
      entry.type !== 'message' ||
      entry.message.role !== 'user' ||
      !matchesAnchorContent(entry.message.content, correction.anchorText)
    ) {
      continue;
    }
    fallback = index;
    const entryTime = entry.message.createdAt
      ? Date.parse(entry.message.createdAt)
      : Number.NaN;
    if (Number.isNaN(entryTime) || entryTime <= correctionTime) {
      return index;
    }
  }
  return fallback;
}

function matchesAnchorContent(content: string, anchorText: string) {
  const normalized = content.trim();
  return (
    normalized === anchorText ||
    normalized.startsWith(`${anchorText}\n[Attached image`)
  );
}

function hasCanonicalCorrection(
  entries: readonly WaveTimelineEntry[],
  anchorIndex: number,
  text: string,
) {
  for (const entry of entries.slice(anchorIndex + 1)) {
    if (
      entry.type === 'message' &&
      entry.source === 'hermes' &&
      entry.message.role === 'user'
    ) {
      return entry.message.content.trim() === text;
    }
  }
  return false;
}
