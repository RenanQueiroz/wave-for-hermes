import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import OpenAI from 'openai';

import type { OpenAIRealtimeConfig } from '../config.ts';
import { OpenAIRealtimeProvider } from './openai-realtime-provider.ts';

const config: OpenAIRealtimeConfig = {
  apiKey: 'server-only-openai-key',
  model: 'gpt-realtime-2.1-mini',
  requestTimeoutMs: 5_000,
  sidebandConnectTimeoutMs: 1_000,
  voice: 'marin',
};

test('uses the official SDK for unified setup and authenticated sideband control', async () => {
  const sockets: FakeWebSocket[] = [];
  let sidebandHeaders: Record<string, string> | undefined;
  const requests: {
    body: BodyInit | null | undefined;
    headers: Headers;
    url: string;
  }[] = [];

  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: 'https://api.openai.com/v1',
    fetch: async (request, init) => {
      const url = request instanceof Request ? request.url : request.toString();
      const headers = new Headers(init?.headers);
      requests.push({
        body: init?.body,
        headers,
        url,
      });
      if (url.endsWith('/realtime/calls')) {
        return new Response('v=0\r\no=- 2 3 IN IP4 127.0.0.1\r\n', {
          headers: {
            'content-type': 'text/plain; charset=utf-8',
            location: '/v1/realtime/calls/rtc_test_call',
          },
          status: 201,
        });
      }
      if (url.endsWith('/realtime/calls/rtc_test_call/hangup')) {
        return new Response(null, { status: 200 });
      }
      return new Response(null, { status: 404 });
    },
    logLevel: 'off',
    maxRetries: 0,
  });
  const provider = new OpenAIRealtimeProvider(config, {
    client,
    sidebandSocketFactory: ({ headers, url }) => {
      sidebandHeaders = headers;
      const socket = new FakeWebSocket(url);
      sockets.push(socket);
      return socket;
    },
  });
  const call = await provider.createCall({
    safetyIdentifier: 'a'.repeat(64),
    sdpOffer: 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n',
  });

  assert.equal(call.sdpAnswer.startsWith('v=0'), true);
  assert.equal(requests.length, 1);
  assert.equal(
    requests[0]?.headers.get('authorization'),
    `Bearer ${config.apiKey}`,
  );
  assert.equal(
    requests[0]?.headers.get('openai-safety-identifier'),
    'a'.repeat(64),
  );
  assert.ok(requests[0]?.body instanceof FormData);
  const form = requests[0]?.body as FormData;
  assert.equal(form.get('sdp'), 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n');
  const sessionPart = form.get('session');
  assert.equal(typeof sessionPart, 'string');
  const session = JSON.parse(sessionPart as string) as {
    instructions: string;
    model: string;
    parallel_tool_calls: boolean;
    tools: {
      name: string;
      parameters: {
        additionalProperties: boolean;
        required: string[];
      };
    }[];
    tracing: unknown;
    type: string;
  };
  assert.equal(session.type, 'realtime');
  assert.equal(session.model, 'gpt-realtime-2.1-mini');
  assert.equal(session.parallel_tool_calls, true);
  assert.equal(session.tools.length, 1);
  assert.equal(session.tools[0]?.name, 'ask_hermes');
  assert.equal(session.tools[0]?.parameters.additionalProperties, false);
  assert.deepEqual(session.tools[0]?.parameters.required, ['instruction']);
  assert.equal(session.tracing, null);
  assert.equal(JSON.stringify(session).includes('sessionId'), false);
  assert.equal(
    session.instructions.includes('Hermes requests continue in the background'),
    true,
  );
  assert.equal(
    session.instructions.includes(
      'call ask_hermes for the new request immediately',
    ),
    true,
  );
  assert.equal(
    session.instructions.includes(
      'claim that another Hermes request cannot be queued',
    ),
    true,
  );
  assert.equal(
    session.instructions.includes('quoted or exact wording verbatim'),
    true,
  );
  assert.equal(
    session.instructions.includes('do not retry an identical instruction'),
    true,
  );

  assert.equal(sockets.length, 1);
  assert.equal(
    sockets[0]?.url,
    'wss://api.openai.com/v1/realtime?call_id=rtc_test_call',
  );
  assert.equal(sockets[0]?.url.includes(config.apiKey), false);
  assert.equal(sidebandHeaders?.Authorization, `Bearer ${config.apiKey}`);

  let receivedToolCall:
    { arguments: string; callId: string; name: string } | undefined;
  call.sideband.onFunctionCall((toolCall) => {
    receivedToolCall = toolCall;
  });
  sockets[0]?.emitMessage({
    response: {
      output: [
        {
          arguments: '{"instruction":"Check Hermes"}',
          call_id: 'tool-call-1',
          name: 'ask_hermes',
          type: 'function_call',
        },
      ],
    },
    type: 'response.done',
  });
  assert.deepEqual(receivedToolCall, {
    arguments: '{"instruction":"Check Hermes"}',
    callId: 'tool-call-1',
    name: 'ask_hermes',
  });

  assert.equal(
    call.sideband.sendFunctionResult('tool-call-1', {
      answer: 'Hermes completed the request.',
      ok: true,
      truncated: false,
    }),
    true,
  );
  assert.deepEqual(
    sockets[0]?.sent.map((message) => JSON.parse(message).type),
    ['conversation.item.create', 'response.create'],
  );
  const outputEvent = JSON.parse(sockets[0]?.sent[0] ?? '{}') as {
    item?: {
      call_id?: string;
      output?: string;
      type?: string;
    };
  };
  assert.equal(outputEvent.item?.type, 'function_call_output');
  assert.equal(outputEvent.item?.call_id, 'tool-call-1');
  assert.deepEqual(JSON.parse(outputEvent.item?.output ?? '{}'), {
    answer: 'Hermes completed the request.',
    ok: true,
    truncated: false,
  });

  sockets[0]?.emitMessage({
    response: { output: [] },
    type: 'response.created',
  });
  const sentBeforeDeferredResult = sockets[0]?.sent.length ?? 0;
  assert.equal(
    call.sideband.sendFunctionResult('tool-call-2', {
      answer: 'Second Hermes result.',
      ok: true,
      truncated: false,
    }),
    true,
  );
  assert.equal(sockets[0]?.sent.length, sentBeforeDeferredResult);

  sockets[0]?.emitMessage({
    response: { output: [] },
    type: 'response.done',
  });
  assert.deepEqual(
    sockets[0]?.sent
      .slice(sentBeforeDeferredResult)
      .map((message) => JSON.parse(message).type),
    ['conversation.item.create', 'response.create'],
  );

  sockets[0]?.emitMessage({
    response: { output: [] },
    type: 'response.created',
  });
  sockets[0]?.emitMessage({
    type: 'input_audio_buffer.speech_started',
  });
  const sentBeforeUserFollowUp = sockets[0]?.sent.length ?? 0;
  assert.equal(
    call.sideband.sendFunctionResult('tool-call-3', {
      answer: 'Result completed during a follow-up.',
      ok: true,
      truncated: false,
    }),
    true,
  );
  sockets[0]?.emitMessage({
    response: { output: [] },
    type: 'response.done',
  });
  sockets[0]?.emitMessage({
    type: 'input_audio_buffer.speech_stopped',
  });
  assert.equal(sockets[0]?.sent.length, sentBeforeUserFollowUp);

  sockets[0]?.emitMessage({
    response: { output: [] },
    type: 'response.created',
  });
  sockets[0]?.emitMessage({
    response: { output: [] },
    type: 'response.done',
  });
  assert.deepEqual(
    sockets[0]?.sent
      .slice(sentBeforeUserFollowUp)
      .map((message) => JSON.parse(message).type),
    ['conversation.item.create', 'response.create'],
  );

  await call.end();
  assert.equal(requests.length, 2);
  assert.equal(
    requests[1]?.url.endsWith('/realtime/calls/rtc_test_call/hangup'),
    true,
  );
});

class FakeWebSocket extends EventEmitter {
  static readonly CLOSED = 3;
  static readonly CLOSING = 2;
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;

  readonly sent: string[] = [];
  readonly url: string;
  readyState = FakeWebSocket.CONNECTING;

  constructor(url: string | URL) {
    super();
    this.url = url.toString();
    queueMicrotask(() => {
      if (this.readyState === FakeWebSocket.CONNECTING) {
        this.readyState = FakeWebSocket.OPEN;
        this.emit('open');
      }
    });
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED;
    this.emit('close');
  }

  emitMessage(value: unknown) {
    this.emit('message', Buffer.from(JSON.stringify(value)), false);
  }

  send(message: string) {
    this.sent.push(message);
  }
}
