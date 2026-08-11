import assert from 'node:assert/strict';
import test from 'node:test';

import {
  OpenAiRealtimeVoiceSampler,
  OpenAiRealtimeVoiceSampleError,
  type VoiceSampleSocket,
} from '../../src/services/realtime/openai-realtime-voice-sampler.ts';

test('requests a bounded out-of-band preview and returns playable WAV bytes', async () => {
  const socket = new FakeVoiceSampleSocket();
  const sampler = new OpenAiRealtimeVoiceSampler({
    apiKey: 'unit-test-openai-key',
    model: 'gpt-realtime-2.1-mini',
    socketFactory: (url, apiKey) => {
      const parsedUrl = new URL(url);
      assert.equal(parsedUrl.origin, 'wss://api.openai.com');
      assert.equal(parsedUrl.pathname, '/v1/realtime');
      assert.equal(
        parsedUrl.searchParams.get('model'),
        'gpt-realtime-2.1-mini',
      );
      assert.equal(apiKey, 'unit-test-openai-key');
      assert.doesNotMatch(url, /unit-test-openai-key/);
      return socket;
    },
  });

  const pending = sampler.getSample('cedar');
  socket.emit('open');
  const request = JSON.parse(socket.sent[0] ?? '') as {
    response: {
      audio: { output: { format: { rate: number }; voice: string } };
      conversation: string;
      output_modalities: string[];
    };
    type: string;
  };
  assert.equal(request.type, 'response.create');
  assert.equal(request.response.audio.output.voice, 'cedar');
  assert.equal(request.response.audio.output.format.rate, 24_000);
  assert.equal(request.response.conversation, 'none');
  assert.deepEqual(request.response.output_modalities, ['audio']);

  const pcm = Uint8Array.from([1, 2, 3, 4, 5, 6]);
  socket.receive({
    delta: Buffer.from(pcm.subarray(0, 4)).toString('base64'),
    type: 'response.output_audio.delta',
  });
  socket.receive({
    delta: Buffer.from(pcm.subarray(4)).toString('base64'),
    type: 'response.output_audio.delta',
  });
  socket.receive({ response: { status: 'completed' }, type: 'response.done' });

  const wav = await pending;
  assert.equal(Buffer.from(wav.subarray(0, 4)).toString('ascii'), 'RIFF');
  assert.equal(Buffer.from(wav.subarray(8, 12)).toString('ascii'), 'WAVE');
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  assert.equal(view.getUint32(24, true), 24_000);
  assert.equal(view.getUint32(40, true), pcm.byteLength);
  assert.deepEqual(wav.subarray(44), pcm);
  assert.equal(socket.closed, true);
});

test('aborting a preview closes its connection without exposing provider data', async () => {
  const socket = new FakeVoiceSampleSocket();
  const controller = new AbortController();
  const sampler = new OpenAiRealtimeVoiceSampler({
    apiKey: 'private-test-key',
    model: 'gpt-realtime-2.1',
    socketFactory: () => socket,
  });

  const pending = sampler.getSample('marin', controller.signal);
  socket.emit('open');
  controller.abort();
  await assert.rejects(pending, (error: unknown) => {
    assert.ok(error instanceof OpenAiRealtimeVoiceSampleError);
    assert.equal(error.cancelled, true);
    assert.doesNotMatch(error.message, /private-test-key/);
    return true;
  });
  assert.equal(socket.closed, true);
});

test('rejects malformed, empty, and oversized provider output', async () => {
  await assertSampleFailure((socket) => socket.receive({ type: 'error' }));
  await assertSampleFailure((socket) =>
    socket.receive({
      response: { status: 'completed' },
      type: 'response.done',
    }),
  );
  await assertSampleFailure((socket) =>
    socket.receive({
      delta: Buffer.alloc(600_000).toString('base64'),
      type: 'response.output_audio.delta',
    }),
  );
  await assertSampleFailure((socket) =>
    socket.emit('message', { data: '{not-json' }),
  );
});

async function assertSampleFailure(
  fail: (socket: FakeVoiceSampleSocket) => void,
) {
  const socket = new FakeVoiceSampleSocket();
  const sampler = new OpenAiRealtimeVoiceSampler({
    apiKey: 'unit-test-openai-key',
    model: 'gpt-realtime-2.1-mini',
    socketFactory: () => socket,
  });
  const pending = sampler.getSample('alloy');
  socket.emit('open');
  fail(socket);
  await assert.rejects(pending, OpenAiRealtimeVoiceSampleError);
  assert.equal(socket.closed, true);
}

class FakeVoiceSampleSocket implements VoiceSampleSocket {
  closed = false;
  readonly sent: string[] = [];
  private readonly listeners = new Map<
    string,
    Set<(event: { data?: unknown }) => void>
  >();

  addEventListener(
    event: string,
    listener: (event: { data?: unknown }) => void,
  ) {
    let bucket = this.listeners.get(event);
    if (!bucket) {
      bucket = new Set();
      this.listeners.set(event, bucket);
    }
    bucket.add(listener);
  }

  close() {
    this.closed = true;
  }

  emit(event: string, payload: { data?: unknown } = {}) {
    for (const listener of this.listeners.get(event) ?? []) listener(payload);
  }

  receive(payload: unknown) {
    this.emit('message', { data: JSON.stringify(payload) });
  }

  removeEventListener(
    event: string,
    listener: (event: { data?: unknown }) => void,
  ) {
    this.listeners.get(event)?.delete(listener);
  }

  send(data: string) {
    this.sent.push(data);
  }
}
