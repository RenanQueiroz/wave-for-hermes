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
export const WAVE_QUERY_CACHE_BUSTER = 'wave-query-cache-v1';
export const WAVE_QUERY_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60_000;

/**
 * Only long-lived conversation reads are persisted: the session list and
 * per-session timelines. Everything else is cheap to refetch, device-run
 * specific (diagnostics), or operational state that must never be shown
 * stale without a fresh read (scheduled jobs).
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
      try {
        const raw = await storage.read();
        if (!raw) {
          return undefined;
        }
        return JSON.parse(raw) as PersistedClient;
      } catch {
        return undefined;
      }
    },
  };
}
