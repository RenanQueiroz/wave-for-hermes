import * as SecureStore from 'expo-secure-store';

import {
  parseGatewayConnectionRecord,
  serializeGatewayConnectionRecord,
  type GatewayConnectionRecord,
  type GatewayConnectionStore,
  GatewayStoreError,
} from './gateway-connection-record.ts';

const GATEWAY_KEY = 'wave.gateway.v1';
// Device-only: the session must not migrate to another device through a
// backup or transfer, the same rule the pairing credential follows.
const SECURE_STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export class SecureGatewayConnectionStore implements GatewayConnectionStore {
  private readonly allowInsecureHttp: boolean;

  constructor(options: { allowInsecureHttp?: boolean } = {}) {
    this.allowInsecureHttp = options.allowInsecureHttp ?? false;
  }

  async clear(): Promise<void> {
    try {
      await SecureStore.deleteItemAsync(GATEWAY_KEY, SECURE_STORE_OPTIONS);
    } catch {
      throw new GatewayStoreError('Wave could not clear the Hermes session.');
    }
  }

  async load(): Promise<GatewayConnectionRecord | undefined> {
    let serialized: string | null;
    try {
      serialized = await SecureStore.getItemAsync(
        GATEWAY_KEY,
        SECURE_STORE_OPTIONS,
      );
    } catch {
      throw new GatewayStoreError('Wave could not read the Hermes session.');
    }
    if (!serialized) return undefined;
    return parseGatewayConnectionRecord(serialized, {
      allowInsecureHttp: this.allowInsecureHttp,
    });
  }

  async save(record: GatewayConnectionRecord): Promise<void> {
    try {
      await SecureStore.setItemAsync(
        GATEWAY_KEY,
        serializeGatewayConnectionRecord(record),
        SECURE_STORE_OPTIONS,
      );
    } catch {
      throw new GatewayStoreError('Wave could not save the Hermes session.');
    }
  }
}
