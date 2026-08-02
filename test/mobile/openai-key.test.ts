import assert from 'node:assert/strict';
import test from 'node:test';

import {
  OpenAiKeyStore,
  OpenAiKeyStoreError,
  OPENAI_KEY_PATTERN,
} from '../../src/services/realtime/openai-key-store.ts';
import { checkOpenAiKey } from '../../src/services/realtime/openai-key-validation.ts';

function memoryStorage() {
  const items = new Map<string, string>();
  return {
    items,
    deleteItemAsync: async (key: string) => {
      items.delete(key);
    },
    getItemAsync: async (key: string) => items.get(key) ?? null,
    setItemAsync: async (key: string, value: string) => {
      items.set(key, value);
    },
  };
}

test('stores, loads, and removes a key; never returns non-key garbage', async () => {
  const storage = memoryStorage();
  const store = new OpenAiKeyStore(storage);

  assert.equal(await store.load(), undefined);

  const key = `sk-proj-${'a'.repeat(40)}`;
  await store.save(key);
  assert.equal(await store.load(), key);

  // A corrupted stored value is treated as absent, not surfaced.
  storage.items.set('wave.openai-api-key.v1', 'not a key at all');
  assert.equal(await store.load(), undefined);

  await store.save(key);
  await store.clear();
  assert.equal(await store.load(), undefined);
});

test('rejects values that do not look like keys before storing', async () => {
  const store = new OpenAiKeyStore(memoryStorage());
  for (const bad of [
    '',
    'sk-',
    'sk-short',
    'pk-notopenai',
    'sk-has space x'.padEnd(30, 'x'),
  ]) {
    await assert.rejects(store.save(bad), OpenAiKeyStoreError);
  }
  assert.equal(OPENAI_KEY_PATTERN.test(`sk-${'x'.repeat(30)}`), true);
});

test('realtime preference defaults on and round-trips', async () => {
  const store = new OpenAiKeyStore(memoryStorage());
  assert.equal(await store.loadRealtimeEnabled(), true);
  await store.saveRealtimeEnabled(false);
  assert.equal(await store.loadRealtimeEnabled(), false);
  await store.saveRealtimeEnabled(true);
  assert.equal(await store.loadRealtimeEnabled(), true);
});

test('key validation maps statuses without leaking the key', async () => {
  const seen: string[] = [];
  const fetchFor = (status: number) =>
    (async (_url: unknown, init?: RequestInit) => {
      seen.push(
        String((init?.headers as Record<string, string>).Authorization),
      );
      return new Response(status === 200 ? '{"data":[]}' : '{}', { status });
    }) as unknown as typeof globalThis.fetch;

  assert.equal(await checkOpenAiKey('sk-test', fetchFor(200)), 'valid');
  assert.equal(await checkOpenAiKey('sk-test', fetchFor(401)), 'invalid');
  assert.equal(await checkOpenAiKey('sk-test', fetchFor(403)), 'invalid');
  assert.equal(await checkOpenAiKey('sk-test', fetchFor(500)), 'unreachable');

  const failing = (async () => {
    throw new Error('offline');
  }) as unknown as typeof globalThis.fetch;
  assert.equal(await checkOpenAiKey('sk-test', failing), 'unreachable');

  // The key only ever travels as the Authorization header to the fetch impl.
  assert.ok(seen.every((value) => value === 'Bearer sk-test'));
});
