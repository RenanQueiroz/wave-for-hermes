import assert from 'node:assert/strict';
import test from 'node:test';

import { OpenAiRealtimeSideband } from '../../src/services/realtime/openai-realtime-sideband.ts';

type Listener = (event: { data?: unknown }) => void;

function fakeSocket() {
  const listeners = new Map<string, Set<Listener>>();
  const sent: string[] = [];
  const socket = {
    readyState: 1,
    addEventListener(type: string, listener: Listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    close() {
      socket.readyState = 3;
      emit('close', {});
    },
    removeEventListener(type: string, listener: Listener) {
      listeners.get(type)?.delete(listener);
    },
    send(data: string) {
      sent.push(data);
    },
  };
  const emit = (type: string, event: { data?: unknown }) => {
    for (const listener of listeners.get(type) ?? []) listener(event);
  };
  return {
    emit,
    sent,
    socket: socket as unknown as WebSocket,
    receive(payload: unknown) {
      emit('message', { data: JSON.stringify(payload) });
    },
  };
}

const OK_RESULT = { answer: 'done', ok: true, truncated: false } as const;

test('parses function calls out of completed responses with the user item', () => {
  const { receive, socket } = fakeSocket();
  const sideband = new OpenAiRealtimeSideband(socket);
  const calls: unknown[] = [];
  sideband.onFunctionCall((call) => calls.push(call));

  receive({
    item: { id: 'item-9', role: 'user' },
    type: 'conversation.item.added',
  });
  receive({ response: { id: 'resp-1' }, type: 'response.created' });
  receive({
    response: {
      id: 'resp-1',
      output: [
        {
          arguments: '{"instruction":"list my devices"}',
          call_id: 'tool-1',
          name: 'ask_hermes',
          type: 'function_call',
        },
        { type: 'message' },
      ],
      status: 'completed',
    },
    type: 'response.done',
  });

  assert.deepEqual(calls, [
    {
      arguments: '{"instruction":"list my devices"}',
      callId: 'tool-1',
      name: 'ask_hermes',
      userItemId: 'item-9',
    },
  ]);
});

test('delivers results only when no response or user speech is in progress', () => {
  const { receive, sent, socket } = fakeSocket();
  const sideband = new OpenAiRealtimeSideband(socket);

  // A response is running: the result must queue, not send.
  receive({ response: { id: 'resp-1' }, type: 'response.created' });
  sideband.sendFunctionResult('tool-1', OK_RESULT);
  assert.equal(sent.length, 0);

  // The response finishing flushes the queue: item + response.create.
  receive({ response: { id: 'resp-1' }, type: 'response.done' });
  assert.equal(sent.length, 2);
  assert.match(sent[0]!, /function_call_output/);
  assert.match(sent[1]!, /response\.create/);

  // User speech blocks delivery the same way.
  receive({ response: { id: 'resp-2' }, type: 'response.created' });
  receive({ response: { id: 'resp-2' }, type: 'response.done' });
  receive({ type: 'input_audio_buffer.speech_started' });
  sideband.sendFunctionResult('tool-2', OK_RESULT);
  assert.equal(sent.length, 2);
  receive({ type: 'input_audio_buffer.speech_stopped' });
  assert.equal(sent.length, 4);
});

test('two fast completions cannot race into overlapping responses', () => {
  const { receive, sent, socket } = fakeSocket();
  const sideband = new OpenAiRealtimeSideband(socket);

  sideband.sendFunctionResult('tool-1', OK_RESULT);
  // The first flush marks a response in progress immediately, before any
  // response.created event arrives — so a second result queues.
  sideband.sendFunctionResult('tool-2', OK_RESULT);
  assert.equal(
    sent.filter((entry) => entry.includes('response.create')).length,
    1,
  );
  receive({ response: { id: 'resp-1' }, type: 'response.done' });
  assert.equal(
    sent.filter((entry) => entry.includes('response.create')).length,
    2,
  );
});

test('ignores oversized, binary, and malformed events without dying', () => {
  const { emit, receive, socket } = fakeSocket();
  const sideband = new OpenAiRealtimeSideband(socket);
  const calls: unknown[] = [];
  sideband.onFunctionCall((call) => calls.push(call));

  emit('message', { data: new ArrayBuffer(8) });
  emit('message', { data: 'x'.repeat(70 * 1024) });
  emit('message', { data: 'not json' });
  receive({ noType: true });
  receive({
    response: {
      output: [
        { call_id: 'x'.repeat(300), name: 'ask_hermes', type: 'function_call' },
      ],
    },
    type: 'response.done',
  });
  assert.equal(calls.length, 0);
});
