import assert from 'node:assert/strict';
import test from 'node:test';

import {
  WAVE_API_VERSION,
  WaveAssistantDeltaEventSchema,
  WaveCreateSessionRequestSchema,
  WaveDeviceCredentialSchema,
  WaveErrorResponseSchema,
  WaveEventEnvelopeSchema,
  WaveRedeemPairingRequestSchema,
  WaveSessionHistoryResponseSchema,
  WaveTurnEventSchema,
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

test('accepts only strict pairing and device credential values', () => {
  assert.equal(
    WaveRedeemPairingRequestSchema.parse({
      code: 'ABCD-EFGH-JKLM-NPQR',
      deviceName: 'Renan iPhone',
    }).deviceName,
    'Renan iPhone',
  );
  assert.equal(
    WaveDeviceCredentialSchema.safeParse(
      `wave_device_${'a'.repeat(43)}`,
    ).success,
    true,
  );
  assert.equal(
    WaveRedeemPairingRequestSchema.safeParse({
      code: 'ABCD-EFGH-JKLM-NPQR',
      deviceName: 'Renan iPhone',
      requestedRole: 'administrator',
    }).success,
    false,
  );
  assert.equal(
    WaveDeviceCredentialSchema.safeParse('ordinary-api-key').success,
    false,
  );
});

test('bounds session inputs and strips no unknown fields', () => {
  assert.deepEqual(WaveCreateSessionRequestSchema.parse({}), {});
  assert.equal(
    WaveCreateSessionRequestSchema.safeParse({
      model: 'model-controlled-by-mobile',
    }).success,
    false,
  );
  assert.equal(
    WaveSessionHistoryResponseSchema.safeParse({
      apiVersion: WAVE_API_VERSION,
      messages: [
        {
          content: 'Hello',
          role: 'assistant',
          rawHermesRunId: 'must-not-cross',
        },
      ],
      sessionId: 'session-1',
    }).success,
    false,
  );
});

test('validates each normalized turn event variant strictly', () => {
  const delta = WaveTurnEventSchema.parse({
    apiVersion: WAVE_API_VERSION,
    delta: 'Hello',
    eventId: 'event-1',
    messageId: 'message-1',
    sequence: 1,
    sessionId: 'session-1',
    timestamp: '2026-07-29T23:59:00.000Z',
    turnId: 'turn-1',
    type: 'assistant.delta',
  });

  assert.equal(delta.type, 'assistant.delta');
  assert.equal(
    WaveAssistantDeltaEventSchema.safeParse({
      ...delta,
      rawToolArguments: { command: 'secret' },
    }).success,
    false,
  );
  assert.equal(
    WaveTurnEventSchema.safeParse({
      ...delta,
      delta: '',
    }).success,
    false,
  );
  assert.equal(
    WaveTurnEventSchema.safeParse({
      ...delta,
      type: 'hermes.run.started',
    }).success,
    false,
  );
});
