import assert from 'node:assert/strict';
import test from 'node:test';

import type { OpenAIRealtimeConfig } from '../config.ts';
import { RealtimeProviderError } from './realtime-provider.ts';
import {
  RealtimeVoiceSampler,
  type SampleSocket,
} from './realtime-voice-sampler.ts';

const config: OpenAIRealtimeConfig = {
  apiKey: 'server-only-openai-key',
  model: 'gpt-realtime-2.1-mini',
  requestTimeoutMs: 10_000,
  sidebandConnectTimeoutMs: 10_000,
  voice: 'marin',
};

async function flushQueue() {
  await new Promise((resolve) => setImmediate(resolve));
}

test('generates a bounded WAV sample once per voice and caches it', async () => {
  const sockets: FakeSampleSocket[] = [];
  const sampler = new RealtimeVoiceSampler(config, {
    socketFactory: (input) => {
      assert.equal(input.url.searchParams.get('model'), config.model);
      assert.equal(input.headers.Authorization, `Bearer ${config.apiKey}`);
      const socket = new FakeSampleSocket();
      sockets.push(socket);
      return socket;
    },
  });

  const pending = sampler.getSample('cedar');
  await flushQueue();
  const socket = sockets[0];
  assert.ok(socket);
  socket.emit('open');
  const sent = JSON.parse(socket.sent[0] ?? '') as {
    response: {
      audio: { output: { voice: string } };
      conversation: string;
      output_modalities: string[];
    };
    type: string;
  };
  assert.equal(sent.type, 'response.create');
  assert.equal(sent.response.audio.output.voice, 'cedar');
  assert.equal(sent.response.conversation, 'none');
  assert.deepEqual(sent.response.output_modalities, ['audio']);

  const pcm = Buffer.from([1, 2, 3, 4, 5, 6]);
  socket.emit(
    'message',
    JSON.stringify({
      delta: pcm.subarray(0, 4).toString('base64'),
      type: 'response.output_audio.delta',
    }),
    false,
  );
  socket.emit(
    'message',
    JSON.stringify({
      delta: pcm.subarray(4).toString('base64'),
      type: 'response.output_audio.delta',
    }),
    false,
  );
  socket.emit(
    'message',
    JSON.stringify({
      response: { status: 'completed' },
      type: 'response.done',
    }),
    false,
  );

  const wav = await pending;
  assert.equal(wav.subarray(0, 4).toString('ascii'), 'RIFF');
  assert.equal(wav.subarray(8, 12).toString('ascii'), 'WAVE');
  assert.equal(wav.readUInt32LE(24), 24_000);
  assert.equal(wav.readUInt32LE(40), pcm.byteLength);
  assert.deepEqual(wav.subarray(44), pcm);
  assert.equal(socket.closed, true);

  assert.equal(await sampler.getSample('cedar'), wav);
  assert.equal(sockets.length, 1);
  assert.equal(sampler.samplesVersion.length, 16);
});

test('fails on provider errors and retries with a fresh connection', async () => {
  const sockets: FakeSampleSocket[] = [];
  const sampler = new RealtimeVoiceSampler(config, {
    socketFactory: () => {
      const socket = new FakeSampleSocket();
      sockets.push(socket);
      return socket;
    },
  });

  const failing = sampler.getSample('alloy');
  await flushQueue();
  sockets[0]?.emit('open');
  sockets[0]?.emit('message', JSON.stringify({ type: 'error' }), false);
  await assert.rejects(failing, (error: unknown) => {
    assert.ok(error instanceof RealtimeProviderError);
    assert.equal(error.kind, 'unavailable');
    return true;
  });

  const retried = sampler.getSample('alloy');
  await flushQueue();
  assert.equal(sockets.length, 2);
  sockets[1]?.emit('open');
  sockets[1]?.emit(
    'message',
    JSON.stringify({
      delta: Buffer.from([9, 9]).toString('base64'),
      type: 'response.output_audio.delta',
    }),
    false,
  );
  sockets[1]?.emit(
    'message',
    JSON.stringify({
      response: { status: 'completed' },
      type: 'response.done',
    }),
    false,
  );
  assert.equal((await retried).byteLength, 44 + 2);
});

test('rejects oversized, empty, and incomplete samples', async () => {
  const sockets: FakeSampleSocket[] = [];
  const sampler = new RealtimeVoiceSampler(config, {
    socketFactory: () => {
      const socket = new FakeSampleSocket();
      sockets.push(socket);
      return socket;
    },
  });

  const oversized = sampler.getSample('ash');
  await flushQueue();
  sockets[0]?.emit('open');
  sockets[0]?.emit(
    'message',
    JSON.stringify({
      delta: Buffer.alloc(700_000).toString('base64'),
      type: 'response.output_audio.delta',
    }),
    false,
  );
  await assert.rejects(oversized, (error: unknown) => {
    assert.ok(error instanceof RealtimeProviderError);
    assert.equal(error.kind, 'protocol');
    return true;
  });

  const empty = sampler.getSample('ash');
  await flushQueue();
  sockets[1]?.emit('open');
  sockets[1]?.emit(
    'message',
    JSON.stringify({
      response: { status: 'completed' },
      type: 'response.done',
    }),
    false,
  );
  await assert.rejects(empty, (error: unknown) => {
    assert.ok(error instanceof RealtimeProviderError);
    assert.equal(error.kind, 'protocol');
    return true;
  });

  const closedEarly = sampler.getSample('ash');
  await flushQueue();
  sockets[2]?.emit('open');
  sockets[2]?.emit('close');
  await assert.rejects(closedEarly, (error: unknown) => {
    assert.ok(error instanceof RealtimeProviderError);
    assert.equal(error.kind, 'unavailable');
    return true;
  });
});

class FakeSampleSocket implements SampleSocket {
  closed = false;
  readonly sent: string[] = [];
  private readonly listeners = new Map<
    string,
    Set<(...args: unknown[]) => void>
  >();

  close() {
    this.closed = true;
  }

  emit(event: string, ...args: unknown[]) {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(...args);
    }
  }

  off(event: string, listener: (...args: unknown[]) => void) {
    this.listeners.get(event)?.delete(listener);
  }

  on(event: string, listener: (...args: unknown[]) => void) {
    let bucket = this.listeners.get(event);
    if (!bucket) {
      bucket = new Set();
      this.listeners.set(event, bucket);
    }
    bucket.add(listener);
  }

  send(data: string) {
    this.sent.push(data);
  }
}
