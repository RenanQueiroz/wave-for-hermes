import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CompanionConfigError,
  loadCompanionConfig,
} from '../src/config.ts';

test('loads server-only Hermes and listener configuration', () => {
  const config = loadCompanionConfig({
    HERMES_ALLOW_INSECURE_HTTP: 'true',
    HERMES_API_KEY: 'server-only-key',
    HERMES_API_URL: 'http://hermes:8642',
    WAVE_HOST: '0.0.0.0',
    WAVE_PORT: '9000',
  });

  assert.deepEqual(config, {
    databasePath: './data/wave-companion.sqlite',
    hermes: {
      allowInsecureHttp: true,
      baseUrl: 'http://hermes:8642',
      bearerToken: 'server-only-key',
    },
    hermesFirstEventTimeoutMs: 30_000,
    hermesIdleTimeoutMs: 60_000,
    hermesTotalTimeoutMs: 600_000,
    host: '0.0.0.0',
    maxActiveTurns: 4,
    pairingCodeTtlSeconds: 600,
    port: 9000,
  });
});

test('fails clearly without exposing configuration values', () => {
  const secret = 'must-never-appear';

  assert.throws(
    () =>
      loadCompanionConfig({
        HERMES_API_KEY: secret,
        HERMES_API_URL: 'not-a-url',
        WAVE_PORT: 'invalid',
      }),
    (error: unknown) =>
      error instanceof CompanionConfigError &&
      error.message.includes('HERMES_API_URL') &&
      error.message.includes('WAVE_PORT') &&
      !error.message.includes(secret),
  );
});

test('requires HTTPS unless private HTTP is explicitly enabled', () => {
  assert.throws(
    () =>
      loadCompanionConfig({
        HERMES_API_KEY: 'server-only-key',
        HERMES_API_URL: 'http://hermes:8642',
      }),
    (error: unknown) =>
      error instanceof CompanionConfigError &&
      error.message.includes('requires HTTPS'),
  );
});
