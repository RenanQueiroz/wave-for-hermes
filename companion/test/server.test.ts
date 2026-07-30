import assert from 'node:assert/strict';
import test from 'node:test';

import { WaveErrorResponseSchema, WaveStatusResponseSchema } from '@wave/contracts';

import { buildCompanionServer } from '../src/app.ts';
import type { CompanionConfig } from '../src/config.ts';

const config: CompanionConfig = {
  hermes: {
    baseUrl: 'https://hermes.example.test',
    bearerToken: 'server-only-key',
  },
  host: '127.0.0.1',
  port: 8787,
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
  assert.equal(status.status, 'ok');
  assert.deepEqual(status.features, {
    chat: false,
    pairing: false,
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
  assert.equal(error.error.code, 'not_found');
  assert.equal(error.error.retryable, false);
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
