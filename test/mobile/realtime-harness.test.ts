/**
 * Dev-only Realtime harness overrides: URL record strictness, request
 * rewriting with the dummy-bearer guarantee, the single-socket transport tee,
 * and the scripted transport's event grammar.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createRealtimeHarnessOverrides,
  normalizeRealtimeHarnessUrl,
  parseRealtimeHarnessUrlRecord,
  REALTIME_HARNESS_DUMMY_KEY,
  serializeRealtimeHarnessUrlRecord,
} from '../../src/dev/realtime-harness-impl.ts';
import { ScriptedRealtimeTransport } from '../../src/dev/scripted-realtime-transport.ts';
import type { RealtimeTransportEvent } from '../../src/services/realtime/realtime-transport.ts';

function fakeSocket() {
  const listeners = new Map<string, ((event: unknown) => void)[]>();
  const socket = {
    addEventListener: (type: string, listener: (event: unknown) => void) => {
      const existing = listeners.get(type) ?? [];
      existing.push(listener);
      listeners.set(type, existing);
    },
    close: () => undefined,
    send: () => undefined,
  };
  return {
    emitMessage: (data: unknown) => {
      for (const listener of listeners.get('message') ?? []) {
        listener({ data });
      }
    },
    socket: socket as unknown as WebSocket,
  };
}

test('harness URL normalization is strict and origin-only', () => {
  assert.equal(
    normalizeRealtimeHarnessUrl(' http://localhost:8790/ '),
    'http://localhost:8790',
  );
  assert.equal(
    normalizeRealtimeHarnessUrl('http://10.0.2.2:8790/some/path'),
    'http://10.0.2.2:8790',
  );
  assert.equal(normalizeRealtimeHarnessUrl('   '), '');
  assert.throws(() => normalizeRealtimeHarnessUrl('not a url'));
  assert.throws(() => normalizeRealtimeHarnessUrl('ftp://localhost:1'));
  assert.throws(() =>
    normalizeRealtimeHarnessUrl('http://user:pw@localhost:1'),
  );
  assert.throws(() =>
    normalizeRealtimeHarnessUrl('http://localhost:1?query=1'),
  );
  assert.throws(() => normalizeRealtimeHarnessUrl(`http://${'a'.repeat(300)}`));
});

test('harness URL record is versioned and strict', () => {
  const stored = serializeRealtimeHarnessUrlRecord('http://localhost:8790/');
  assert.equal(parseRealtimeHarnessUrlRecord(stored), 'http://localhost:8790');
  assert.throws(() => parseRealtimeHarnessUrlRecord('"just-a-string"'));
  assert.throws(() =>
    parseRealtimeHarnessUrlRecord(JSON.stringify({ url: 'x', version: 2 })),
  );
  assert.throws(() =>
    parseRealtimeHarnessUrlRecord(JSON.stringify({ version: 1 })),
  );
});

test('override fetch rewrites the origin and always substitutes the dummy bearer', async () => {
  const requests: { init: RequestInit | undefined; url: string }[] = [];
  const overrides = createRealtimeHarnessOverrides('http://localhost:8790', {
    fetchImpl: ((url: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ init, url: String(url) });
      return Promise.resolve(new Response('{}'));
    }) as typeof globalThis.fetch,
  });

  await overrides.fetchImpl('https://api.openai.com/v1/realtime/calls', {
    headers: { Authorization: 'Bearer sk-real-user-key-should-not-cross' },
    method: 'POST',
  });
  assert.equal(requests[0]?.url, 'http://localhost:8790/v1/realtime/calls');
  assert.deepEqual(requests[0]?.init?.headers, {
    Authorization: `Bearer ${REALTIME_HARNESS_DUMMY_KEY}`,
  });

  await overrides.fetchImpl(
    'https://api.openai.com/v1/realtime/calls/abc/hangup',
    { headers: { Authorization: 'Bearer sk-real' }, method: 'POST' },
  );
  assert.equal(
    requests[1]?.url,
    'http://localhost:8790/v1/realtime/calls/abc/hangup',
  );
});

test('override socket factory rewrites wss to the harness and tees frames into the transport', async () => {
  const created: string[] = [];
  const fake = fakeSocket();
  const overrides = createRealtimeHarnessOverrides('http://localhost:8790', {
    createSocket: (url) => {
      created.push(url);
      return fake.socket;
    },
  });

  const socket = overrides.socketFactory(
    'wss://api.openai.com/v1/realtime?call_id=abc123',
    'sk-real-user-key',
  );
  assert.equal(socket, fake.socket);
  assert.deepEqual(created, ['ws://localhost:8790/v1/realtime?call_id=abc123']);

  const events: RealtimeTransportEvent[] = [];
  await overrides.transport.prepare({
    onEvent: (event) => events.push(event),
    signal: new AbortController().signal,
  });

  fake.emitMessage(
    JSON.stringify({ type: 'input_audio_buffer.speech_started' }),
  );
  fake.emitMessage(JSON.stringify({ type: 'session.updated' }));
  fake.emitMessage('not json at all');
  fake.emitMessage(
    JSON.stringify({
      delta: 'Hi the',
      type: 'response.output_audio_transcript.delta',
    }),
  );

  assert.deepEqual(events, [
    { activity: 'user_speaking', type: 'activity' },
    { final: false, role: 'assistant', text: 'Hi the', type: 'transcript' },
  ]);
});

test('scripted transport: SDP handshake, mic state, close stops delivery', async () => {
  const transport = new ScriptedRealtimeTransport();
  const events: RealtimeTransportEvent[] = [];
  const prepared = await transport.prepare({
    onEvent: (event) => events.push(event),
    signal: new AbortController().signal,
  });
  assert.ok(prepared.sdpOffer.startsWith('v='));

  await assert.rejects(
    prepared.connect('nope', new AbortController().signal),
    /invalid SDP answer/,
  );
  await prepared.connect('v=0\r\nharness-answer', new AbortController().signal);
  assert.deepEqual(events, [{ count: 1, type: 'remote_audio_tracks' }]);

  prepared.setMicrophoneEnabled(false);
  assert.equal(transport.getMicrophoneEnabled(), false);

  prepared.close();
  transport.deliverFrame(
    JSON.stringify({ type: 'input_audio_buffer.speech_started' }),
  );
  assert.equal(events.length, 1, 'closed transport delivers nothing');
});
