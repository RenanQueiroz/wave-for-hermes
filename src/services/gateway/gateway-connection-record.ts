/**
 * The persisted gateway connection: base URL, identity, and the token pair.
 *
 * Pure parse/serialize so node tests cover the validation; the secure-storage
 * binding is `secure-gateway-store.ts`. Tokens are device-only secrets — they
 * never appear in logs, diagnostics, or connection summaries.
 */
import { isCompleteTokenSet, type GatewayTokens } from './gateway-tokens.ts';
import { normalizeGatewayBaseUrl } from './gateway-client.ts';

export const GATEWAY_RECORD_VERSION = 1 as const;

export interface GatewayConnectionRecord {
  baseUrl: string;
  provider: string;
  tokens: GatewayTokens;
  userId: string;
  version: typeof GATEWAY_RECORD_VERSION;
}

export class GatewayStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GatewayStoreError';
  }
}

export interface GatewayConnectionStore {
  clear(): Promise<void>;
  load(): Promise<GatewayConnectionRecord | undefined>;
  save(record: GatewayConnectionRecord): Promise<void>;
}

export function createGatewayConnectionRecord(
  input: {
    baseUrl: string;
    provider: string;
    tokens: GatewayTokens;
    userId: string;
  },
  options: { allowInsecureHttp?: boolean } = {},
): GatewayConnectionRecord {
  if (!isCompleteTokenSet(input.tokens)) {
    throw new GatewayStoreError('The Hermes session is incomplete.');
  }
  const userId = input.userId.trim();
  const provider = input.provider.trim();
  if (!provider) {
    throw new GatewayStoreError('The Hermes session has no provider.');
  }
  return {
    baseUrl: normalizeGatewayBaseUrl(input.baseUrl, options),
    provider,
    tokens: input.tokens,
    userId,
    version: GATEWAY_RECORD_VERSION,
  };
}

export function parseGatewayConnectionRecord(
  serialized: string,
  options: { allowInsecureHttp?: boolean } = {},
): GatewayConnectionRecord {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw new GatewayStoreError('The stored Hermes session is invalid.');
  }
  if (
    typeof value !== 'object' ||
    value === null ||
    (value as { version?: unknown }).version !== GATEWAY_RECORD_VERSION
  ) {
    throw new GatewayStoreError('The stored Hermes session is invalid.');
  }
  const record = value as Record<string, unknown>;
  const tokens = record.tokens;
  if (
    typeof record.baseUrl !== 'string' ||
    typeof record.provider !== 'string' ||
    typeof record.userId !== 'string' ||
    typeof tokens !== 'object' ||
    tokens === null
  ) {
    throw new GatewayStoreError('The stored Hermes session is invalid.');
  }
  try {
    return createGatewayConnectionRecord(
      {
        baseUrl: record.baseUrl,
        provider: record.provider,
        tokens: tokens as GatewayTokens,
        userId: record.userId,
      },
      options,
    );
  } catch {
    throw new GatewayStoreError('The stored Hermes session is invalid.');
  }
}

export function serializeGatewayConnectionRecord(
  record: GatewayConnectionRecord,
): string {
  return JSON.stringify(record);
}
