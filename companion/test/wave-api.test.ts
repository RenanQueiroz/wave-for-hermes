import assert from 'node:assert/strict';
import test from 'node:test';

import {
  WaveCancelTurnResponseSchema,
  WaveCompatibilityResponseSchema,
  WaveDeleteSessionResponseSchema,
  WaveDiagnosticsResponseSchema,
  WaveErrorResponseSchema,
  WaveRedeemPairingResponseSchema,
  WaveSessionHistoryResponseSchema,
  WaveSessionListResponseSchema,
  WaveSessionResponseSchema,
  WaveScheduledJobListResponseSchema,
  WaveTimelineResponseSchema,
  WaveTurnEventSchema,
} from '@wave/contracts';

import { buildCompanionServer } from '../src/app.ts';
import { SqliteDeviceStore } from '../src/auth/sqlite-device-store.ts';
import type { CompanionConfig } from '../src/config.ts';
import { HermesClientError } from '../src/hermes/hermes-errors.ts';
import type {
  HermesCapabilityReport,
  HermesClient,
  HermesConversationMessage,
  HermesCreateSessionInput,
  HermesListSessionsOptions,
  HermesRequestOptions,
  HermesSessionPage,
  HermesSessionSummary,
  HermesStreamChatInput,
  HermesStreamEvent,
} from '../src/hermes/hermes-types.ts';

const NOW = new Date('2026-07-30T02:00:00.000Z');
const config: CompanionConfig = {
  databasePath: ':memory:',
  hermes: {
    baseUrl: 'https://hermes.example.test',
    bearerToken: 'server-only-hermes-key',
  },
  hermesFirstEventTimeoutMs: 30,
  hermesIdleTimeoutMs: 30,
  hermesTotalTimeoutMs: 300,
  host: '127.0.0.1',
  maxActiveRealtimeCalls: 2,
  maxActiveTurns: 4,
  pairingCodeTtlSeconds: 600,
  port: 8787,
  realtimeCallTtlMs: 1_800_000,
  realtimeToolTimeoutMs: 120_000,
};

class FakeHermesClient implements HermesClient {
  capabilityCalls = 0;
  createCalls = 0;
  historyCalls = 0;
  listCalls = 0;
  sessions: HermesSessionSummary[] = [
    {
      id: 'existing-session',
      messageCount: 1,
      preview: 'Existing conversation',
      startedAt: 1_785_370_000,
      title: 'Existing',
    },
  ];
  stream:
    | ((
        sessionId: string,
        input: HermesStreamChatInput,
      ) => AsyncGenerator<HermesStreamEvent>)
    | undefined;

  async createSession(
    input: HermesCreateSessionInput = {},
  ): Promise<HermesSessionSummary> {
    this.createCalls += 1;
    const session = {
      id: `created-${this.createCalls}`,
      messageCount: 0,
      title: input.title ?? 'Untitled',
    };
    this.sessions.push(session);
    return session;
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    const index = this.sessions.findIndex(
      (session) => session.id === sessionId,
    );
    if (index < 0) return false;
    this.sessions.splice(index, 1);
    return true;
  }

  async getSession(sessionId: string): Promise<HermesSessionSummary> {
    const session = this.sessions.find(
      (candidate) => candidate.id === sessionId,
    );
    if (!session) {
      throw new HermesClientError('Session not found.', {
        kind: 'not_found',
        status: 404,
      });
    }
    return session;
  }

  async getSessionMessages(
    sessionId: string,
    _options: HermesRequestOptions = {},
  ): Promise<HermesConversationMessage[]> {
    await this.getSession(sessionId);
    this.historyCalls += 1;
    return [
      {
        content: 'Hello from Hermes',
        id: 'message-1',
        role: 'assistant',
        sessionId,
        timestamp: 1_785_370_001,
      },
    ];
  }

