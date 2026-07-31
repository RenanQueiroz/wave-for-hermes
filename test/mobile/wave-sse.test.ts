import assert from 'node:assert/strict';
import test from 'node:test';

import type { WaveTurnEvent } from '@wave/contracts';

import {
  WaveBackendClient,
  WaveBackendError,
} from '../../src/services/wave/wave-backend-client.ts';
import {
  parseWaveSseStream,
  WaveSseProtocolError,
} from '../../src/services/wave/wave-sse.ts';

const credential = `wave_device_${'a'.repeat(43)}`;

test('parses fragmented strict SSE frames and preserves ordered events', async () => {
  const frames = [
    frame(event({ type: 'turn.started' })),
    frame(
      event({
        messageId: 'message-1',
        sequence: 1,
        type: 'assistant.started',
      }),
    ),
  ].join('');
  const events: WaveTurnEvent[] = [];

  for await (const value of parseWaveSseStream(
    byteStream([frames.slice(0, 7), frames.slice(7, 31), frames.slice(31)]),
  )) {
    events.push(value);
  }

  assert.deepEqual(
    events.map(({ sequence, type }) => ({ sequence, type })),
    [
      { sequence: 0, type: 'turn.started' },
      { sequence: 1, type: 'assistant.started' },
    ],
  );
});

test('rejects mismatched names, unknown fields, and truncated frames', async () => {
  const started = event({ type: 'turn.started' });
  await assert.rejects(
    collect(
      parseWaveSseStream(
        byteStream([
          `id: ${started.eventId}\nevent: assistant.delta\ndata: ${JSON.stringify(started)}\n\n`,
        ]),
      ),
    ),
    WaveSseProtocolError,
  );
  await assert.rejects(
    collect(parseWaveSseStream(byteStream([`retry: 10\n${frame(started)}`]))),
    WaveSseProtocolError,
  );
  await assert.rejects(
    collect(
      parseWaveSseStream(byteStream([frame(started).replace(/\n\n$/, '')])),
    ),
    WaveSseProtocolError,
  );
});

test('streams authenticated ordered turns and cancels an abandoned reader', async () => {
  let cancelled = false;
  const started = event({ type: 'turn.started' });
  const completed = event({
    completed: true,
    sequence: 1,
    type: 'turn.completed',
  });
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    assert.equal(
      String(input),
      'https://wave.test/root/v1/sessions/session-1/turns',
    );
    assert.equal(
      new Headers(init?.headers).get('authorization'),
      `Bearer ${credential}`,
    );
    assert.deepEqual(JSON.parse(String(init?.body)), {
      input: [
        { text: 'Hello Hermes', type: 'text' },
        {
          mimeType: 'text/plain',
          name: 'note.txt',
          text: 'A note',
          type: 'text_file',
        },
      ],
    });
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(`${frame(started)}${frame(completed)}`),
        );
      },
    });
    return new Response(body, {
      headers: { 'content-type': 'text/event-stream; charset=utf-8' },
    });
  };
  const client = new WaveBackendClient({
    baseUrl: 'https://wave.test/root',
    credential,
    fetch,
  });
  const stream = client.streamTurn('session-1', [
    { text: ' Hello Hermes ', type: 'text' },
    {
      mimeType: 'text/plain',
      name: 'note.txt',
      text: 'A note',
      type: 'text_file',
    },
  ]);

  assert.equal((await stream.next()).value?.type, 'turn.started');
  await stream.return(undefined);
  assert.equal(cancelled, true);
});

test('rejects out-of-order and incomplete Wave turn streams', async () => {
  const outOfOrder = new WaveBackendClient({
    baseUrl: 'https://wave.test',
    credential,
    fetch: async () =>
      sseResponse([
        event({ type: 'turn.started' }),
        event({
          completed: true,
          sequence: 2,
          type: 'turn.completed',
        }),
      ]),
  });
  await assert.rejects(
    collect(outOfOrder.streamTurn('session-1', 'Hello')),
    (error: unknown) =>
      error instanceof WaveBackendError && error.kind === 'invalid_response',
  );

  const incomplete = new WaveBackendClient({
    baseUrl: 'https://wave.test',
    credential,
    fetch: async () => sseResponse([event({ type: 'turn.started' })]),
  });
  await assert.rejects(
    collect(incomplete.streamTurn('session-1', 'Hello')),
    (error: unknown) =>
      error instanceof WaveBackendError && error.kind === 'invalid_response',
  );
});

function event(
  value:
    | { type: 'turn.started' }
    | {
        messageId: string;
        sequence: number;
        type: 'assistant.started';
      }
    | {
        completed: boolean;
        sequence: number;
        type: 'turn.completed';
      },
): WaveTurnEvent {
  return {
    apiVersion: 'v1',
    eventId: `event-${value.sequence ?? 0}`,
    sequence: value.sequence ?? 0,
    sessionId: 'session-1',
    timestamp: '2026-07-30T02:00:00.000Z',
    turnId: 'turn-1',
    ...value,
  };
}

function frame(value: WaveTurnEvent) {
  return `id: ${value.eventId}\nevent: ${value.type}\ndata: ${JSON.stringify(value)}\n\n`;
}

function byteStream(chunks: string[]) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(new TextEncoder().encode(chunk));
      }
      controller.close();
    },
  });
}

function sseResponse(events: WaveTurnEvent[]) {
  return new Response(byteStream(events.map(frame)), {
    headers: { 'content-type': 'text/event-stream' },
  });
}

async function collect<T>(stream: AsyncIterable<T>) {
  const values: T[] = [];
  for await (const value of stream) values.push(value);
  return values;
}
