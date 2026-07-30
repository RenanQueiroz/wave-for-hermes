import { z } from 'zod';

import type { HermesConnectionConfig } from './hermes/hermes-types.ts';

const CompanionEnvironmentSchema = z.object({
  HERMES_ALLOW_INSECURE_HTTP: z.enum(['0', '1', 'false', 'true']).optional(),
  HERMES_API_KEY: z.string().trim().min(1),
  HERMES_API_URL: z.url(),
  WAVE_DATABASE_PATH: z
    .string()
    .trim()
    .min(1)
    .default('./data/wave-companion.sqlite'),
  WAVE_HERMES_FIRST_EVENT_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(120_000)
    .default(30_000),
  WAVE_HERMES_IDLE_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(300_000)
    .default(60_000),
  WAVE_HERMES_TOTAL_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(10_000)
    .max(3_600_000)
    .default(600_000),
  WAVE_HOST: z.string().trim().min(1).default('127.0.0.1'),
  WAVE_MAX_ACTIVE_TURNS: z.coerce
    .number()
    .int()
    .min(1)
    .max(32)
    .default(4),
  WAVE_PAIRING_CODE_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(60)
    .max(3_600)
    .default(600),
  WAVE_PORT: z.coerce.number().int().min(1).max(65_535).default(8787),
});

export interface CompanionConfig {
  databasePath: string;
  hermes: HermesConnectionConfig;
  hermesFirstEventTimeoutMs: number;
  hermesIdleTimeoutMs: number;
  hermesTotalTimeoutMs: number;
  host: string;
  maxActiveTurns: number;
  pairingCodeTtlSeconds: number;
  port: number;
}

export interface CompanionStorageConfig {
  databasePath: string;
  pairingCodeTtlSeconds: number;
}

export class CompanionConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CompanionConfigError';
  }
}

export function loadCompanionConfig(
  environment: NodeJS.ProcessEnv = process.env,
): CompanionConfig {
  const parsed = CompanionEnvironmentSchema.safeParse(environment);
  if (!parsed.success) {
    const fields = [
      ...new Set(
        parsed.error.issues
          .map((issue) => issue.path[0])
          .filter((field): field is string => typeof field === 'string'),
      ),
    ].sort();
    throw new CompanionConfigError(
      `Invalid Wave Companion configuration: ${fields.join(', ') || 'environment'}.`,
    );
  }

  const allowInsecureHttp =
    parsed.data.HERMES_ALLOW_INSECURE_HTTP === '1' ||
    parsed.data.HERMES_ALLOW_INSECURE_HTTP === 'true';
  const hermesUrl = new URL(parsed.data.HERMES_API_URL);

  if (
    hermesUrl.username ||
    hermesUrl.password ||
    hermesUrl.search ||
    hermesUrl.hash
  ) {
    throw new CompanionConfigError(
      'Invalid Wave Companion configuration: HERMES_API_URL cannot contain credentials, a query, or a fragment.',
    );
  }
  if (
    hermesUrl.protocol !== 'https:' &&
    !(allowInsecureHttp && hermesUrl.protocol === 'http:')
  ) {
    throw new CompanionConfigError(
      'Invalid Wave Companion configuration: HERMES_API_URL requires HTTPS unless HERMES_ALLOW_INSECURE_HTTP is explicitly enabled.',
    );
  }
  if (
    parsed.data.WAVE_HERMES_TOTAL_TIMEOUT_MS <=
      parsed.data.WAVE_HERMES_FIRST_EVENT_TIMEOUT_MS ||
    parsed.data.WAVE_HERMES_TOTAL_TIMEOUT_MS <=
      parsed.data.WAVE_HERMES_IDLE_TIMEOUT_MS
  ) {
    throw new CompanionConfigError(
      'Invalid Wave Companion configuration: WAVE_HERMES_TOTAL_TIMEOUT_MS must exceed the first-event and idle timeouts.',
    );
  }

  return {
    databasePath: parsed.data.WAVE_DATABASE_PATH,
    hermes: {
      allowInsecureHttp,
      baseUrl: parsed.data.HERMES_API_URL,
      bearerToken: parsed.data.HERMES_API_KEY,
    },
    hermesFirstEventTimeoutMs:
      parsed.data.WAVE_HERMES_FIRST_EVENT_TIMEOUT_MS,
    hermesIdleTimeoutMs: parsed.data.WAVE_HERMES_IDLE_TIMEOUT_MS,
    hermesTotalTimeoutMs: parsed.data.WAVE_HERMES_TOTAL_TIMEOUT_MS,
    host: parsed.data.WAVE_HOST,
    maxActiveTurns: parsed.data.WAVE_MAX_ACTIVE_TURNS,
    pairingCodeTtlSeconds: parsed.data.WAVE_PAIRING_CODE_TTL_SECONDS,
    port: parsed.data.WAVE_PORT,
  };
}

export function loadCompanionStorageConfig(
  environment: NodeJS.ProcessEnv = process.env,
): CompanionStorageConfig {
  const parsed = CompanionEnvironmentSchema.pick({
    WAVE_DATABASE_PATH: true,
    WAVE_PAIRING_CODE_TTL_SECONDS: true,
  }).safeParse(environment);
  if (!parsed.success) {
    const fields = [
      ...new Set(
        parsed.error.issues
          .map((issue) => issue.path[0])
          .filter((field): field is string => typeof field === 'string'),
      ),
    ].sort();
    throw new CompanionConfigError(
      `Invalid Wave Companion storage configuration: ${fields.join(', ') || 'environment'}.`,
    );
  }
  return {
    databasePath: parsed.data.WAVE_DATABASE_PATH,
    pairingCodeTtlSeconds: parsed.data.WAVE_PAIRING_CODE_TTL_SECONDS,
  };
}
