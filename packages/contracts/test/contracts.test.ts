import assert from 'node:assert/strict';
import test from 'node:test';

import { z } from 'zod';

import {
  WAVE_TOOL_DETAIL_MAX_CHARS,
  WAVE_MAX_REDIRECT_CHARS,
  WAVE_MAX_CORRECT_HERMES_INSTRUCTION_LENGTH,
  WAVE_MAX_IMAGE_ATTACHMENT_BYTES,
  WAVE_API_VERSION,
  WaveAssistantDeltaEventSchema,
  WaveAskHermesArgumentsSchema,
  WaveAskHermesToolResultSchema,
  WaveCorrectHermesArgumentsSchema,
  WaveCorrectHermesToolResultSchema,
  WaveEndRealtimeCallResponseSchema,
  WaveErrorSchema,
  WaveRedirectTurnRequestSchema,
  WaveRedirectTurnResponseSchema,
  WaveActiveTurnResponseSchema,
  WaveSessionHistoryResponseSchema,
  WaveSessionSummarySchema,
  WaveStartRealtimeCallResponseSchema,
  WaveToolDetailSchema,
  WaveTurnEventSchema,
  WaveTurnInputSchema,
  WaveTimelineResponseSchema,
} from '../src/index.ts';

test('session summaries own strict source, pin, and live-status fields', () => {
  assert.deepEqual(WaveSessionSummarySchema.parse({ id: 'legacy-session' }), {
    id: 'legacy-session',
    liveStatus: 'idle',
    pinned: false,
    source: 'chat',
    unread: false,
  });
  assert.equal(
    WaveSessionSummarySchema.safeParse({
      id: 'session-1',
      liveStatus: 'working',
      pinned: true,
      rawSource: 'a2a',
      source: 'external',
    }).success,
    false,
  );
  assert.equal(
    WaveSessionSummarySchema.safeParse({
      id: 'session-1',
      liveStatus: 'running',
      pinned: false,
      source: 'future-source',
    }).success,
    false,
  );
});

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
      {
        id: 'message-41',
        message: { content: 'Safe rewind target', role: 'user' },
        rowId: 41,
        source: 'hermes',
        turnId: 'message-41',
        type: 'message',
      },
    ],
    hasMore: false,
    limit: 100,
    sessionId: 'session-1',
  });

  assert.equal(response.entries[0]?.type, 'handoff');
  assert.equal(response.entries[1]?.type, 'message');
  assert.equal(
    response.entries[1]?.type === 'message'
      ? response.entries[1].rowId
      : undefined,
    41,
  );
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
  assert.equal(
    WaveTimelineResponseSchema.safeParse({
      ...response,
      entries: [
        {
          id: 'message-invalid',
          message: { content: 'Unsafe rewind target', role: 'user' },
          rowId: -1,
          source: 'hermes',
          turnId: 'message-invalid',
          type: 'message',
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
      storedSessionId: 'stored-v0201',
      title: 'Generated while streaming',
      type: 'session.title.updated',
    }).type,
    'session.title.updated',
  );
  assert.equal(
    WaveTurnEventSchema.parse({
      ...base,
      allowsFreeText: false,
      choices: [],
      kind: 'mcp-setup',
      promptId: 'mcp-request-1',
      server: 'github',
      type: 'prompt.request',
    }).type,
    'prompt.request',
  );
  assert.equal(
    WaveTurnEventSchema.safeParse({
      ...base,
      allowsFreeText: false,
      choices: [],
      kind: 'mcp-setup',
      promptId: 'mcp-request-1',
      type: 'prompt.request',
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

test('accepts only strict bounded active-execution corrections', () => {
  assert.deepEqual(
    WaveCorrectHermesArgumentsSchema.parse({
      instruction: '  use SQLite instead  ',
    }),
    { instruction: 'use SQLite instead' },
  );
  for (const injected of [
    { instruction: 'change it', sessionId: 'model-session' },
    { instruction: 'change it', turnId: 'model-turn' },
    { callId: 'model-call', instruction: 'change it' },
    { instruction: 'change it', mode: 'replace' },
    { attachments: [], instruction: 'change it' },
  ]) {
    assert.equal(
      WaveCorrectHermesArgumentsSchema.safeParse(injected).success,
      false,
    );
  }
  assert.equal(
    WaveCorrectHermesArgumentsSchema.safeParse({
      instruction: 'x'.repeat(WAVE_MAX_CORRECT_HERMES_INSTRUCTION_LENGTH + 1),
    }).success,
    false,
  );
  for (const result of [
    { ok: true, status: 'redirected' },
    { ok: true, status: 'queued' },
    {
      message: 'There is no active Hermes work to correct.',
      ok: false,
      retryable: false,
      status: 'nothing_active',
    },
    {
      message: 'Hermes rejected that correction.',
      ok: false,
      retryable: false,
      status: 'rejected',
    },
  ] as const) {
    assert.equal(
      WaveCorrectHermesToolResultSchema.safeParse(result).success,
      true,
    );
  }
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

test('clarify prompts may batch questions or allow multi-select, nothing else may', () => {
  const base = {
    apiVersion: WAVE_API_VERSION,
    eventId: 'event-batch',
    sequence: 4,
    sessionId: 'session-1',
    timestamp: '2026-08-19T00:00:00.000Z',
    turnId: 'turn-1',
  };
  const batch = WaveTurnEventSchema.parse({
    ...base,
    allowsFreeText: true,
    choices: [],
    kind: 'clarify',
    promptId: 'req-batch',
    questions: [
      {
        choices: ['alpha', 'beta'],
        multiSelect: true,
        question: 'Which flavors?',
        questionId: 'q0',
      },
      {
        answer: 'already locked',
        choices: [],
        multiSelect: false,
        question: 'Anything else?',
        questionId: 'q1',
      },
    ],
    type: 'prompt.request',
  });
  assert.equal(batch.type, 'prompt.request');
  assert.equal(
    WaveTurnEventSchema.parse({
      ...base,
      allowsFreeText: true,
      choices: ['alpha', 'beta'],
      kind: 'clarify',
      multiSelect: true,
      promptId: 'req-multi',
      question: 'Which flavors?',
      type: 'prompt.request',
    }).type,
    'prompt.request',
  );
  const invalid = [
    // A batch replaces the single question and choices.
    {
      allowsFreeText: true,
      choices: ['x'],
      kind: 'clarify',
      promptId: 'req',
      questions: [
        { choices: [], multiSelect: false, question: 'Q', questionId: 'q0' },
      ],
      type: 'prompt.request',
    },
    // Question ids are unique within a batch.
    {
      allowsFreeText: true,
      choices: [],
      kind: 'clarify',
      promptId: 'req',
      questions: [
        { choices: [], multiSelect: false, question: 'Q', questionId: 'q0' },
        { choices: [], multiSelect: false, question: 'R', questionId: 'q0' },
      ],
      type: 'prompt.request',
    },
    // Multi-select needs choices, on the prompt and on each question.
    {
      allowsFreeText: true,
      choices: [],
      kind: 'clarify',
      multiSelect: true,
      promptId: 'req',
      question: 'Q',
      type: 'prompt.request',
    },
    {
      allowsFreeText: true,
      choices: [],
      kind: 'clarify',
      promptId: 'req',
      questions: [
        { choices: [], multiSelect: true, question: 'Q', questionId: 'q0' },
      ],
      type: 'prompt.request',
    },
    // Only clarify prompts batch.
    {
      allowsFreeText: false,
      choices: ['once', 'deny'],
      kind: 'approval',
      promptId: 'req',
      questions: [
        { choices: [], multiSelect: false, question: 'Q', questionId: 'q0' },
      ],
      type: 'prompt.request',
    },
  ];
  for (const event of invalid) {
    assert.equal(
      WaveTurnEventSchema.safeParse({ ...base, ...event }).success,
      false,
    );
  }
});
