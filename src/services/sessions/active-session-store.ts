import * as SecureStore from 'expo-secure-store';

import { WaveIdentifierSchema } from '@wave/contracts';

const ACTIVE_SESSION_KEY = 'wave.active-session.v1';

interface ActiveSessionRecord {
  connectionId: string;
  sessionId: string;
  version: 1;
}

export class ActiveSessionStoreError extends Error {
  constructor(message = 'Wave could not access the saved conversation.') {
    super(message);
    this.name = 'ActiveSessionStoreError';
  }
}

export class ActiveSessionStore {
  async clear() {
    try {
      await SecureStore.deleteItemAsync(ACTIVE_SESSION_KEY);
    } catch {
      throw new ActiveSessionStoreError();
    }
  }

  async load(connectionId: string) {
    try {
      const stored = await SecureStore.getItemAsync(ACTIVE_SESSION_KEY);
      if (!stored) return undefined;
      const parsed = parseRecord(JSON.parse(stored) as unknown);
      return parsed.connectionId === connectionId
        ? parsed.sessionId
        : undefined;
    } catch (error) {
      if (error instanceof ActiveSessionStoreError) throw error;
      throw new ActiveSessionStoreError();
    }
  }

  async save(connectionId: string, sessionId: string) {
    const record = parseRecord({
      connectionId,
      sessionId,
      version: 1,
    });
    try {
      await SecureStore.setItemAsync(
        ACTIVE_SESSION_KEY,
        JSON.stringify(record),
        {
          keychainAccessible:
            SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        },
      );
    } catch {
      throw new ActiveSessionStoreError();
    }
  }
}

function parseRecord(value: unknown): ActiveSessionRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ActiveSessionStoreError();
  }
  const record = value as Record<string, unknown>;
  const connectionId = WaveIdentifierSchema.safeParse(record.connectionId);
  const sessionId = WaveIdentifierSchema.safeParse(record.sessionId);
  if (
    record.version !== 1 ||
    !connectionId.success ||
    !sessionId.success ||
    Object.keys(record).some(
      (key) =>
        key !== 'connectionId' &&
        key !== 'sessionId' &&
        key !== 'version',
    )
  ) {
    throw new ActiveSessionStoreError();
  }
  return {
    connectionId: connectionId.data,
    sessionId: sessionId.data,
    version: 1,
  };
}