  async listSessions(
    options: HermesListSessionsOptions = {},
  ): Promise<HermesSessionPage> {
    this.listCalls += 1;
    const limit = options.limit ?? 50;
    const offset = options.offset ?? 0;
    const sessions = this.sessions.slice(offset, offset + limit);
    return {
      hasMore: offset + sessions.length < this.sessions.length,
      limit,
      offset,
      sessions,
    };
  }

  async listScheduledJobs() {
    return [
      {
        createdAt: '2026-07-30T01:00:00-04:00',
        enabled: true,
        id: 'a1b2c3d4e5f6',
        lastStatus: 'success',
        name: 'Morning briefing',
        nextRunAt: '2026-07-31T09:00:00-04:00',
        schedule: '0 9 * * *',
        state: 'scheduled',
      },
    ];
  }

  async probeCapabilities(): Promise<HermesCapabilityReport> {
    this.capabilityCalls += 1;
    return {
      capabilities: {
        auth: {
          required: true,
          type: 'bearer',
        },
        endpoints: {},
        features: {},
        model: 'test',
        object: 'hermes.api_server.capabilities',
        platform: 'hermes-agent',
      },
      missingEndpoints: [],
      missingFeatures: [],
      supported: true,
    };
  }

  async stopRun() {}

  streamChat(
    sessionId: string,
    input: HermesStreamChatInput,
  ): AsyncGenerator<HermesStreamEvent> {
    if (this.stream) {
      return this.stream(sessionId, input);
    }
    return completedHermesStream(sessionId);
  }

  async updateSession(
    sessionId: string,
    input: { title: string },
  ): Promise<HermesSessionSummary> {
    const session = await this.getSession(sessionId);
    session.title = input.title;
    return session;
  }
}

test('redeems a one-time code without exposing upstream credentials', async () => {
  const context = createContext();
  const pairing = context.store.issuePairingCode(
    new Date('2026-07-30T02:10:00.000Z'),
  );

  const response = await context.app.inject({
    method: 'POST',
    payload: {
      code: pairing.code,
      deviceName: 'Renan’s iPhone',
    },
    url: '/v1/pairings/redeem',
  });
  assert.equal(response.statusCode, 201);
  const paired = WaveRedeemPairingResponseSchema.parse(response.json());
  assert.equal(paired.device.name, 'Renan’s iPhone');
  assert.equal(response.body.includes('server-only-hermes-key'), false);

  const reused = await context.app.inject({
    method: 'POST',
    payload: {
      code: pairing.code,
      deviceName: 'Second device',
    },
    url: '/v1/pairings/redeem',
  });
  assert.equal(reused.statusCode, 401);
  assert.equal(
    WaveErrorResponseSchema.parse(reused.json()).error.code,
    'unauthorized',
  );
  await closeContext(context);
});

test('authenticates compatibility checks and never reaches Hermes for invalid credentials', async () => {
  const context = createContext();
  const paired = pairDevice(context.store, 'Authorized device');

  const missing = await context.app.inject({
    method: 'GET',
    url: '/v1/compatibility',
  });
  const invalid = await context.app.inject({
    headers: {
      authorization: 'Bearer invalid',
    },
    method: 'GET',
    url: '/v1/compatibility',
  });
  assert.equal(missing.statusCode, 401);
  assert.equal(invalid.statusCode, 401);
  assert.equal(context.hermes.capabilityCalls, 0);

  const valid = await context.app.inject({
    headers: authorizationHeader(paired.credential),
    method: 'GET',
    url: '/v1/compatibility',
  });
  assert.equal(valid.statusCode, 200);
  assert.equal(
    WaveCompatibilityResponseSchema.parse(valid.json()).compatible,
    true,
  );
  assert.equal(context.hermes.capabilityCalls, 1);

  context.store.revokeDevice(paired.device.id);
  const revoked = await context.app.inject({
    headers: authorizationHeader(paired.credential),
    method: 'GET',
    url: '/v1/compatibility',
  });
  assert.equal(revoked.statusCode, 401);
  assert.equal(context.hermes.capabilityCalls, 1);
  await closeContext(context);
});

