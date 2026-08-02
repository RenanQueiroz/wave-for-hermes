/**
 * The user's own OpenAI API key for Realtime voice (stage 4 of the
 * direct-to-gateway migration).
 *
 * The key is device-only: platform secure storage, never backed up or
 * migrated (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`), never logged, and never sent
 * anywhere except `api.openai.com`. Store errors and validation results
 * carry no key material.
 */
import * as SecureStore from 'expo-secure-store';

const OPENAI_KEY_KEY = 'wave.openai-api-key.v1';
const REALTIME_ENABLED_KEY = 'wave.realtime-enabled.v1';
const SECURE_STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

/** Loose shape check before any network validation: `sk-…`, no whitespace. */
export const OPENAI_KEY_PATTERN = /^sk-[\S]{20,250}$/;

interface KeyStorage {
  deleteItemAsync(
    key: string,
    options?: SecureStore.SecureStoreOptions,
  ): Promise<void>;
  getItemAsync(
    key: string,
    options?: SecureStore.SecureStoreOptions,
  ): Promise<string | null>;
  setItemAsync(
    key: string,
    value: string,
    options?: SecureStore.SecureStoreOptions,
  ): Promise<void>;
}

export class OpenAiKeyStoreError extends Error {
  constructor(message = 'Wave could not access the saved OpenAI key.') {
    super(message);
    this.name = 'OpenAiKeyStoreError';
  }
}

export class OpenAiKeyStore {
  private readonly storage: KeyStorage;

  constructor(storage: KeyStorage = SecureStore) {
    this.storage = storage;
  }

  /** Remove the key from this device. */
  async clear() {
    try {
      await this.storage.deleteItemAsync(OPENAI_KEY_KEY, SECURE_STORE_OPTIONS);
    } catch {
      throw new OpenAiKeyStoreError(
        'Wave could not remove the OpenAI key from this device.',
      );
    }
  }

  /** The stored key, or undefined when none is saved. */
  async load(): Promise<string | undefined> {
    let stored: string | null;
    try {
      stored = await this.storage.getItemAsync(
        OPENAI_KEY_KEY,
        SECURE_STORE_OPTIONS,
      );
    } catch {
      throw new OpenAiKeyStoreError();
    }
    if (!stored) return undefined;
    // A stored value that no longer looks like a key is treated as absent
    // rather than surfaced anywhere.
    return OPENAI_KEY_PATTERN.test(stored) ? stored : undefined;
  }

  async save(key: string) {
    if (!OPENAI_KEY_PATTERN.test(key)) {
      throw new OpenAiKeyStoreError('That does not look like an OpenAI key.');
    }
    try {
      await this.storage.setItemAsync(
        OPENAI_KEY_KEY,
        key,
        SECURE_STORE_OPTIONS,
      );
    } catch {
      throw new OpenAiKeyStoreError(
        'Wave could not save the OpenAI key to this device.',
      );
    }
  }

  /** Whether the user prefers Realtime when a key is present. Default: on. */
  async loadRealtimeEnabled(): Promise<boolean> {
    try {
      const stored = await this.storage.getItemAsync(
        REALTIME_ENABLED_KEY,
        SECURE_STORE_OPTIONS,
      );
      return stored !== 'false';
    } catch {
      throw new OpenAiKeyStoreError(
        'Wave could not read the live-voice preference.',
      );
    }
  }

  async saveRealtimeEnabled(enabled: boolean) {
    try {
      await this.storage.setItemAsync(
        REALTIME_ENABLED_KEY,
        enabled ? 'true' : 'false',
        SECURE_STORE_OPTIONS,
      );
    } catch {
      throw new OpenAiKeyStoreError(
        'Wave could not save the live-voice preference.',
      );
    }
  }
}

export const openAiKeyStore = new OpenAiKeyStore();
