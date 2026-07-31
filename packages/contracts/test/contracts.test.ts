import assert from 'node:assert/strict';
import test from 'node:test';

import { z } from 'zod';

import {
  WAVE_TOOL_DETAIL_MAX_CHARS,
  WAVE_MAX_IMAGE_ATTACHMENT_BYTES,
  WAVE_API_VERSION,
  WaveAssistantDeltaEventSchema,
  WaveCreateSessionRequestSchema,
  WaveDeviceCredentialSchema,
  WaveErrorResponseSchema,
  WaveEventEnvelopeSchema,
  WaveAskHermesArgumentsSchema,
  WaveAskHermesToolResultSchema,
  WaveEndRealtimeCallResponseSchema,
  WaveRedeemPairingRequestSchema,
  WaveStartRealtimeCallRequestSchema,
  WaveStartRealtimeCallResponseSchema,
  WaveSessionHistoryResponseSchema,
  WaveScheduledJobListResponseSchema,
  WaveStartTurnRequestSchema,
  WaveToolDetailSchema,
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
    WaveDeviceCredentialSchema.safeParse(`wave_device_${'a'.repeat(43)}`)
      .success,
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

test('accepts bounded attachment turns and normalized read-only jobs', () => {
  const input = WaveStartTurnRequestSchema.parse({
    input: [
      { text: 'Review these', type: 'text' },
      {
        dataUrl: 'data:image/jpeg;base64,aGVsbG8=',
        mimeType: 'image/jpeg',
        name: 'photo.jpg',
        type: 'image',
      },
      {
        mimeType: 'text/markdown',
        name: 'notes.md',
        text: '# Notes',
        type: 'text_file',
      },
    ],
  });
  assert.equal(Array.isArray(input.input), true);
  assert.equal(
    WaveStartTurnRequestSchema.safeParse({
      input: [
        {
          dataUrl: 'data:image/jpeg;base64,aGVsbG8=',
          mimeType: 'image/png',
          name: 'photo.jpg',
          type: 'image',
        },
      ],
    }).success,
    false,
  );
  assert.equal(
    WaveStartTurnRequestSchema.safeParse({
      input: [
        { text: 'Review', type: 'text' },
        {
          dataUrl: 'data:image/jpeg;base64,A',
          mimeType: 'image/jpeg',
          name: 'invalid.jpg',
          type: 'image',
        },
      ],
    }).success,
    false,
  );
  assert.equal(
    WaveStartTurnRequestSchema.safeParse({
      input: [
        { text: 'Review', type: 'text' },
        {
          dataUrl: `data:image/jpeg;base64,${'a'.repeat(
            Math.ceil((WAVE_MAX_IMAGE_ATTACHMENT_BYTES * 4) / 3) + 4,
          )}`,
          mimeType: 'image/jpeg',
          name: 'large.jpg',
          type: 'image',
        },
      ],
    }).success,
    false,
  );
  assert.equal(
    WaveScheduledJobListResponseSchema.safeParse({
      apiVersion: WAVE_API_VERSION,
      jobs: [
        {
          enabled: true,
          id: 'job-1',
          name: 'Morning briefing',
          prompt: 'must not cross',
          schedule: 'Every day at 9:00 AM',
          state: 'scheduled',
        },
      ],
    }).success,
    false,
  );
});

test('accepts only strict bounded inert tool details', () => {
  assert.deepEqual(
    WaveToolDetailSchema.parse({
      text: '{"query":"Wave"}',
      truncated: false,
    }),
    {
      text: '{"query":"Wave"}',
      truncated: false,
    },
  );
  assert.equal(
    WaveToolDetailSchema.safeParse({
      text: 'x'.repeat(WAVE_TOOL_DETAIL_MAX_CHARS + 1),
      truncated: true,
    }).success,
    false,
  );
  assert.equal(
    WaveToolDetailSchema.safeParse({
      authorization: 'must-not-cross',
      text: '{}',
      truncated: false,
    }).success,
    false,
  );
  assert.equal(
    WaveTurnEventSchema.safeParse({
      apiVersion: WAVE_API_VERSION,
      eventId: 'event-tool',
      sequence: 1,
      sessionId: 'session-1',
      status: 'completed',
      timestamp: '2026-07-30T02:00:00.000Z',
      toolInput: {
        text: '{"command":"pwd"}',
        truncated: false,
      },
      toolOutput: {
        text: '/repo',
        truncated: false,
      },
      toolOutputIsPreview: true,
      turnId: 'turn-1',
      type: 'tool.status',
    }).success,
    true,
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

test('validates bounded Realtime SDP call setup without exposing provider identifiers', () => {
  const request = WaveStartRealtimeCallRequestSchema.parse({
    sdpOffer: 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n',
  });
  assert.equal(request.sdpOffer.startsWith('v=0'), true);

  const response = WaveStartRealtimeCallResponseSchema.parse({
    apiVersion: WAVE_API_VERSION,
    call: {
      expiresAt: '2026-07-30T03:30:00.000Z',
      id: 'wave-call-1',
      sdpAnswer: 'v=0\r\no=- 2 3 IN IP4 127.0.0.1\r\n',
    },
  });
  assert.equal(response.call.id, 'wave-call-1');
  assert.equal(
    WaveStartRealtimeCallResponseSchema.safeParse({
      ...response,
      call: {
        ...response.call,
        openAICallId: 'rtc_must_not_cross',
      },
    }).success,
    false,
  );
  assert.equal(
    WaveStartRealtimeCallRequestSchema.safeParse({
      sdpOffer: 'not-sdp',
    }).success,
    false,
  );
  assert.equal(
    WaveEndRealtimeCallResponseSchema.parse({
      apiVersion: WAVE_API_VERSION,
      callId: 'wave-call-1',
      status: 'ended',
    }).status,
    'ended',
  );
});

test('generates a strict ask_hermes JSON Schema from the dispatch schema', () => {
  assert.deepEqual(
    WaveAskHermesArgumentsSchema.parse({
      instruction: '  Check the deployment  ',
    }),
    {
      instruction: 'Check the deployment',
    },
  );
  assert.equal(
    WaveAskHermesArgumentsSchema.safeParse({
      instruction: 'Do the work',
      sessionId: 'model-selected-session',
    }).success,
    false,
  );

  const jsonSchema = z.toJSONSchema(WaveAskHermesArgumentsSchema);
  assert.equal(jsonSchema.type, 'object');
  assert.equal(jsonSchema.additionalProperties, false);
  assert.deepEqual(jsonSchema.required, ['instruction']);
  assert.equal(
    typeof jsonSchema.properties?.instruction === 'object' &&
      jsonSchema.properties.instruction !== null &&
      jsonSchema.properties.instruction.maxLength,
    8_000,
  );
});

test('accepts only small structured ask_hermes results', () => {
  assert.equal(
    WaveAskHermesToolResultSchema.parse({
      answer: 'Hermes completed the request.',
      ok: true,
      truncated: false,
    }).ok,
    true,
  );
  assert.equal(
    WaveAskHermesToolResultSchema.safeParse({
      answer: 'Hermes completed the request.',
      ok: true,
      rawToolOutput: {
        authorization: 'must-not-cross',
      },
      truncated: false,
    }).success,
    false,
  );
  assert.equal(
    WaveAskHermesToolResultSchema.parse({
      error: {
        code: 'invalid_arguments',
        message: 'The tool arguments were invalid.',
        retryable: false,
      },
      ok: false,
    }).ok,
    false,
  );
});
