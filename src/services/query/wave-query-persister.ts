import type {
  PersistedClient,
  Persister,
} from '@tanstack/react-query-persist-client';

/**
 * Storage seam for the persisted query cache so the persister itself stays a
 * pure module that node tests can exercise with an in-memory implementation.
 */
export interface WaveQueryCacheStorage {
  delete(): void | Promise<void>;
  read(): string | undefined | Promise<string | undefined>;
  write(value: string): void | Promise<void>;
}

/** Bump to invalidate every previously persisted cache. */
// v2 invalidates rows persisted before normalized source/pin/live-status
// fields became part of every WaveSessionSummary.
export const WAVE_QUERY_CACHE_BUSTER = 'wave-query-cache-v2';
export const WAVE_QUERY_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60_000;

/**
 * Only long-lived conversation data is persisted: the session list,
 * per-session timelines, and bounded accepted-correction journals. Everything
 * else is cheap to refetch, device-run specific (diagnostics), or operational
 * state that must never be shown stale without a fresh read (scheduled jobs).
 */
export function shouldPersistWaveQuery(
  queryKey: readonly unknown[],
  state: { status: string },
): boolean {
  if (state.status !== 'success') {
    return false;
  }
  const [root, , , scope] = queryKey;
  return root === 'wave' && (scope === 'session-list' || scope === 'sessions');
}

/**
 * A minimal TanStack persister over one JSON document. Every failure path
 * degrades to "no cache": persistence must never break live behavior.
 */
export function createWaveQueryPersister(
  storage: WaveQueryCacheStorage,
): Persister {
  return {
    persistClient: async (client: PersistedClient) => {
      // Never overwrite a good cache with an empty one. Offline reads fail,
      // failed queries are excluded from the dehydrated state, and the result
      // is an empty document — so without this guard a single offline start
      // erases every conversation the cache existed to keep readable. An
      // empty write is worth nothing anyway: the alternative is restoring
      // slightly older data, still bounded by the cache's max age.
      if (client.clientState.queries.length === 0) {
        return;
      }
      try {
        await storage.write(JSON.stringify(client));
      } catch {
        // Losing a cache write is invisible; the next successful one heals it.
      }
    },
    removeClient: async () => {
      try {
        await storage.delete();
      } catch {
        // Best effort; an unreadable cache is also rejected on restore.
      }
    },
    restoreClient: async () => {
      let raw: string | undefined;
      try {
        raw = await storage.read();
      } catch {
        return undefined;
      }
      if (!raw) {
        return undefined;
      }
      try {
        return JSON.parse(raw) as PersistedClient;
      } catch {
        // A document that no longer parses is unrecoverable. Deleting it
        // makes the corruption observable as a clean empty cache instead of
        // leaving a permanently unreadable file behind.
        try {
          await storage.delete();
        } catch {
          // Best effort; the next successful persist replaces it anyway.
        }
        return undefined;
      }
    },
  };
}
