import assert from 'node:assert/strict';
import test from 'node:test';

import {
  WaveErrorResponseSchema,
  WaveStatusResponseSchema,
} from '@wave/contracts';

import { buildCompanionServer } from '../src/app.ts';
import type { CompanionConfig } from '../src/config.ts';
import { createCompanionLoggerOptions } from '../src/logging.ts';

const config: CompanionConfig = {
  databasePath: ':memory:',
  hermes: {
    baseUrl: 'https://hermes.example.test',
    bearerToken: 'server-only-key',
  },
  hermesFirstEventTimeoutMs: 30_000,
  hermesIdleTimeoutMs: 60_000,
  hermesTotalTimeoutMs: 600_000,
  host: '127.0.0.1',
  maxActiveRealtimeCalls: 2,
  maxActiveTurns: 4,
  pairingCodeTtlSeconds: 600,
  port: 8787,
  realtimeCallTtlMs: 1_800_000,
  realtimeToolTimeoutMs: 120_000,
};

test('returns a strict, non-sensitive compatibility status', async () => {
  const app = buildCompanionServer(config, {
    now: () => new Date('2026-07-29T23:59:00.000Z'),
  });

  const response = await app.inject({
    method: 'GET',
    url: '/v1/status',
  });
  await app.close();

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['cache-control'], 'no-store');
  const status = WaveStatusResponseSchema.parse(response.json());
  assert.equal(response.headers['x-wave-request-id'], status.requestId);
  assert.equal(status.status, 'ok');
  assert.deepEqual(status.features, {
    chat: true,
    pairing: true,
    realtime: false,
  });
  assert.equal(status.hermes.configured, true);
  assert.equal(response.body.includes('server-only-key'), false);
  assert.equal(response.body.includes('hermes.example.test'), false);
});

test('returns the normalized Wave error envelope for unknown routes', async () => {
  const app = buildCompanionServer(config);
  const response = await app.inject({
    method: 'GET',
    url: '/not-a-wave-route',
  });
  await app.close();

  assert.equal(response.statusCode, 404);
  const error = WaveErrorResponseSchema.parse(response.json());
  assert.equal(
    response.headers['x-wave-request-id'],
    error.error.correlationId,
  );
  assert.equal(error.error.code, 'not_found');
  assert.equal(error.error.retryable, false);
});

test('logs only bounded request metadata with an opaque correlation ID', async () => {
  const lines: string[] = [];
  const app = buildCompanionServer(config, {
    logger: {
      ...createCompanionLoggerOptions('info'),
      stream: {
        write(message) {
          lines.push(message);
        },
      },
    },
  });

  const response = await app.inject({
    headers: {
      authorization: 'Bearer must-never-appear',
      cookie: 'session=must-never-appear',
    },
    method: 'GET',
    url: '/not-a-wave-route/private-session-id?token=must-never-appear',
  });
  await app.close();

  assert.equal(response.statusCode, 404);
  const output = lines.join('');
  assert.equal(output.includes('must-never-appear'), false);
  assert.equal(output.includes('private-session-id'), false);
  assert.equal(output.includes('remoteAddress'), false);
  assert.equal(output.includes('"url"'), false);

  const entries = lines.map(
    (line) => JSON.parse(line) as Record<string, unknown>,
  );
  assert.equal(
    entries.some(
      (entry) =>
        typeof entry.reqId === 'string' &&
        (entry.req as { method?: unknown } | undefined)?.method === 'GET',
    ),
    true,
  );
  assert.equal(
    entries.some(
      (entry) =>
        typeof entry.reqId === 'string' &&
        (entry.res as { statusCode?: unknown } | undefined)?.statusCode ===
          404 &&
        typeof entry.responseTime === 'number',
    ),
    true,
  );
});

test('does not expose internal failures through the Wave boundary', async () => {
  const app = buildCompanionServer(config, {
    now: () => new Date(Number.NaN),
  });
  const response = await app.inject({
    method: 'GET',
    url: '/v1/status',
  });
  await app.close();

  assert.equal(response.statusCode, 500);
  const error = WaveErrorResponseSchema.parse(response.json());
  assert.equal(error.error.code, 'internal');
  assert.equal(error.error.retryable, false);
  assert.equal(response.body.includes('Invalid time value'), false);
  assert.equal(response.body.includes('server-only-key'), false);
});
