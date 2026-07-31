import * as SecureStore from 'expo-secure-store';

import {
  parseRealtimeVoicePreference,
  serializeRealtimeVoicePreference,
  type RealtimeVoicePreference,
} from './realtime-voice-preference-record';

const REALTIME_VOICE_PREFERENCE_KEY = 'wave.realtime-voice-preference.v1';
const SECURE_STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

interface PreferenceStorage {
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

export class RealtimeVoicePreferenceStoreError extends Error {
  constructor(message = 'Wave could not access the saved voice preference.') {
    super(message);
    this.name = 'RealtimeVoicePreferenceStoreError';
  }
}

export class RealtimeVoicePreferenceStore {
  private readonly storage: PreferenceStorage;

  constructor(storage: PreferenceStorage = SecureStore) {
    this.storage = storage;
  }

  async clear() {
    try {
      await this.storage.deleteItemAsync(
        REALTIME_VOICE_PREFERENCE_KEY,
        SECURE_STORE_OPTIONS,
      );
    } catch {
      throw new RealtimeVoicePreferenceStoreError(
        'Wave could not clear the saved voice preference.',
      );
    }
  }

  async load(): Promise<RealtimeVoicePreference> {
    let stored: string | null;
    try {
      stored = await this.storage.getItemAsync(
        REALTIME_VOICE_PREFERENCE_KEY,
        SECURE_STORE_OPTIONS,
      );
    } catch {
      throw new RealtimeVoicePreferenceStoreError();
    }
    if (!stored) return 'default';
    try {
      return parseRealtimeVoicePreference(stored);
    } catch {
      throw new RealtimeVoicePreferenceStoreError();
    }
  }

  async save(preference: RealtimeVoicePreference) {
    const serialized = serializeRealtimeVoicePreference(preference);
    try {
      await this.storage.setItemAsync(
        REALTIME_VOICE_PREFERENCE_KEY,
        serialized,
        SECURE_STORE_OPTIONS,
      );
    } catch {
      throw new RealtimeVoicePreferenceStoreError(
        'Wave could not save the voice preference.',
      );
    }
  }
}
