import { Directory, File, Paths } from 'expo-file-system';

import {
  createWaveQueryPersister,
  type WaveQueryCacheStorage,
} from './wave-query-persister';

const DIRECTORY_NAME = 'wave-query-cache';
const FILE_NAME = 'query-cache.json';
const TEMP_FILE_NAME = `${FILE_NAME}.tmp`;

// The cache directory is inside the app sandbox (OS encryption at rest) and
// may be reclaimed by the platform — acceptable for a read cache whose source
// of truth is the gateway.
function createExpoQueryCacheStorage(): WaveQueryCacheStorage {
  const directory = () => new Directory(Paths.cache, DIRECTORY_NAME);
  const file = () => new File(directory(), FILE_NAME);
  return {
    delete: () => {
      const temp = new File(directory(), TEMP_FILE_NAME);
      if (temp.exists) {
        temp.delete();
      }
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
      // Write to a sibling temp file and rename it into place. Rewriting the
      // document in place left a truncated file when a reload or process
      // death interrupted the write, and one truncated write silently lost
      // the whole cache; a rename either fully replaces the file or not at
      // all.
      const temp = new File(parent, TEMP_FILE_NAME);
      temp.write(value);
      temp.moveSync(file(), { overwrite: true });
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
