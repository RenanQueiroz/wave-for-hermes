import assert from 'node:assert/strict';
import test from 'node:test';

import { isOfflineLikeWaveError } from '../../src/services/query/offline-error.ts';
import {
  createWaveQueryPersister,
  shouldPersistWaveQuery,
  type WaveQueryCacheStorage,
} from '../../src/services/query/wave-query-persister.ts';
import { WaveBackendError } from '../../src/services/wave/wave-backend-client.ts';

function memoryStorage(initial?: string) {
  let value = initial;
  const storage: WaveQueryCacheStorage = {
    delete: () => {
      value = undefined;
    },
    read: () => value,
    write: (next) => {
      value = next;
    },
  };
  return { current: () => value, storage };
}

test('persists, restores, and removes the dehydrated cache', async () => {
  const { current, storage } = memoryStorage();
  const persister = createWaveQueryPersister(storage);
  const client = {
    buster: 'wave-query-cache-v1',
    clientState: { mutations: [], queries: [] },
    timestamp: 1_785_370_000,
  };

  await persister.persistClient(client);
  assert.ok(current());
  assert.deepEqual(await persister.restoreClient(), client);

  await persister.removeClient();
  assert.equal(current(), undefined);
  assert.equal(await persister.restoreClient(), undefined);
});

test('degrades corrupted or failing storage to an empty cache', async () => {
  // A truncated persist (interrupted write) must not leave a permanently
  // unreadable document behind: restore reports no cache AND deletes the
  // corrupt file so the next persist starts clean.
  const { current, storage } = memoryStorage('{"buster":"wave-query-cach');
  const corrupted = createWaveQueryPersister(storage);
  assert.equal(await corrupted.restoreClient(), undefined);
  assert.equal(current(), undefined);

  // A delete failure while cleaning up corruption still degrades quietly.
  const stuck = createWaveQueryPersister({
    delete: () => {
      throw new Error('locked');
    },
    read: () => 'not json',
    write: () => undefined,
  });
  assert.equal(await stuck.restoreClient(), undefined);

  const failing = createWaveQueryPersister({
    delete: () => {
      throw new Error('disk gone');
    },
    read: () => {
      throw new Error('disk gone');
    },
    write: () => {
      throw new Error('disk gone');
    },
  });
  await assert.doesNotReject(
    failing.persistClient({
      buster: '',
      clientState: { mutations: [], queries: [] },
      timestamp: 0,
    }),
  );
  await assert.doesNotReject(failing.removeClient());
  assert.equal(await failing.restoreClient(), undefined);
});

test('dehydrates only successful session list and timeline reads', () => {
  const success = { status: 'success' };
  assert.equal(
    shouldPersistWaveQuery(
      ['wave', 'device-1', 'https://wave.test', 'session-list'],
      success,
    ),
    true,
  );
  assert.equal(
    shouldPersistWaveQuery(
      [
        'wave',
        'device-1',
        'https://wave.test',
        'sessions',
        'session-1',
        'timeline',
      ],
      success,
    ),
    true,
  );

  assert.equal(
    shouldPersistWaveQuery(
      ['wave', 'device-1', 'https://wave.test', 'diagnostics'],
      success,
    ),
    false,
  );
  assert.equal(
    shouldPersistWaveQuery(
      ['wave', 'device-1', 'https://wave.test', 'operations', 'jobs'],
      success,
    ),
    false,
  );
  assert.equal(
    shouldPersistWaveQuery(
      ['wave', 'device-1', 'https://wave.test', 'session-list'],
      { status: 'error' },
    ),
    false,
  );
});

test('classifies only connectivity-shaped failures as offline-like', () => {
  assert.equal(
    isOfflineLikeWaveError(
      new WaveBackendError('Unavailable.', { kind: 'network' }),
    ),
    true,
  );
  assert.equal(
    isOfflineLikeWaveError(
      new WaveBackendError('Timed out.', { kind: 'timeout' }),
    ),
    true,
  );
  assert.equal(
    isOfflineLikeWaveError(
      new WaveBackendError('Hermes is down.', {
        kind: 'upstream_unavailable',
        statusCode: 503,
      }),
    ),
    true,
  );

  assert.equal(
    isOfflineLikeWaveError(
      new WaveBackendError('Missing.', {
        kind: 'not_found',
        statusCode: 404,
      }),
    ),
    false,
  );
  assert.equal(
    isOfflineLikeWaveError(
      new WaveBackendError('Unauthorized.', {
        kind: 'unauthorized',
        statusCode: 401,
      }),
    ),
    false,
  );
  assert.equal(isOfflineLikeWaveError(new Error('plain')), false);
});
