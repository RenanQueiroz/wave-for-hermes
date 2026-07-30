import * as SecureStore from 'expo-secure-store';

import {
  parseWaveConnectionRecord,
  serializeWaveConnectionRecord,
  type WaveConnectionRecord,
  type WaveCredentialStore,
  WaveCredentialStoreError,
} from './connection-record';

const CONNECTION_KEY = 'wave.connection.v1';
const SECURE_STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export class SecureWaveCredentialStore implements WaveCredentialStore {
  private readonly allowInsecureHttp: boolean;

  constructor(options: { allowInsecureHttp?: boolean } = {}) {
    this.allowInsecureHttp = options.allowInsecureHttp ?? false;
  }

  async clear() {
    await this.requireAvailability();
    try {
      await SecureStore.deleteItemAsync(
        CONNECTION_KEY,
        SECURE_STORE_OPTIONS,
      );
    } catch {
      throw new WaveCredentialStoreError(
        'Wave could not clear the saved connection.',
      );
    }
  }

  async load() {
    await this.requireAvailability();
    let serialized: string | null;
    try {
      serialized = await SecureStore.getItemAsync(
        CONNECTION_KEY,
        SECURE_STORE_OPTIONS,
      );
    } catch {
      throw new WaveCredentialStoreError(
        'Wave could not read the saved connection.',
      );
    }
    return serialized
      ? parseWaveConnectionRecord(serialized, {
          allowInsecureHttp: this.allowInsecureHttp,
        })
      : undefined;
  }

  async save(record: WaveConnectionRecord) {
    await this.requireAvailability();
    try {
      await SecureStore.setItemAsync(
        CONNECTION_KEY,
        serializeWaveConnectionRecord(record, {
          allowInsecureHttp: this.allowInsecureHttp,
        }),
        SECURE_STORE_OPTIONS,
      );
    } catch {
      throw new WaveCredentialStoreError(
        'Wave could not securely save this connection.',
      );
    }
  }

  private async requireAvailability() {
    if (!(await SecureStore.isAvailableAsync())) {
      throw new WaveCredentialStoreError(
        'Secure credential storage is unavailable on this device.',
      );
    }
  }
}
