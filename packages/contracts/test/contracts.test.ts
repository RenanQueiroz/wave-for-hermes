import assert from 'node:assert/strict';
import test from 'node:test';

import { z } from 'zod';

import {
  WAVE_TOOL_DETAIL_MAX_CHARS,
  WAVE_MAX_REDIRECT_CHARS,
  WAVE_MAX_IMAGE_ATTACHMENT_BYTES,
  WAVE_API_VERSION,
  WaveAssistantDeltaEventSchema,
  WaveAskHermesArgumentsSchema,
  WaveAskHermesToolResultSchema,
  WaveEndRealtimeCallResponseSchema,
  WaveErrorSchema,
  WaveRedirectTurnRequestSchema,
  WaveRedirectTurnResponseSchema,
  WaveActiveTurnResponseSchema,
  WaveSessionHistoryResponseSchema,
  WaveStartRealtimeCallResponseSchema,
  WaveToolDetailSchema,
  WaveTurnEventSchema,
  WaveTurnInputSchema,
  WaveTimelineResponseSchema,
} from '../src/index.ts';

test('rejects malformed normalized errors', () => {
  assert.equal(
    WaveErrorSchema.safeParse({
      code: 'unknown',
      message: '',
      retryable: 'sometimes',
    }).success,
    false,
  );
  assert.equal(
    WaveErrorSchema.parse({
      code: 'upstream_unavailable',
      message: 'Hermes is unreachable.',
      retryable: true,
    }).retryable,
    true,
  );
});

test('accepts only bounded Wave-owned unified timeline entries', () => {
  const response = WaveTimelineResponseSchema.parse({
    apiVersion: WAVE_API_VERSION,
    entries: [
      {
        completedAt: '2026-07-30T23:00:02.000Z',
        createdAt: '2026-07-30T23:00:01.000Z',
        id: 'wave-handoff-1',
        instruction: 'Turn off the bedroom lights.',
        result: {
          answer: 'The bedroom lights are off.',
          ok: true,
          truncated: false,
        },
        status: 'completed',
        turnId: 'wave-turn-1',
        type: 'handoff',
      },
    ],
    hasMore: false,
    limit: 100,
    sessionId: 'session-1',
  });

  assert.equal(response.entries[0]?.type, 'handoff');
  assert.equal(
    WaveTimelineResponseSchema.safeParse({
      ...response,
      entries: [
        {
          ...response.entries[0],
          providerCallId: 'must-not-cross-the-boundary',
        },
      ],
    }).success,
    false,
  );
});

test('history messages carry no provider identifiers', () => {
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

test('accepts bounded attachment turns', () => {
  const input = WaveTurnInputSchema.parse([
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
  ]);
  assert.equal(Array.isArray(input), true);
  // Attachments without a message are rejected.
  assert.equal(
    WaveTurnInputSchema.safeParse([
      {
        dataUrl: 'data:image/jpeg;base64,aGVsbG8=',
        mimeType: 'image/png',
        name: 'photo.jpg',
        type: 'image',
      },
    ]).success,
    false,
  );
  // A mismatched MIME type is rejected.
  assert.equal(
    WaveTurnInputSchema.safeParse([
      { text: 'Review', type: 'text' },
      {
        dataUrl: 'data:image/jpeg;base64,A',
        mimeType: 'image/jpeg',
        name: 'invalid.jpg',
        type: 'image',
      },
    ]).success,
    false,
  );
  // An oversized image is rejected.
  assert.equal(
    WaveTurnInputSchema.safeParse([
      { text: 'Review', type: 'text' },
      {
        dataUrl: `data:image/jpeg;base64,${'a'.repeat(
          Math.ceil((WAVE_MAX_IMAGE_ATTACHMENT_BYTES * 4) / 3) + 4,
        )}`,
        mimeType: 'image/jpeg',
        name: 'large.jpg',
        type: 'image',
      },
    ]).success,
    false,
  );
});

test('accepts only strict bounded text-only turn corrections', () => {
  assert.deepEqual(
    WaveRedirectTurnRequestSchema.parse({ text: '  use SQLite instead  ' }),
    { text: 'use SQLite instead' },
  );
  assert.equal(
    WaveRedirectTurnRequestSchema.safeParse({
      sessionId: 'model-controlled-session',
      text: 'use SQLite',
    }).success,
    false,
  );
  assert.equal(
    WaveRedirectTurnRequestSchema.safeParse({ text: ' ' }).success,
    false,
  );
  assert.equal(
    WaveRedirectTurnRequestSchema.safeParse({
      text: 'x'.repeat(WAVE_MAX_REDIRECT_CHARS + 1),
    }).success,
    false,
  );

  for (const status of ['queued', 'redirected', 'rejected'] as const) {
    assert.equal(
      WaveRedirectTurnResponseSchema.safeParse({
        apiVersion: WAVE_API_VERSION,
        sessionId: 'session-1',
        status,
      }).success,
      true,
    );
  }
  assert.equal(
    WaveRedirectTurnResponseSchema.safeParse({
      apiVersion: WAVE_API_VERSION,
      rawCallId: 'must-not-cross',
      sessionId: 'session-1',
      status: 'redirected',
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

test('validates bounded v0.20 stream projections and live state', () => {
  const base = {
    apiVersion: WAVE_API_VERSION,
    eventId: 'event-v020',
    sequence: 2,
    sessionId: 'session-v020',
    timestamp: '2026-08-03T00:00:00.000Z',
    turnId: 'turn-v020',
  };
  assert.equal(
    WaveTurnEventSchema.parse({
      ...base,
      content: 'A sealed segment.',
      messageId: 'message-v020',
      type: 'assistant.interim',
    }).type,
    'assistant.interim',
  );
  assert.equal(
    WaveTurnEventSchema.safeParse({
      ...base,
      content: 'x'.repeat(1_000_001),
      messageId: 'message-v020',
      type: 'assistant.interim',
    }).success,
    false,
  );
  assert.equal(
    WaveTurnEventSchema.parse({
      ...base,
      status: 'compacting',
      type: 'activity.status',
    }).type,
    'activity.status',
  );
  assert.equal(
    WaveTurnEventSchema.safeParse({
      ...base,
      status: 'raw-reasoning',
      type: 'activity.status',
    }).success,
    false,
  );

  const active = WaveActiveTurnResponseSchema.parse({
    activeTurn: { latestSequence: -1, turnId: 'turn-v020' },
    apiVersion: WAVE_API_VERSION,
    lastActiveAt: '2026-08-03T00:00:00.000Z',
    liveStatus: 'waiting',
    sessionId: 'session-v020',
  });
  assert.equal(active.liveStatus, 'waiting');
  assert.equal(
    WaveActiveTurnResponseSchema.safeParse({
      ...active,
      liveStatus: 'future-raw-status',
    }).success,
    false,
  );
});

test('validates bounded Realtime call results without exposing provider identifiers', () => {
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
    WaveStartRealtimeCallResponseSchema.safeParse({
      ...response,
      call: {
        ...response.call,
        sdpAnswer: 'not-sdp',
      },
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
