import { Directory, File, Paths } from 'expo-file-system';

import {
  createWaveQueryPersister,
  type WaveQueryCacheStorage,
} from './wave-query-persister';

const DIRECTORY_NAME = 'wave-query-cache';
const FILE_NAME = 'query-cache.json';

// The cache directory is inside the app sandbox (OS encryption at rest) and
// may be reclaimed by the platform — acceptable for a read cache whose source
// of truth is the companion.
function createExpoQueryCacheStorage(): WaveQueryCacheStorage {
  const directory = () => new Directory(Paths.cache, DIRECTORY_NAME);
  const file = () => new File(directory(), FILE_NAME);
  return {
    delete: () => {
      const target = file();
      if (target.exists) {
        target.delete();
      }
    },
    read: async () => {
      const target = file();
      return target.exists ? await target.text() : undefined;
    },
    write: (value) => {
      const parent = directory();
      if (!parent.exists) {
        parent.create({ idempotent: true, intermediates: true });
      }
      file().write(value);
    },
  };
}

/**
 * The app-wide persisted query cache. The provider hydrates and persists
 * through it; the connection lifecycle purges it whenever local Wave state is
 * cleared so a revoked or re-paired device leaves no readable conversations.
 */
export const waveQueryPersister = createWaveQueryPersister(
  createExpoQueryCacheStorage(),
);