test('returns authenticated content-free diagnostics even when Hermes is unreachable', async () => {
  const context = createContext();
  const paired = pairDevice(context.store, 'Support device');

  const unauthorized = await context.app.inject({
    method: 'GET',
    url: '/v1/diagnostics',
  });
  assert.equal(unauthorized.statusCode, 401);

  const available = await context.app.inject({
    headers: authorizationHeader(paired.credential),
    method: 'GET',
    url: '/v1/diagnostics',
  });
  assert.equal(available.statusCode, 200);
  const diagnostics = WaveDiagnosticsResponseSchema.parse(available.json());
  assert.equal(diagnostics.hermes.status, 'compatible');
  assert.equal(diagnostics.generatedAt, NOW.toISOString());
  assert.equal(diagnostics.companion.serviceVersion, '0.1.0');
  assert.equal(Number.isInteger(diagnostics.companion.uptimeSeconds), true);
  assert.equal(available.body.includes('server-only-hermes-key'), false);
  assert.equal(available.body.includes('Hello from Hermes'), false);

  context.hermes.probeCapabilities = async () => {
    throw new HermesClientError('Sensitive upstream failure.', {
      kind: 'server',
      status: 503,
    });
  };
  const unavailable = await context.app.inject({
    headers: authorizationHeader(paired.credential),
    method: 'GET',
    url: '/v1/diagnostics',
  });
  assert.equal(unavailable.statusCode, 200);
  assert.deepEqual(
    WaveDiagnosticsResponseSchema.parse(unavailable.json()).hermes,
    {
      status: 'unreachable',
    },
  );
  assert.equal(unavailable.body.includes('Sensitive upstream failure'), false);

  await closeContext(context);
});

test('exposes canonical Hermes sessions to every paired device', async () => {
  const context = createContext();
  const first = pairDevice(context.store, 'First device');
  const second = pairDevice(context.store, 'Second device');

  const listed = await context.app.inject({
    headers: authorizationHeader(first.credential),
    method: 'GET',
    url: '/v1/sessions?limit=1&offset=0',
  });
  assert.equal(listed.statusCode, 200);
  const firstPage = WaveSessionListResponseSchema.parse(listed.json());
  assert.equal(firstPage.sessions[0]?.id, 'existing-session');
  assert.equal(firstPage.limit, 1);
  assert.equal(firstPage.offset, 0);
  assert.equal(firstPage.hasMore, false);
  assert.equal(
    (
      await context.app.inject({
        headers: authorizationHeader(second.credential),
        method: 'GET',
        url: '/v1/sessions',
      })
    ).json().sessions[0]?.id,
    'existing-session',
  );

  const created = await context.app.inject({
    headers: authorizationHeader(first.credential),
    method: 'POST',
    url: '/v1/sessions',
  });
  assert.equal(created.statusCode, 201);
  const createdSession = WaveSessionResponseSchema.parse(
    created.json(),
  ).session;

  const history = await context.app.inject({
    headers: authorizationHeader(first.credential),
    method: 'GET',
    url: `/v1/sessions/${createdSession.id}/messages`,
  });
  assert.equal(history.statusCode, 200);
  assert.equal(
    WaveSessionHistoryResponseSchema.parse(history.json()).messages[0]?.content,
    'Hello from Hermes',
  );

  const crossDevice = await context.app.inject({
    headers: authorizationHeader(second.credential),
    method: 'GET',
    url: `/v1/sessions/${createdSession.id}/messages`,
  });
  assert.equal(crossDevice.statusCode, 200);
  assert.equal(context.hermes.historyCalls, 2);

  const realtimeTurnId = context.store.beginRealtimeTurn({
    createdAt: NOW.toISOString(),
    eventKey: 'd'.repeat(64),
    sessionId: createdSession.id,
  });
  context.store.recordUserTranscript({
    transcript: 'Hello over live voice',
    turnId: realtimeTurnId,
    updatedAt: NOW.toISOString(),
  });
  const timelineResponse = await context.app.inject({
    headers: authorizationHeader(first.credential),
    method: 'GET',
    url: `/v1/sessions/${createdSession.id}/timeline?limit=1`,
  });
  assert.equal(timelineResponse.statusCode, 200);
  const timeline = WaveTimelineResponseSchema.parse(timelineResponse.json());
  assert.equal(timeline.entries.length, 1);
  assert.equal(timeline.hasMore, true);
  assert.equal(
    timeline.entries[0]?.type === 'message' &&
      timeline.entries[0].message.content,
    'Hello over live voice',
  );
  assert.ok(timeline.nextCursor);
  const olderTimelineResponse = await context.app.inject({
    headers: authorizationHeader(first.credential),
    method: 'GET',
    url: `/v1/sessions/${createdSession.id}/timeline?limit=1&before=${timeline.nextCursor}`,
  });
  const olderTimeline = WaveTimelineResponseSchema.parse(
    olderTimelineResponse.json(),
  );
  assert.equal(olderTimeline.entries.length, 1);
  assert.equal(olderTimeline.hasMore, false);
  assert.equal(
    olderTimeline.entries[0]?.type === 'message' &&
      olderTimeline.entries[0].message.content,
    'Hello from Hermes',
  );

  const renamed = await context.app.inject({
    headers: authorizationHeader(second.credential),
    method: 'PATCH',
    payload: { title: 'Renamed from Wave' },
    url: `/v1/sessions/${createdSession.id}`,
  });
  assert.equal(renamed.statusCode, 200);
  assert.equal(
    WaveSessionResponseSchema.parse(renamed.json()).session.title,
    'Renamed from Wave',
  );

  const deleted = await context.app.inject({
    headers: authorizationHeader(first.credential),
    method: 'DELETE',
    url: `/v1/sessions/${createdSession.id}`,
  });
  assert.equal(deleted.statusCode, 200);
  assert.equal(
    WaveDeleteSessionResponseSchema.parse(deleted.json()).deleted,
    true,
  );
  assert.deepEqual(context.store.listSessionTurns(createdSession.id), []);
  await closeContext(context);
});

