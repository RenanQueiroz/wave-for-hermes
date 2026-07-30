import { z } from 'zod';

import type { HermesConnectionConfig } from './hermes/hermes-types.ts';

const CompanionEnvironmentSchema = z.object({
  HERMES_ALLOW_INSECURE_HTTP: z.enum(['0', '1', 'false', 'true']).optional(),
  HERMES_API_KEY: z.string().trim().min(1),
  HERMES_API_URL: z.url(),
  WAVE_HOST: z.string().trim().min(1).default('127.0.0.1'),
  WAVE_PORT: z.coerce.number().int().min(1).max(65_535).default(8787),
});

export interface CompanionConfig {
  hermes: HermesConnectionConfig;
  host: string;
  port: number;
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

  return {
    hermes: {
      allowInsecureHttp,
      baseUrl: parsed.data.HERMES_API_URL,
      bearerToken: parsed.data.HERMES_API_KEY,
    },
    host: parsed.data.WAVE_HOST,
    port: parsed.data.WAVE_PORT,
  };
}
