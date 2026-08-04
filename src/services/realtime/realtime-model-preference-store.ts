import * as SecureStore from 'expo-secure-store';

import {
  parseRealtimeModelPreference,
  serializeRealtimeModelPreference,
  WAVE_REALTIME_DEFAULT_MODEL,
  type WaveRealtimeModelId,
} from './realtime-model-preference-record.ts';

const REALTIME_MODEL_PREFERENCE_KEY = 'wave.realtime-model-preference.v1';
const SECURE_STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

interface PreferenceStorage {
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

export class RealtimeModelPreferenceStoreError extends Error {
  constructor(message = 'Wave could not save the Realtime model preference.') {
    super(message);
    this.name = 'RealtimeModelPreferenceStoreError';
  }
}

export class RealtimeModelPreferenceStore {
  private readonly storage: PreferenceStorage;

  constructor(storage: PreferenceStorage = SecureStore) {
    this.storage = storage;
  }

  /**
   * Missing, unreadable, corrupt, or retired values resolve to the app-owned
   * default. The preference is independent from the OpenAI key and voice.
   */
  async load(): Promise<WaveRealtimeModelId> {
    try {
      const stored = await this.storage.getItemAsync(
        REALTIME_MODEL_PREFERENCE_KEY,
        SECURE_STORE_OPTIONS,
      );
      return stored
        ? parseRealtimeModelPreference(stored)
        : WAVE_REALTIME_DEFAULT_MODEL;
    } catch {
      return WAVE_REALTIME_DEFAULT_MODEL;
    }
  }

  async save(model: WaveRealtimeModelId) {
    const serialized = serializeRealtimeModelPreference(model);
    try {
      await this.storage.setItemAsync(
        REALTIME_MODEL_PREFERENCE_KEY,
        serialized,
        SECURE_STORE_OPTIONS,
      );
    } catch {
      throw new RealtimeModelPreferenceStoreError();
    }
  }
}