test('paginates a long mixed timeline without gaps or duplicate entries', async () => {
  const context = createContext();
  const paired = pairDevice(context.store, 'Long timeline device');
  const transcriptCount = 225;

  for (let index = 0; index < transcriptCount; index += 1) {
    const timestamp = new Date(NOW.getTime() + index * 1_000).toISOString();
    const turnId = context.store.beginRealtimeTurn({
      createdAt: timestamp,
      eventKey: (index + 1).toString(16).padStart(64, '0'),
      sessionId: 'existing-session',
    });
    context.store.recordUserTranscript({
      transcript: `Voice transcript ${index + 1}`,
      turnId,
      updatedAt: timestamp,
    });
  }

  const entryIds: string[] = [];
  let before: string | undefined;
  let pageCount = 0;
  do {
    const search = new URLSearchParams({ limit: '37' });
    if (before) search.set('before', before);
    const response = await context.app.inject({
      headers: authorizationHeader(paired.credential),
      method: 'GET',
      url: `/v1/sessions/existing-session/timeline?${search}`,
    });
    assert.equal(response.statusCode, 200);
    const page = WaveTimelineResponseSchema.parse(response.json());
    pageCount += 1;
    entryIds.push(...page.entries.map((entry) => entry.id));
    before = page.hasMore ? page.nextCursor : undefined;
    if (page.hasMore) assert.ok(before);
  } while (before);

  assert.equal(pageCount, 7);
  assert.equal(entryIds.length, transcriptCount + 1);
  assert.equal(new Set(entryIds).size, entryIds.length);

  await closeContext(context);
});

