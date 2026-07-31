import {
  WaveDeviceCredentialSchema,
  WaveDeviceSchema,
  type WaveDevice,
} from '@wave/contracts';

import { normalizeWaveBaseUrl } from '../wave/wave-backend-client.ts';

const CONNECTION_RECORD_VERSION = 1;

export interface WaveConnectionRecord {
  baseUrl: string;
  credential: string;
  device: WaveDevice;
  version: typeof CONNECTION_RECORD_VERSION;
}

export interface WaveConnectionSummary {
  baseUrl: string;
  device: WaveDevice;
}

export interface WaveCredentialStore {
  clear(): Promise<void>;
  load(): Promise<WaveConnectionRecord | undefined>;
  save(record: WaveConnectionRecord): Promise<void>;
}

export function createWaveConnectionRecord(
  input: Omit<WaveConnectionRecord, 'version'>,
  options: { allowInsecureHttp?: boolean } = {},
): WaveConnectionRecord {
  return {
    baseUrl: normalizeWaveBaseUrl(input.baseUrl, options),
    credential: WaveDeviceCredentialSchema.parse(input.credential),
    device: WaveDeviceSchema.parse(input.device),
    version: CONNECTION_RECORD_VERSION,
  };
}

export function parseWaveConnectionRecord(
  serialized: string,
  options: { allowInsecureHttp?: boolean } = {},
) {
  let value: unknown;
  try {
    value = JSON.parse(serialized) as unknown;
  } catch {
    throw new WaveCredentialStoreError(
      'The stored Wave connection is invalid.',
    );
  }
  if (!isRecord(value) || value.version !== CONNECTION_RECORD_VERSION) {
    throw new WaveCredentialStoreError(
      'The stored Wave connection is invalid.',
    );
  }
  try {
    return createWaveConnectionRecord(
      {
        baseUrl: requiredString(value.baseUrl),
        credential: requiredString(value.credential),
        device: WaveDeviceSchema.parse(value.device),
      },
      options,
    );
  } catch {
    throw new WaveCredentialStoreError(
      'The stored Wave connection is invalid.',
    );
  }
}

export function serializeWaveConnectionRecord(
  record: WaveConnectionRecord,
  options: { allowInsecureHttp?: boolean } = {},
) {
  return JSON.stringify(createWaveConnectionRecord(record, options));
}

export function toWaveConnectionSummary(
  record: WaveConnectionRecord,
): WaveConnectionSummary {
  return {
    baseUrl: record.baseUrl,
    device: record.device,
  };
}

export class WaveCredentialStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WaveCredentialStoreError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown) {
  if (typeof value !== 'string') {
    throw new Error('Expected a string.');
  }
  return value;
}
