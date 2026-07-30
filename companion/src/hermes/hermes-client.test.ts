import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { HttpHermesClient, normalizeHermesBaseUrl } from './hermes-client.ts';
import { HermesClientError } from './hermes-errors.ts';
import type { HermesStreamEvent } from './hermes-types.ts';

const token = 'test-token-that-must-never-appear-in-errors';
const fixtureUrl = new URL('./__fixtures__/capabilities-v2026.7.20.json', import.meta.url);

function createClient(fetch: typeof globalThis.fetch) {
  return new HttpHermesClient(
    {
      baseUrl: 'https://hermes.test/p/default/',
      bearerToken: token,
    },
    { fetch },
  );
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    status,
  });
}

function sseResponse(chunks: string[]) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    }),
    { headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } },
  );
}

async function collect(events: AsyncGenerator<HermesStreamEvent>) {
  const result: HermesStreamEvent[] = [];
  for await (const event of events) {
    result.push(event);
  }
  return result;
}

test('normalizes server-side base URLs and enforces HTTPS by default', () => {
  assert.equal(
    normalizeHermesBaseUrl(' https://hermes.test/p/default/// '),
    'https://hermes.test/p/default',
  );
  assert.equal(
    normalizeHermesBaseUrl('http://127.0.0.1:8642/', { allowInsecureHttp: true }),
    'http://127.0.0.1:8642',
  );
  assert.throws(
    () => normalizeHermesBaseUrl('http://hermes.test'),
    (error: unknown) =>
      error instanceof HermesClientError && error.code === 'insecure_base_url',
  );
});

test('probes and validates the pinned Hermes capability contract', async () => {
  const fixture = await readFile(fixtureUrl, 'utf8');
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    assert.equal(String(input), 'https://hermes.test/p/default/v1/capabilities');
    assert.equal(new Headers(init?.headers).get('Authorization'), `Bearer ${token}`);
    return new Response(fixture, { headers: { 'Content-Type': 'application/json' } });
  };

  const report = await createClient(fetch).probeCapabilities();

  assert.equal(report.supported, true);
  assert.deepEqual(report.missingEndpoints, []);
  assert.deepEqual(report.missingFeatures, []);
  assert.equal(report.capabilities.model, 'hermes-agent');
});

test('creates, lists, and loads normalized session history', async () => {
  const requests: { body?: string; method?: string; url: string }[] = [];
  const responses = [
    jsonResponse(
      {
        object: 'hermes.session',
        session: { id: 'session-1', source: 'api_server', title: 'Wave' },
      },
      201,
    ),
    jsonResponse({
      data: [{ id: 'session-1', message_count: 2, title: 'Wave' }],
      object: 'list',
    }),
    jsonResponse({
      data: [
        { content: 'Hello', id: 'message-1', role: 'user', session_id: 'session-1' },
        {
          content: '',
          id: 'message-2',
          role: 'assistant',
          session_id: 'session-1',
          tool_calls: [
            {
              function: {
                arguments: '{"command":"pwd"}',
                name: 'terminal',
              },
              id: 'call-1',
              type: 'function',
            },
          ],
        },
        {
          content: '/repo',
          id: 'message-3',
          role: 'tool',
          session_id: 'session-1',
          tool_call_id: 'call-1',
          tool_name: 'terminal',
        },
        {
          content: [{ text: 'Hi there', type: 'text' }],
          id: 'message-4',
          role: 'assistant',
          session_id: 'session-1',
        },
      ],
      object: 'list',
      session_id: 'session-1',
    }),
  ];
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({
      body: init?.body as string | undefined,
      method: init?.method,
      url: String(input),
    });
    const response = responses.shift();
    assert.ok(response);
    return response;
  };
  const client = createClient(fetch);

  const created = await client.createSession({ id: 'session-1', title: 'Wave' });
  const sessions = await client.listSessions();
  const messages = await client.getSessionMessages('session-1');

  assert.equal(created.id, 'session-1');
  assert.equal(sessions[0]?.messageCount, 2);
  assert.deepEqual(
    messages.map(({ content, role }) => ({ content, role })),
    [
      { content: 'Hello', role: 'user' },
      { content: '', role: 'assistant' },
      { content: '/repo', role: 'tool' },
      { content: 'Hi there', role: 'assistant' },
    ],
  );
  assert.deepEqual(messages[1]?.toolCalls, [
    {
      arguments: '{"command":"pwd"}',
      id: 'call-1',
      name: 'terminal',
    },
  ]);
  assert.equal(messages[2]?.toolCallId, 'call-1');
  assert.deepEqual(JSON.parse(requests[0]?.body ?? '{}'), { id: 'session-1', title: 'Wave' });
  assert.equal(requests[1]?.url.includes('include_children=false'), true);
});