test('exposes only normalized read-only Hermes scheduled job status', async () => {
  const context = createContext();
  const paired = pairDevice(context.store, 'Operations device');

  const response = await context.app.inject({
    headers: authorizationHeader(paired.credential),
    method: 'GET',
    url: '/v1/operations/jobs',
  });

  assert.equal(response.statusCode, 200);
  const jobs = WaveScheduledJobListResponseSchema.parse(response.json());
  assert.deepEqual(jobs.jobs, [
    {
      createdAt: '2026-07-30T05:00:00.000Z',
      enabled: true,
      id: 'a1b2c3d4e5f6',
      lastStatus: 'success',
      name: 'Morning briefing',
      nextRunAt: '2026-07-31T13:00:00.000Z',
      schedule: '0 9 * * *',
      state: 'scheduled',
    },
  ]);
  assert.equal(response.body.includes('prompt'), false);
  await closeContext(context);
});

test('pairs and bounds raw Hermes tool details without exposing call identifiers', async () => {
  const context = createContext();
  const paired = pairDevice(context.store, 'Tool detail device');
  context.hermes.getSessionMessages = async (sessionId) => [
    {
      content: '',
      id: 'assistant-tool-call',
      role: 'assistant',
      sessionId,
      toolCalls: [
        {
          arguments: 'i'.repeat(70_000),
          id: 'upstream-call-id-must-not-cross',
          name: 'terminal',
        },
      ],
    },
    {
      content: 'o'.repeat(70_000),
      id: 'tool-result',
      role: 'tool',
      sessionId,
      toolCallId: 'upstream-call-id-must-not-cross',
      toolName: 'terminal',
    },
  ];

  const response = await context.app.inject({
    headers: authorizationHeader(paired.credential),
    method: 'GET',
    url: '/v1/sessions/existing-session/messages',
  });
  assert.equal(response.statusCode, 200);
  const history = WaveSessionHistoryResponseSchema.parse(response.json());
  const tool = history.messages[1];
  assert.equal(tool?.content, '');
  assert.equal(tool?.toolInput?.text.length, 64_000);
  assert.equal(tool?.toolInput?.truncated, true);
  assert.equal(tool?.toolOutput?.text.length, 64_000);
  assert.equal(tool?.toolOutput?.truncated, true);
  assert.equal(
    response.body.includes('upstream-call-id-must-not-cross'),
    false,
  );
  await closeContext(context);
});

test('rejects unknown request fields before creating a Hermes session', async () => {
  const context = createContext();
  const paired = pairDevice(context.store, 'Schema device');
  const response = await context.app.inject({
    headers: authorizationHeader(paired.credential),
    method: 'POST',
    payload: {
      model: 'model-selected-by-client',
      title: 'Invalid',
    },
    url: '/v1/sessions',
  });

  assert.equal(response.statusCode, 400);
  assert.equal(
    WaveErrorResponseSchema.parse(response.json()).error.code,
    'bad_request',
  );
  assert.equal(context.hermes.createCalls, 0);
  await closeContext(context);
});

test('rejects the removed import route, invalid turns, and oversized bodies at the Wave boundary', async () => {
  const context = createContext();
  const paired = pairDevice(context.store, 'Boundary device');
  const removedImport = await context.app.inject({
    headers: authorizationHeader(paired.credential),
    method: 'POST',
    payload: {
      includeAdministrativeSessions: true,
    },
    url: '/v1/sessions/import',
  });
  assert.equal(removedImport.statusCode, 404);
  assert.equal(context.hermes.listCalls, 0);

  const invalidTurn = await context.app.inject({
    headers: authorizationHeader(paired.credential),
    method: 'POST',
    payload: {
      input: 'x'.repeat(70_000),
    },
    url: '/v1/sessions/existing-session/turns',
  });
  assert.equal(invalidTurn.statusCode, 400);

  const oversized = await context.app.inject({
    headers: authorizationHeader(paired.credential),
    method: 'POST',
    payload: {
      input: 'x'.repeat(6_000_000),
    },
    url: '/v1/sessions/existing-session/turns',
  });
  assert.equal(oversized.statusCode, 413);
  assert.equal(
    WaveErrorResponseSchema.parse(oversized.json()).error.code,
    'bad_request',
  );
  await closeContext(context);
});

