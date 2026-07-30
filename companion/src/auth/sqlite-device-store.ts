import { chmodSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync, type StatementResultingChanges } from 'node:sqlite';

import {
  WaveDeviceCredentialSchema,
  WaveDeviceNameSchema,
  WaveIdentifierSchema,
} from '@wave/contracts';

import {
  createDeviceCredential,
  createPairingCode,
  hashCredential,
  normalizePairingCode,
} from './credentials.ts';
import type {
  AuthenticatedDevice,
  DeviceRecord,
  DeviceStore,
  IssuedPairingCode,
  RedeemedDevice,
} from './device-store.ts';

const DATABASE_SCHEMA_VERSION = 1;

interface SqliteDeviceStoreOptions {
  now?: () => Date;
}

interface DeviceRow {
  created_at: string;
  id: string;
  last_used_at: string | null;
  name: string;
  revoked_at: string | null;
}

interface PairingCodeRow {
  expires_at: string;
  id: string;
}

export class SqliteDeviceStore implements DeviceStore {
  private readonly database: DatabaseSync;
  private readonly now: () => Date;

  constructor(path: string, options: SqliteDeviceStoreOptions = {}) {
    this.now = options.now ?? (() => new Date());
    const databasePath = prepareDatabasePath(path);
    this.database = new DatabaseSync(databasePath);
    if (databasePath !== ':memory:') {
      chmodSync(databasePath, 0o600);
    }

    this.database.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
    `);
    this.initializeSchema();
  }

  authenticateDevice(credential: string) {
    const parsed = WaveDeviceCredentialSchema.safeParse(credential);
    if (!parsed.success) {
      return undefined;
    }

    const now = this.now().toISOString();
    const row = this.database
      .prepare(
        `SELECT id, name, created_at, last_used_at, revoked_at
         FROM devices
         WHERE credential_hash = ? AND revoked_at IS NULL`,
      )
      .get(hashCredential(parsed.data)) as DeviceRow | undefined;
    if (!row) {
      return undefined;
    }

    this.database
      .prepare('UPDATE devices SET last_used_at = ? WHERE id = ?')
      .run(now, row.id);
    return toAuthenticatedDevice(row);
  }

  bindSession(deviceId: string, sessionId: string) {
    WaveIdentifierSchema.parse(deviceId);
    WaveIdentifierSchema.parse(sessionId);
    this.database
      .prepare(
        `INSERT OR IGNORE INTO device_sessions (device_id, session_id, created_at)
         VALUES (?, ?, ?)`,
      )
      .run(deviceId, sessionId, this.now().toISOString());
  }

  close() {
    if (this.database.isOpen) {
      this.database.close();
    }
  }

  hasSession(deviceId: string, sessionId: string) {
    const row = this.database
      .prepare(
        `SELECT 1 AS found
         FROM device_sessions
         WHERE device_id = ? AND session_id = ?`,
      )
      .get(deviceId, sessionId) as { found: number } | undefined;
    return row?.found === 1;
  }

  isDeviceActive(deviceId: string) {
    const parsed = WaveIdentifierSchema.safeParse(deviceId);
    if (!parsed.success) {
      return false;
    }
    const row = this.database
      .prepare(
        `SELECT 1 AS found
         FROM devices
         WHERE id = ? AND revoked_at IS NULL`,
      )
      .get(parsed.data) as { found: number } | undefined;
    return row?.found === 1;
  }

  issuePairingCode(expiresAt: Date): IssuedPairingCode {
    const now = this.now();
    if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= now) {
      throw new Error('Pairing-code expiry must be in the future.');
    }

    this.removeExpiredPairingCodes(now.toISOString());
    const code = createPairingCode();
    this.database
      .prepare(
        `INSERT INTO pairing_codes (
          id, code_hash, created_at, expires_at, consumed_at
        ) VALUES (?, ?, ?, ?, NULL)`,
      )
      .run(
        randomUUID(),
        hashCredential(normalizePairingCode(code)),
        now.toISOString(),
        expiresAt.toISOString(),
      );
    return {
      code,
      expiresAt: expiresAt.toISOString(),
    };
  }

  listDevices(): DeviceRecord[] {
    const rows = this.database
      .prepare(
        `SELECT id, name, created_at, last_used_at, revoked_at
         FROM devices
         ORDER BY created_at ASC`,
      )
      .all() as unknown as DeviceRow[];
    return rows.map((row) => ({
      ...toAuthenticatedDevice(row),
      ...(row.last_used_at ? { lastUsedAt: row.last_used_at } : {}),
      ...(row.revoked_at ? { revokedAt: row.revoked_at } : {}),
    }));
  }

  listSessionIds(deviceId: string) {
    const rows = this.database
      .prepare(
        `SELECT session_id
         FROM device_sessions
         WHERE device_id = ?
         ORDER BY created_at ASC`,
      )
      .all(deviceId) as unknown as { session_id: string }[];
    return rows.map((row) => row.session_id);
  }

  redeemPairingCode(
    code: string,
    deviceName: string,
  ): RedeemedDevice | undefined {
    const parsedName = WaveDeviceNameSchema.safeParse(deviceName);
    if (!parsedName.success) {
      return undefined;
    }

    const normalizedCode = normalizePairingCode(code);
    const now = this.now().toISOString();
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const row = this.database
        .prepare(
          `SELECT id, expires_at
           FROM pairing_codes
           WHERE code_hash = ? AND consumed_at IS NULL`,
        )
        .get(hashCredential(normalizedCode)) as PairingCodeRow | undefined;
      if (!row || row.expires_at <= now) {
        this.database.exec('ROLLBACK');
        return undefined;
      }

      const consumed = this.database
        .prepare(
          `UPDATE pairing_codes
           SET consumed_at = ?
           WHERE id = ? AND consumed_at IS NULL AND expires_at > ?`,
        )
        .run(now, row.id, now);
      if (!hasOneChange(consumed)) {
        this.database.exec('ROLLBACK');
        return undefined;
      }

      const credential = createDeviceCredential();
      const device: AuthenticatedDevice = {
        createdAt: now,
        id: randomUUID(),
        name: parsedName.data,
      };
      this.database
        .prepare(
          `INSERT INTO devices (
            id, name, credential_hash, created_at, last_used_at, revoked_at
          ) VALUES (?, ?, ?, ?, NULL, NULL)`,
        )
        .run(
          device.id,
          device.name,
          hashCredential(credential),
          device.createdAt,
        );
      this.database.exec('COMMIT');
      return { credential, device };
    } catch (error) {
      if (this.database.isTransaction) {
        this.database.exec('ROLLBACK');
      }
      throw error;
    }
  }

  revokeDevice(deviceId: string) {
    WaveIdentifierSchema.parse(deviceId);
    const result = this.database
      .prepare(
        `UPDATE devices
         SET revoked_at = ?
         WHERE id = ? AND revoked_at IS NULL`,
      )
      .run(this.now().toISOString(), deviceId);
    return hasOneChange(result);
  }

  private initializeSchema() {
    const row = this.database.prepare('PRAGMA user_version').get() as
      | { user_version: number }
      | undefined;
    const version = row?.user_version ?? 0;
    if (version === DATABASE_SCHEMA_VERSION) {
      return;
    }
    if (version !== 0) {
      throw new Error(
        `Unsupported Wave Companion database schema version ${version}. Expected ${DATABASE_SCHEMA_VERSION}.`,
      );
    }

    this.database.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE devices (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        credential_hash BLOB UNIQUE NOT NULL,
        created_at TEXT NOT NULL,
        last_used_at TEXT,
        revoked_at TEXT
      ) STRICT;
      CREATE TABLE pairing_codes (
        id TEXT PRIMARY KEY NOT NULL,
        code_hash BLOB UNIQUE NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        consumed_at TEXT
      ) STRICT;
      CREATE TABLE device_sessions (
        device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
        session_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (device_id, session_id)
      ) STRICT;
      CREATE INDEX pairing_codes_expiry_index
        ON pairing_codes (expires_at);
      PRAGMA user_version = ${DATABASE_SCHEMA_VERSION};
      COMMIT;
    `);
  }

  private removeExpiredPairingCodes(now: string) {
    this.database
      .prepare(
        `DELETE FROM pairing_codes
         WHERE expires_at <= ? OR consumed_at IS NOT NULL`,
      )
      .run(now);
  }
}

function hasOneChange(result: StatementResultingChanges) {
  return result.changes === 1;
}

function prepareDatabasePath(path: string) {
  if (path === ':memory:') {
    return path;
  }
  const resolved = resolve(path);
  mkdirSync(dirname(resolved), { mode: 0o700, recursive: true });
  return resolved;
}

function toAuthenticatedDevice(row: DeviceRow): AuthenticatedDevice {
  return {
    createdAt: row.created_at,
    id: row.id,
    name: row.name,
  };
}