test('streams normalized assistant and tool lifecycle events across chunks', async () => {
  const fetch = async () =>
    sseResponse([
      ': keepalive\n\n',
      'event: run.started\ndata: {"session_id":"session-1","run_id":"run-1","seq":1,"ts":1}\n\n',
      'event: message.started\ndata: {"session_id":"session-1","run_id":"run-1","seq":2,',
      '"ts":2,"message":{"id":"message-1","role":"assistant"}}\n\n',
      'event: tool.started\ndata: {"session_id":"session-1","run_id":"run-1","seq":3,"ts":3,',
      '"message_id":"message-1","tool_name":"terminal","args":{"command":"pwd"}}\n\n',
      'event: tool.completed\ndata: {"session_id":"session-1","run_id":"run-1","seq":4,"ts":4,',
      '"message_id":"message-1","tool_name":"terminal","preview":"/repo"}\n\n',
      'event: assistant.delta\ndata: {"session_id":"session-1","run_id":"run-1","seq":5,"ts":5,',
      '"message_id":"message-1","delta":"Done"}\n\n',
      'event: run.completed\ndata: {"session_id":"session-1","run_id":"run-1","seq":6,"ts":6,',
      '"message_id":"message-1","completed":true,"messages":[{"content":"hidden"}]}\n\n',
      'event: done\ndata: {"session_id":"session-1","run_id":"run-1","seq":7,"ts":7}\n\n',
    ]);

  const events = await collect(
    createClient(fetch).streamChat('session-1', { input: 'Help me' }),
  );

  assert.deepEqual(events, [
    {
      runId: 'run-1',
      sequence: 1,
      sessionId: 'session-1',
      timestamp: 1,
      type: 'run.started',
    },
    {
      messageId: 'message-1',
      runId: 'run-1',
      sequence: 2,
      sessionId: 'session-1',
      timestamp: 2,
      type: 'message.started',
    },
    {
      messageId: 'message-1',
      runId: 'run-1',
      sequence: 3,
      sessionId: 'session-1',
      status: 'started',
      timestamp: 3,
      toolInput: '{"command":"pwd"}',
      toolName: 'terminal',
      type: 'tool',
    },
    {
      messageId: 'message-1',
      runId: 'run-1',
      sequence: 4,
      sessionId: 'session-1',
      status: 'completed',
      timestamp: 4,
      toolName: 'terminal',
      toolOutput: '/repo',
      toolOutputIsPreview: true,
      type: 'tool',
    },
    {
      delta: 'Done',
      messageId: 'message-1',
      runId: 'run-1',
      sequence: 5,
      sessionId: 'session-1',
      timestamp: 5,
      type: 'assistant.delta',
    },
    {
      completed: true,
      messageId: 'message-1',
      runId: 'run-1',
      sequence: 6,
      sessionId: 'session-1',
      timestamp: 6,
      type: 'run.completed',
    },
    {
      runId: 'run-1',
      sequence: 7,
      sessionId: 'session-1',
      timestamp: 7,
      type: 'done',
    },
  ]);
  assert.equal(JSON.stringify(events).includes('run.completed'), true);
});

test('normalizes authentication and server errors without exposing the bearer token', async () => {
  const authenticationClient = createClient(async () =>
    jsonResponse(
      {
        error: {
          code: 'invalid_api_key',
          message: `Invalid Authorization: Bearer ${token}`,
        },
      },
      401,
    ),
  );
  const serverClient = createClient(async () =>
    jsonResponse({ error: { code: 'server_error', message: 'Hermes unavailable' } }, 503),
  );

  await assert.rejects(
    authenticationClient.probeCapabilities(),
    (error: unknown) =>
      error instanceof HermesClientError &&
      error.kind === 'authentication' &&
      error.code === 'invalid_api_key' &&
      !error.message.includes(token),
  );
  await assert.rejects(
    serverClient.probeCapabilities(),
    (error: unknown) =>
      error instanceof HermesClientError && error.kind === 'server' && error.retryable,
  );
});

test('maps caller aborts to cancellation', async () => {
  const fetch = (_input: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener(
        'abort',
        () => reject(new DOMException('Aborted', 'AbortError')),
        { once: true },
      );
    });
  const controller = new AbortController();
  const nextEvent = createClient(fetch)
    .streamChat('session-1', { input: 'Wait', signal: controller.signal })
    .next();

  controller.abort();

  await assert.rejects(
    nextEvent,
    (error: unknown) => error instanceof HermesClientError && error.kind === 'cancelled',
  );
});

test('cancels the upstream response when a stream consumer exits early', async () => {
  const encoder = new TextEncoder();
  let cancelled = false;
  const fetch = async () =>
    new Response(
      new ReadableStream<Uint8Array>({
        cancel() {
          cancelled = true;
        },
        start(controller) {
          controller.enqueue(
            encoder.encode(
              'event: run.started\ndata: {"session_id":"session-1","run_id":"run-1","seq":1,"ts":1}\n\n',
            ),
          );
        },
      }),
      { headers: { 'Content-Type': 'text/event-stream' } },
    );
  const stream = createClient(fetch).streamChat('session-1', {
    input: 'Wait',
  });

  assert.equal((await stream.next()).value?.type, 'run.started');
  await stream.return(undefined);

  assert.equal(cancelled, true);
});

test('rejects unknown and truncated event streams', async () => {
  const unknownClient = createClient(async () =>
    sseResponse([
      'event: future.event\ndata: {"session_id":"session-1","run_id":"run-1","seq":1,"ts":1}\n\n',
    ]),
  );
  const truncatedClient = createClient(async () =>
    sseResponse([
      'event: assistant.delta\ndata: {"session_id":"session-1","run_id":"run-1","seq":1,"ts":1,',
      '"message_id":"message-1","delta":"partial"}',
    ]),
  );

  await assert.rejects(
    collect(unknownClient.streamChat('session-1', { input: 'Hello' })),
    (error: unknown) =>
      error instanceof HermesClientError && error.code === 'unknown_stream_event',
  );
  await assert.rejects(
    collect(truncatedClient.streamChat('session-1', { input: 'Hello' })),
    (error: unknown) =>
      error instanceof HermesClientError && error.code === 'truncated_sse_stream',
  );
});