test('validates attachments and maps them to the pinned Hermes multimodal contract', async () => {
  const context = createContext();
  const paired = pairDevice(context.store, 'Attachment device');
  let upstreamInput: HermesStreamChatInput | undefined;
  context.hermes.stream = (sessionId, input) => {
    upstreamInput = input;
    return completedHermesStream(sessionId);
  };
  const imageDataUrl = 'data:image/jpeg;base64,aGVsbG8=';

  const response = await context.app.inject({
    headers: authorizationHeader(paired.credential),
    method: 'POST',
    payload: {
      input: [
        { text: 'Review these', type: 'text' },
        {
          dataUrl: imageDataUrl,
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
    },
    url: '/v1/sessions/existing-session/turns',
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(upstreamInput?.input, [
    { text: 'Review these', type: 'text' },
    { text: '[Attached image: photo.jpg]', type: 'text' },
    {
      image_url: {
        detail: 'auto',
        url: imageDataUrl,
      },
      type: 'image_url',
    },
    {
      text: '[Attached text file: notes.md (text/markdown)]\n\n# Notes',
      type: 'text',
    },
  ]);
  await closeContext(context);
});

test('rate-limits repeated pairing attempts before issuing credentials', async () => {
  const context = createContext();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await context.app.inject({
      method: 'POST',
      payload: {
        code: 'ABCD-EFGH-JKLM-NPQR',
        deviceName: 'Unpaired device',
      },
      url: '/v1/pairings/redeem',
    });
    assert.equal(response.statusCode, 401);
  }

  const limited = await context.app.inject({
    method: 'POST',
    payload: {
      code: 'ABCD-EFGH-JKLM-NPQR',
      deviceName: 'Unpaired device',
    },
    url: '/v1/pairings/redeem',
  });
  assert.equal(limited.statusCode, 429);
  assert.equal(
    WaveErrorResponseSchema.parse(limited.json()).error.code,
    'rate_limited',
  );
  await closeContext(context);
});

test('streams only normalized Wave events with ordered metadata', async () => {
  const context = createContext();
  const paired = pairDevice(context.store, 'Streaming device');

  const response = await context.app.inject({
    headers: authorizationHeader(paired.credential),
    method: 'POST',
    payload: {
      input: 'Do the task',
    },
    url: '/v1/sessions/existing-session/turns',
  });
  assert.equal(response.statusCode, 200);
  assert.match(response.headers['content-type'] ?? '', /^text\/event-stream/);
  const events = parseSseEvents(response.body);
  assert.deepEqual(
    events.map((event) => event.type),
    [
      'turn.started',
      'assistant.started',
      'assistant.delta',
      'tool.status',
      'assistant.completed',
      'turn.completed',
    ],
  );
  assert.deepEqual(
    events.map((event) => event.sequence),
    [0, 1, 2, 3, 4, 5],
  );
  assert.equal(response.body.includes('run-1'), false);
  assert.equal(response.body.includes('server-only-hermes-key'), false);
  const toolEvent = events.find((event) => event.type === 'tool.status');
  assert.equal(
    toolEvent?.type === 'tool.status' ? toolEvent.toolInput?.text : undefined,
    '{"command":"pwd"}',
  );
  assert.equal(
    toolEvent?.type === 'tool.status' ? toolEvent.toolOutput?.text : undefined,
    '/repo',
  );
  await closeContext(context);
});

test('emits a normalized timeout when Hermes sends no first event', async () => {
  const context = createContext();
  const paired = pairDevice(context.store, 'Timeout device');
  context.hermes.stream = silentHermesStream;

  const response = await context.app.inject({
    headers: authorizationHeader(paired.credential),
    method: 'POST',
    payload: {
      input: 'Wait forever',
    },
    url: '/v1/sessions/existing-session/turns',
  });
  const events = parseSseEvents(response.body);
  assert.deepEqual(
    events.map((event) => event.type),
    ['turn.started', 'turn.error'],
  );
  assert.equal(
    events[1]?.type === 'turn.error' ? events[1].error.code : undefined,
    'timeout',
  );
  await closeContext(context);
});

test('cancels an active streamed turn over the authenticated HTTP contract', async () => {
  const context = createContext();
  const paired = pairDevice(context.store, 'Cancelling device');
  context.hermes.stream = waitingHermesStream;
  const address = await context.app.listen({
    host: '127.0.0.1',
    port: 0,
  });

  const streamResponse = await fetch(
    `${address}/v1/sessions/existing-session/turns`,
    {
      body: JSON.stringify({ input: 'Wait for cancellation' }),
      headers: {
        ...authorizationHeader(paired.credential),
        'content-type': 'application/json',
      },
      method: 'POST',
    },
  );
  assert.equal(streamResponse.status, 200);
  assert.ok(streamResponse.body);
  const reader = streamResponse.body.getReader();
  const firstChunk = await reader.read();
  assert.equal(firstChunk.done, false);
  const initialText = new TextDecoder().decode(firstChunk.value);
  const started = parseSseEvents(initialText)[0];
  assert.equal(started?.type, 'turn.started');

  const cancelResponse = await fetch(
    `${address}/v1/sessions/existing-session/turns/${started?.turnId}/cancel`,
    {
      headers: authorizationHeader(paired.credential),
      method: 'POST',
    },
  );
  assert.equal(cancelResponse.status, 202);
  assert.equal(
    WaveCancelTurnResponseSchema.parse(await cancelResponse.json()).status,
    'cancellation_requested',
  );

  let remainingText = '';
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    remainingText += new TextDecoder().decode(chunk.value);
  }
  assert.equal(
    parseSseEvents(remainingText).some(
      (event) =>
        event.type === 'turn.error' && event.error.code === 'cancelled',
    ),
    true,
  );
  await closeContext(context);
});

test('aborts Hermes when the downstream client disconnects', async () => {
  const context = createContext();
  const paired = pairDevice(context.store, 'Disconnecting device');
  let observeDisconnect: (() => void) | undefined;
  const disconnected = new Promise<void>((resolve) => {
    observeDisconnect = resolve;
  });
  context.hermes.stream = async function* (
    sessionId,
    input,
  ): AsyncGenerator<HermesStreamEvent> {
    yield {
      runId: 'run-disconnecting',
      sequence: 0,
      sessionId,
      timestamp: 1_785_370_001,
      type: 'run.started',
    };
    await new Promise<void>((resolve) => {
      const onAbort = () => {
        observeDisconnect?.();
        resolve();
      };
      if (input.signal?.aborted) {
        onAbort();
      } else {
        input.signal?.addEventListener('abort', onAbort, { once: true });
      }
    });
  };
  const address = await context.app.listen({
    host: '127.0.0.1',
    port: 0,
  });
  const response = await fetch(
    `${address}/v1/sessions/existing-session/turns`,
    {
      body: JSON.stringify({ input: 'Disconnect me' }),
      headers: {
        ...authorizationHeader(paired.credential),
        'content-type': 'application/json',
      },
      method: 'POST',
    },
  );
  assert.ok(response.body);
  const reader = response.body.getReader();
  assert.equal((await reader.read()).done, false);

  await reader.cancel();
  let disconnectTimeout: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      disconnected,
      new Promise<never>((_resolve, reject) => {
        disconnectTimeout = setTimeout(
          () => reject(new Error('Hermes did not observe the disconnect.')),
          1_000,
        );
      }),
    ]);
  } finally {
    if (disconnectTimeout) {
      clearTimeout(disconnectTimeout);
    }
  }
  await closeContext(context);
});

