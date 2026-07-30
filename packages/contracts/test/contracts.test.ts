import assert from 'node:assert/strict';
import test from 'node:test';

import {
  WAVE_API_VERSION,
  WaveErrorResponseSchema,
  WaveEventEnvelopeSchema,
  WaveStatusResponseSchema,
} from '../src/index.ts';

test('accepts a strict versioned companion status response', () => {
  const result = WaveStatusResponseSchema.parse({
    apiVersion: WAVE_API_VERSION,
    features: {
      chat: false,
      pairing: false,
      realtime: false,
    },
    hermes: {
      configured: true,
    },
    serverTime: '2026-07-29T23:59:00.000Z',
    service: 'wave-companion',
    serviceVersion: '0.1.0',
    status: 'ok',
  });

  assert.equal(result.apiVersion, 'v1');
  assert.equal(result.hermes.configured, true);
});

test('rejects unknown status fields and malformed errors', () => {
  assert.equal(
    WaveStatusResponseSchema.safeParse({
      apiVersion: WAVE_API_VERSION,
      features: {
        chat: false,
        pairing: false,
        realtime: false,
      },
      hermes: {
        configured: true,
      },
      secret: 'must not cross the boundary',
      serverTime: '2026-07-29T23:59:00.000Z',
      service: 'wave-companion',
      serviceVersion: '0.1.0',
      status: 'ok',
    }).success,
    false,
  );

  assert.equal(
    WaveErrorResponseSchema.safeParse({
      apiVersion: WAVE_API_VERSION,
      error: {
        code: 'unknown',
        message: '',
        retryable: 'sometimes',
      },
    }).success,
    false,
  );
});

test('requires ordered, versioned event metadata', () => {
  const event = WaveEventEnvelopeSchema.parse({
    apiVersion: WAVE_API_VERSION,
    eventId: 'event-1',
    sequence: 0,
    timestamp: '2026-07-29T23:59:00.000Z',
    type: 'conversation.started',
  });

  assert.equal(event.sequence, 0);
});
