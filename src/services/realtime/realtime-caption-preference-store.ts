import * as SecureStore from 'expo-secure-store';

import {
  parseRealtimeCaptionPreference,
  serializeRealtimeCaptionPreference,
  WAVE_REALTIME_DEFAULT_CAPTIONS,
} from './realtime-caption-preference-record.ts';

const REALTIME_CAPTION_PREFERENCE_KEY = 'wave.realtime-caption-preference.v1';
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

export class RealtimeCaptionPreferenceStoreError extends Error {
  constructor(
    message = 'Wave could not save the Realtime caption preference.',
  ) {
    super(message);
    this.name = 'RealtimeCaptionPreferenceStoreError';
  }
}

export class RealtimeCaptionPreferenceStore {
  private readonly storage: PreferenceStorage;

  constructor(storage: PreferenceStorage = SecureStore) {
    this.storage = storage;
  }

  /** Missing, unreadable, or corrupt values resolve to captions off. */
  async load(): Promise<boolean> {
    try {
      const stored = await this.storage.getItemAsync(
        REALTIME_CAPTION_PREFERENCE_KEY,
        SECURE_STORE_OPTIONS,
      );
      return stored
        ? parseRealtimeCaptionPreference(stored)
        : WAVE_REALTIME_DEFAULT_CAPTIONS;
    } catch {
      return WAVE_REALTIME_DEFAULT_CAPTIONS;
    }
  }

  async save(captions: boolean) {
    const serialized = serializeRealtimeCaptionPreference(captions);
    try {
      await this.storage.setItemAsync(
        REALTIME_CAPTION_PREFERENCE_KEY,
        serialized,
        SECURE_STORE_OPTIONS,
      );
    } catch {
      throw new RealtimeCaptionPreferenceStoreError();
    }
  }
}