test('normalizes an upstream compatibility failure', async () => {
  const context = createContext();
  const paired = pairDevice(context.store, 'Failure device');
  context.hermes.probeCapabilities = async () => {
    throw new HermesClientError('upstream raw error', {
      kind: 'protocol',
    });
  };

  const response = await context.app.inject({
    headers: authorizationHeader(paired.credential),
    method: 'GET',
    url: '/v1/compatibility',
  });
  assert.equal(response.statusCode, 502);
  const failure = WaveErrorResponseSchema.parse(response.json());
  assert.equal(failure.error.code, 'upstream_incompatible');
  assert.equal(response.body.includes('upstream raw error'), false);
  await closeContext(context);
});

function createContext() {
  const store = new SqliteDeviceStore(':memory:', {
    now: () => NOW,
  });
  const hermes = new FakeHermesClient();
  const app = buildCompanionServer(config, {
    deviceStore: store,
    hermesClient: hermes,
    now: () => NOW,
  });
  return { app, hermes, store };
}

async function closeContext(context: ReturnType<typeof createContext>) {
  await context.app.close();
  context.store.close();
}

function pairDevice(store: SqliteDeviceStore, name: string) {
  const pairing = store.issuePairingCode(new Date('2026-07-30T02:10:00.000Z'));
  const paired = store.redeemPairingCode(pairing.code, name);
  assert.ok(paired);
  return paired;
}

