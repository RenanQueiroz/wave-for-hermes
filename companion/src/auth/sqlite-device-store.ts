import { chmodSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync, type StatementResultingChanges } from 'node:sqlite';

import {
  WaveAskHermesToolResultSchema,
  WaveDeviceCredentialSchema,
  WaveDeviceNameSchema,
  WaveIdentifierSchema,
  WaveIsoDateTimeSchema,
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
import type {
  InteractionEntryRecord,
  InteractionStore,
  InteractionTurnRecord,
} from '../interactions/interaction-store.ts';

const DATABASE_SCHEMA_VERSION = 4;
const INTERACTION_SCHEMA_SQL = `
  CREATE TABLE realtime_turns (
    id TEXT PRIMARY KEY NOT NULL,
    session_id TEXT NOT NULL,
    event_key TEXT UNIQUE NOT NULL,
    user_transcript TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;
  CREATE INDEX realtime_turns_session_order_index
    ON realtime_turns (session_id, created_at, id);
  CREATE TABLE realtime_entries (
    id TEXT PRIMARY KEY NOT NULL,
    turn_id TEXT NOT NULL,
    event_key TEXT UNIQUE NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('wave_message', 'handoff')),
    content TEXT,
    instruction TEXT,
    status TEXT CHECK (status IN ('pending', 'completed', 'failed')),
    result_json TEXT,
    hermes_assistant_message_id TEXT,
    hermes_assistant_message_timestamp REAL,
    created_at TEXT NOT NULL,
    completed_at TEXT,
    FOREIGN KEY (turn_id) REFERENCES realtime_turns (id) ON DELETE CASCADE,
    CHECK (
      (kind = 'wave_message' AND content IS NOT NULL AND instruction IS NULL AND status IS NULL)
      OR
      (kind = 'handoff' AND content IS NULL AND instruction IS NOT NULL AND status IS NOT NULL)
    )
  ) STRICT;
  CREATE INDEX realtime_entries_turn_order_index
    ON realtime_entries (turn_id, created_at, id);
`;

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

interface RealtimeEntryRow {
  completed_at: string | null;
  content: string | null;
  created_at: string;
  hermes_assistant_message_id: string | null;
  hermes_assistant_message_timestamp: number | null;
  id: string;
  instruction: string | null;
  kind: 'handoff' | 'wave_message';
  result_json: string | null;
  status: 'completed' | 'failed' | 'pending' | null;
  turn_id: string;
}

interface RealtimeTurnRow {
  created_at: string;
  id: string;
  session_id: string;
  user_transcript: string | null;
}

export class SqliteDeviceStore implements DeviceStore, InteractionStore {
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

  close() {
    if (this.database.isOpen) {
      this.database.close();
    }
  }

  beginHandoff(input: {
    createdAt: string;
    eventKey: string;
    instruction: string;
    sessionId: string;
    turnId: string;
  }) {
    const createdAt = WaveIsoDateTimeSchema.parse(input.createdAt);
    const sessionId = WaveIdentifierSchema.parse(input.sessionId);
    const turnId = WaveIdentifierSchema.parse(input.turnId);
    const instruction = input.instruction.trim();
    if (!instruction || instruction.length > 32_000) {
      throw new Error('Interaction handoff instruction is invalid.');
    }
    this.requireTurnSession(turnId, sessionId);
    const id = randomUUID();
    this.database
      .prepare(
        `INSERT INTO realtime_entries (
          id, turn_id, event_key, kind, content, instruction, status,
          result_json, hermes_assistant_message_id, created_at, completed_at
        ) VALUES (?, ?, ?, 'handoff', NULL, ?, 'pending', NULL, NULL, ?, NULL)
        ON CONFLICT (event_key) DO NOTHING`,
      )
      .run(id, turnId, parseEventKey(input.eventKey), instruction, createdAt);
    return this.findEntryId(input.eventKey, 'handoff');
  }

  beginRealtimeTurn(input: {
    createdAt: string;
    eventKey: string;
    sessionId: string;
  }) {
    const createdAt = WaveIsoDateTimeSchema.parse(input.createdAt);
    const sessionId = WaveIdentifierSchema.parse(input.sessionId);
    const eventKey = parseEventKey(input.eventKey);
    const id = randomUUID();
    this.database
      .prepare(
        `INSERT INTO realtime_turns (
          id, session_id, event_key, user_transcript, created_at, updated_at
        ) VALUES (?, ?, ?, NULL, ?, ?)
        ON CONFLICT (event_key) DO NOTHING`,
      )
      .run(id, sessionId, eventKey, createdAt, createdAt);
    const row = this.database
      .prepare(
        `SELECT id, session_id
         FROM realtime_turns
         WHERE event_key = ?`,
      )
      .get(eventKey) as { id: string; session_id: string } | undefined;
    if (!row || row.session_id !== sessionId) {
      throw new Error('Interaction turn could not be created.');
    }
    return row.id;
  }

  completeHandoff(input: {
    completedAt: string;
    handoffId: string;
    hermesAssistantMessageId?: string;
    hermesAssistantMessageTimestamp?: number;
    result: import('@wave/contracts').WaveAskHermesToolResult;
  }) {
    const completedAt = WaveIsoDateTimeSchema.parse(input.completedAt);
    const handoffId = WaveIdentifierSchema.parse(input.handoffId);
    const result = WaveAskHermesToolResultSchema.parse(input.result);
    const resultJson = JSON.stringify(result);
    const status = result.ok ? 'completed' : 'failed';
    const existing = this.database
      .prepare(
        `SELECT status, result_json
         FROM realtime_entries
         WHERE id = ? AND kind = 'handoff'`,
      )
      .get(handoffId) as
      { result_json: string | null; status: string | null } | undefined;
    if (!existing) {
      throw new Error('Interaction handoff was not found.');
    }
    if (existing.status !== 'pending') {
      if (existing.status !== status || existing.result_json !== resultJson) {
        throw new Error('Interaction handoff has already been settled.');
      }
      return;
    }
    this.database
      .prepare(
        `UPDATE realtime_entries
         SET status = ?, result_json = ?, hermes_assistant_message_id = ?,
             hermes_assistant_message_timestamp = ?, completed_at = ?
         WHERE id = ? AND kind = 'handoff' AND status = 'pending'`,
      )
      .run(
        status,
        resultJson,
        input.hermesAssistantMessageId ?? null,
        input.hermesAssistantMessageTimestamp === undefined
          ? null
          : parseHermesTimestamp(input.hermesAssistantMessageTimestamp),
        completedAt,
        handoffId,
      );
  }

  deleteSession(sessionId: string) {
    this.database
      .prepare('DELETE FROM realtime_turns WHERE session_id = ?')
      .run(WaveIdentifierSchema.parse(sessionId));
  }

  listSessionTurns(sessionId: string): InteractionTurnRecord[] {
    const validSessionId = WaveIdentifierSchema.parse(sessionId);
    const turnRows = this.database
      .prepare(
        `SELECT id, session_id, user_transcript, created_at
         FROM realtime_turns
         WHERE session_id = ?
         ORDER BY created_at ASC, rowid ASC`,
      )
      .all(validSessionId) as unknown as RealtimeTurnRow[];
    if (turnRows.length === 0) {
      return [];
    }
    const entryRows = this.database
      .prepare(
        `SELECT e.id, e.turn_id, e.kind, e.content, e.instruction, e.status,
                e.result_json, e.hermes_assistant_message_id,
                e.hermes_assistant_message_timestamp, e.created_at,
                e.completed_at
         FROM realtime_entries e
         INNER JOIN realtime_turns t ON t.id = e.turn_id
         WHERE t.session_id = ?
         ORDER BY e.created_at ASC, e.rowid ASC`,
      )
      .all(validSessionId) as unknown as RealtimeEntryRow[];
    const entriesByTurn = new Map<string, InteractionEntryRecord[]>();
    for (const row of entryRows) {
      const entries = entriesByTurn.get(row.turn_id) ?? [];
      entries.push(toInteractionEntry(row));
      entriesByTurn.set(row.turn_id, entries);
    }
    return turnRows.map((row) => ({
      createdAt: row.created_at,
      entries: entriesByTurn.get(row.id) ?? [],
      id: row.id,
      sessionId: row.session_id,
      ...(row.user_transcript ? { userTranscript: row.user_transcript } : {}),
    }));
  }

  recordUserTranscript(input: {
    transcript: string;
    turnId: string;
    updatedAt: string;
  }) {
    const transcript = input.transcript.trim();
    if (!transcript || transcript.length > 128_000) {
      throw new Error('Interaction transcript is invalid.');
    }
    const result = this.database
      .prepare(
        `UPDATE realtime_turns
         SET user_transcript = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        transcript,
        WaveIsoDateTimeSchema.parse(input.updatedAt),
        WaveIdentifierSchema.parse(input.turnId),
      );
    if (!hasOneChange(result)) {
      throw new Error('Interaction turn was not found.');
    }
  }

  recordWaveMessage(input: {
    content: string;
    createdAt: string;
    eventKey: string;
    sessionId: string;
    turnId: string;
  }) {
    const content = input.content.trim();
    if (!content || content.length > 128_000) {
      throw new Error('Interaction message is invalid.');
    }
    const createdAt = WaveIsoDateTimeSchema.parse(input.createdAt);
    const sessionId = WaveIdentifierSchema.parse(input.sessionId);
    const turnId = WaveIdentifierSchema.parse(input.turnId);
    this.requireTurnSession(turnId, sessionId);
    const id = randomUUID();
    this.database
      .prepare(
        `INSERT INTO realtime_entries (
          id, turn_id, event_key, kind, content, instruction, status,
          result_json, hermes_assistant_message_id, created_at, completed_at
        ) VALUES (?, ?, ?, 'wave_message', ?, NULL, NULL, NULL, NULL, ?, NULL)
        ON CONFLICT (event_key) DO NOTHING`,
      )
      .run(id, turnId, parseEventKey(input.eventKey), content, createdAt);
    return this.findEntryId(input.eventKey, 'wave_message');
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
      { user_version: number } | undefined;
    const version = row?.user_version ?? 0;
    if (version === DATABASE_SCHEMA_VERSION) {
      return;
    }
    if (version === 3) {
      this.database.exec(`
        BEGIN IMMEDIATE;
        ALTER TABLE realtime_entries
          ADD COLUMN hermes_assistant_message_timestamp REAL;
        PRAGMA user_version = ${DATABASE_SCHEMA_VERSION};
        COMMIT;
      `);
      return;
    }
    if (version === 2) {
      this.database.exec(`
        BEGIN IMMEDIATE;
        ${INTERACTION_SCHEMA_SQL}
        PRAGMA user_version = ${DATABASE_SCHEMA_VERSION};
        COMMIT;
      `);
      return;
    }
    if (version === 1) {
      this.database.exec(`
        BEGIN IMMEDIATE;
        DROP TABLE device_sessions;
        ${INTERACTION_SCHEMA_SQL}
        PRAGMA user_version = ${DATABASE_SCHEMA_VERSION};
        COMMIT;
      `);
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
      CREATE INDEX pairing_codes_expiry_index
        ON pairing_codes (expires_at);
      ${INTERACTION_SCHEMA_SQL}
      PRAGMA user_version = ${DATABASE_SCHEMA_VERSION};
      COMMIT;
    `);
  }

  private findEntryId(eventKey: string, kind: 'handoff' | 'wave_message') {
    const row = this.database
      .prepare(
        `SELECT id, kind
         FROM realtime_entries
         WHERE event_key = ?`,
      )
      .get(parseEventKey(eventKey)) as
      { id: string; kind: 'handoff' | 'wave_message' } | undefined;
    if (!row || row.kind !== kind) {
      throw new Error('Interaction entry could not be created.');
    }
    return row.id;
  }

  private requireTurnSession(turnId: string, sessionId: string) {
    const row = this.database
      .prepare(
        `SELECT session_id
         FROM realtime_turns
         WHERE id = ?`,
      )
      .get(turnId) as { session_id: string } | undefined;
    if (!row || row.session_id !== sessionId) {
      throw new Error('Interaction turn does not belong to the session.');
    }
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

function parseEventKey(eventKey: string) {
  if (!/^[a-f0-9]{64}$/.test(eventKey)) {
    throw new Error('Interaction event key is invalid.');
  }
  return eventKey;
}

function toInteractionEntry(row: RealtimeEntryRow): InteractionEntryRecord {
  if (row.kind === 'wave_message') {
    if (!row.content) {
      throw new Error('Stored Wave interaction message is invalid.');
    }
    return {
      content: row.content,
      createdAt: row.created_at,
      id: row.id,
      type: 'wave_message',
    };
  }
  if (!row.instruction || !row.status) {
    throw new Error('Stored Wave interaction handoff is invalid.');
  }
  return {
    ...(row.completed_at ? { completedAt: row.completed_at } : {}),
    createdAt: row.created_at,
    ...(row.hermes_assistant_message_id
      ? { hermesAssistantMessageId: row.hermes_assistant_message_id }
      : {}),
    ...(row.hermes_assistant_message_timestamp === null
      ? {}
      : {
          hermesAssistantMessageTimestamp: parseHermesTimestamp(
            row.hermes_assistant_message_timestamp,
          ),
        }),
    id: row.id,
    instruction: row.instruction,
    ...(row.result_json
      ? {
          result: WaveAskHermesToolResultSchema.parse(
            JSON.parse(row.result_json) as unknown,
          ),
        }
      : {}),
    status: row.status,
    type: 'handoff',
  };
}

function hasOneChange(result: StatementResultingChanges) {
  return result.changes === 1;
}

function parseHermesTimestamp(value: number) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error('Hermes interaction timestamp is invalid.');
  }
  return value;
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
