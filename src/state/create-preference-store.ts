/**
 * Device-local preference stores.
 *
 * One shape for every persisted preference: a vanilla Zustand store (so node
 * tests run without React), hydrated once from platform secure storage, with
 * strict versioned records that degrade to the app-owned default on anything
 * missing, unreadable, or corrupt. Writes are optimistic — the in-memory
 * value moves immediately and stands until the next launch even if the
 * persistence write fails (callers that care can await `set`).
 *
 * Per AGENTS.md these stores carry device-local UI/preference state only:
 * never server data, never secrets. Secret values stay in their own secure
 * stores with only presence projected here.
 */
import * as SecureStore from 'expo-secure-store';
import { createStore, type StoreApi } from 'zustand/vanilla';

const SECURE_STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export interface PreferenceStorage {
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

export interface PreferenceCodec<T> {
  /** Strict parse of a stored record. Throw on anything invalid. */
  decode(stored: string): T;
  encode(value: T): string;
}

export interface PreferenceState<T> {
  /** False until the stored record has been read once. */
  hydrated: boolean;
  value: T;
}

export interface DevicePreferenceStore<T> {
  api: StoreApi<PreferenceState<T>>;
  /** Read the stored record once; later calls await the same hydration. */
  hydrate(): Promise<void>;
  /** The hydrated value, hydrating first when needed. */
  read(): Promise<T>;
  /**
   * Apply now and persist behind; rejects when the write failed while the
   * in-memory value stays applied.
   */
  set(value: T): Promise<void>;
}

export function createPreferenceStore<T>(options: {
  codec: PreferenceCodec<T>;
  defaultValue: T;
  key: string;
  storage?: PreferenceStorage;
  storeErrorMessage: string;
}): DevicePreferenceStore<T> {
  const storage: PreferenceStorage = options.storage ?? SecureStore;
  const api = createStore<PreferenceState<T>>(() => ({
    hydrated: false,
    value: options.defaultValue,
  }));
  let hydration: Promise<void> | undefined;

  const hydrate = () => {
    hydration ??= (async () => {
      let value = options.defaultValue;
      try {
        const stored = await storage.getItemAsync(
          options.key,
          SECURE_STORE_OPTIONS,
        );
        if (stored) value = options.codec.decode(stored);
      } catch {
        // Missing, unreadable, or corrupt records degrade to the default.
      }
      // A `set` that raced ahead of hydration wins over the stored record.
      api.setState((current) =>
        current.hydrated
          ? { ...current, hydrated: true }
          : { hydrated: true, value },
      );
    })();
    return hydration;
  };

  return {
    api,
    hydrate,
    read: async () => {
      await hydrate();
      return api.getState().value;
    },
    set: async (value: T) => {
      // Mark hydrated so a slower stored record cannot overwrite this choice.
      api.setState({ hydrated: true, value });
      try {
        await storage.setItemAsync(
          options.key,
          options.codec.encode(value),
          SECURE_STORE_OPTIONS,
        );
      } catch {
        throw new Error(options.storeErrorMessage);
      }
    },
  };
}