function authorizationHeader(credential: string) {
  return {
    authorization: `Bearer ${credential}`,
  };
}

function parseSseEvents(body: string) {
  return body
    .split('\n\n')
    .filter(Boolean)
    .map((block) => {
      const data = block
        .split('\n')
        .find((line) => line.startsWith('data: '))
        ?.slice('data: '.length);
      assert.ok(data);
      return WaveTurnEventSchema.parse(JSON.parse(data));
    });
}

async function* completedHermesStream(
  sessionId: string,
): AsyncGenerator<HermesStreamEvent> {
  const base = {
    runId: 'run-1',
    sequence: 0,
    sessionId,
    timestamp: 1_785_370_001,
  };
  yield {
    ...base,
    messageId: 'assistant-1',
    type: 'message.started',
  };
  yield {
    ...base,
    delta: 'Working',
    messageId: 'assistant-1',
    sequence: 1,
    type: 'assistant.delta',
  };
  yield {
    ...base,
    sequence: 2,
    status: 'started',
    toolInput: '{"command":"pwd"}',
    toolName: 'terminal',
    toolOutput: '/repo',
    toolOutputIsPreview: true,
    type: 'tool',
  };
  yield {
    ...base,
    content: 'Done',
    interrupted: false,
    messageId: 'assistant-1',
    partial: false,
    sequence: 3,
    type: 'assistant.completed',
  };
  yield {
    ...base,
    completed: true,
    messageId: 'assistant-1',
    sequence: 4,
    type: 'run.completed',
  };
  yield {
    ...base,
    sequence: 5,
    type: 'done',
  };
}

async function* waitingHermesStream(
  sessionId: string,
  input: HermesStreamChatInput,
): AsyncGenerator<HermesStreamEvent> {
  yield {
    runId: 'run-waiting',
    sequence: 0,
    sessionId,
    timestamp: 1_785_370_001,
    type: 'run.started',
  };
  await new Promise<void>((_resolve, reject) => {
    const onAbort = () => {
      reject(
        new HermesClientError('Hermes request was cancelled.', {
          kind: 'cancelled',
        }),
      );
    };
    if (input.signal?.aborted) {
      onAbort();
    } else {
      input.signal?.addEventListener('abort', onAbort, { once: true });
    }
  });
}

async function* silentHermesStream(
  _sessionId: string,
  input: HermesStreamChatInput,
): AsyncGenerator<HermesStreamEvent> {
  await new Promise<void>((_resolve, reject) => {
    const onAbort = () => {
      reject(
        new HermesClientError('Hermes request was cancelled.', {
          kind: 'cancelled',
        }),
      );
    };
    if (input.signal?.aborted) {
      onAbort();
    } else {
      input.signal?.addEventListener('abort', onAbort, { once: true });
    }
  });
  if (false) {
    yield {} as HermesStreamEvent;
  }
}
