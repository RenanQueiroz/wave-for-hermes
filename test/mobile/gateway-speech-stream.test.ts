import assert from 'node:assert/strict';
import test from 'node:test';

import { GatewayClient } from '../../src/services/gateway/gateway-client.ts';
import {
  createGatewaySpeechStream,
  SPEECH_STREAM_HIGH_WATER_MS,
  SPEECH_STREAM_MAX_PENDING_MS,
  SPEECH_STREAM_MAX_SESSION_AUDIO_MS,
  SPEECH_STREAM_MAX_TEXT_CHARS,
  type GatewaySpeechStreamOptions,
  type SpeechPlaybackOwner,
  type SpeechPlaybackStatus,
  type SpeechSocketLike,
} from '../../src/services/gateway/gateway-speech-stream.ts';

function tick() {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

class FakePlayer implements SpeechPlaybackOwner {
  finishCalls = 0;
  finishOutcome = 'drained';
  format: { channels: 1 | 2; sampleRate: number } | undefined;
  startCalls = 0;
  startError: Error | undefined;
  stopCalls = 0;
  writes: Uint8Array[] = [];
  private listeners = new Set<(event: SpeechPlaybackStatus) => void>();

  get writtenFrames() {
    const bytesPerFrame = (this.format?.channels ?? 1) * 2;
    return (
      this.writes.reduce((sum, chunk) => sum + chunk.byteLength, 0) /
      bytesPerFrame
    );
  }

  async start(format: { channels: 1 | 2; sampleRate: number }) {
    if (this.startError) throw this.startError;
    this.startCalls += 1;
    this.format = format;
  }

  write(chunk: Uint8Array) {
    this.writes.push(chunk);
  }

  async finish() {
    this.finishCalls += 1;
    return { outcome: this.finishOutcome };
  }

  async stop() {
    this.stopCalls += 1;
    return undefined;
  }

  subscribe(listener: (event: SpeechPlaybackStatus) => void) {
    this.listeners.add(listener);
    return { remove: () => this.listeners.delete(listener) };
  }

  emit(event: Partial<SpeechPlaybackStatus>) {
    const full: SpeechPlaybackStatus = {
      playedFrames: 0,
      queuedDurationMs: 0,
      state: 'playing',
      ...event,
    };
    for (const listener of this.listeners) listener(full);
  }
}

class FakeSocket implements SpeechSocketLike {
  binaryType: string | undefined;
  closed: Array<{ code?: number }> = [];
  onclose: ((event?: unknown) => void) | null = null;
  onerror: ((event?: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onopen: ((event?: unknown) => void) | null = null;
  sent: string[] = [];

  send(data: string) {
    this.sent.push(data);
  }

  close(code?: number) {
    this.closed.push({ code });
  }

  open() {
    this.onopen?.();
  }

  control(frame: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }

  binary(bytes: number[] | Uint8Array) {
    const array = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
    const buffer = array.buffer.slice(
      array.byteOffset,
      array.byteOffset + array.byteLength,
    );
    this.onmessage?.({ data: buffer });
  }

  sentFrames(): Record<string, unknown>[] {
    return this.sent.map((data) => JSON.parse(data) as Record<string, unknown>);
  }
}

function createSession(overrides: Partial<GatewaySpeechStreamOptions> = {}): {
  player: FakePlayer;
  socket: FakeSocket;
  stream: ReturnType<typeof createGatewaySpeechStream>;
} {
  const socket = new FakeSocket();
  const player = new FakePlayer();
  const stream = createGatewaySpeechStream({
    connect: async () => socket,
    player,
    ...overrides,
  });
  return { player, socket, stream };
}

test('streams a reply end to end: text out, aligned PCM in, drained result', async () => {
  const { player, socket, stream } = createSession();
  stream.appendText('Hello there. ');
  await tick();
  socket.open();
  stream.appendText('All done.');
  socket.control({ channels: 1, sample_rate: 24_000, type: 'start' });
  // Frames arrive unaligned: the odd tail byte must carry into the next one.
  socket.binary([1, 2, 3]);
  socket.binary([4, 5, 6, 7, 8]);
  await tick();
  assert.deepEqual(player.format, { channels: 1, sampleRate: 24_000 });
  // Admission may batch, but bytes stay ordered and every write is aligned.
  assert.deepEqual(
    player.writes.flatMap((chunk) => Array.from(chunk)),
    [1, 2, 3, 4, 5, 6, 7, 8],
  );
  for (const chunk of player.writes) assert.equal(chunk.byteLength % 2, 0);
  stream.finishText();
  socket.control({ type: 'end' });
  await tick();
  const result = await stream.result();
  assert.deepEqual(result, { outcome: 'completed' });
  assert.equal(player.finishCalls, 1);
  assert.equal(player.stopCalls, 0);
  const frames = socket.sentFrames();
  assert.deepEqual(frames, [
    { text: 'Hello there. ' },
    { text: 'All done.' },
    { done: true },
  ]);
});

test('a fallback frame resolves unspoken before any playback starts', async () => {
  const { player, socket, stream } = createSession();
  await tick();
  socket.open();
  socket.control({ type: 'fallback' });
  const result = await stream.result();
  assert.deepEqual(result, { outcome: 'unspoken', reason: 'fallback' });
  assert.equal(player.startCalls, 0);
});

test('an older gateway that refuses the socket resolves unspoken', async () => {
  const { player, socket, stream } = createSession();
  await tick();
  socket.onerror?.();
  const result = await stream.result();
  assert.deepEqual(result, { outcome: 'unspoken', reason: 'error' });
  assert.equal(player.startCalls, 0);
});

test('a failed connect resolves unspoken instead of throwing', async () => {
  const player = new FakePlayer();
  const stream = createGatewaySpeechStream({
    connect: async () => {
      throw new Error('no ticket');
    },
    player,
  });
  const result = await stream.result();
  assert.deepEqual(result, { outcome: 'unspoken', reason: 'error' });
});

test('a server that never starts times out into the unspoken result', async () => {
  const { socket, stream } = createSession({
    timeouts: { connectToStartMs: 20 },
  });
  await tick();
  socket.open();
  const result = await stream.result();
  assert.deepEqual(result, { outcome: 'unspoken', reason: 'error' });
});

test('missing end after done fails by audibility: silent stays unspoken', async () => {
  const { socket, stream } = createSession({ timeouts: { doneToEndMs: 20 } });
  await tick();
  socket.open();
  socket.control({ type: 'start', sample_rate: 24_000, channels: 1 });
  stream.finishText();
  const result = await stream.result();
  assert.deepEqual(result, { outcome: 'unspoken', reason: 'error' });
});

test('missing end after audible playback resolves incomplete, never respoken', async () => {
  const { player, socket, stream } = createSession({
    timeouts: { doneToEndMs: 30 },
  });
  await tick();
  socket.open();
  socket.control({ type: 'start', sample_rate: 24_000, channels: 1 });
  socket.binary([1, 2, 3, 4]);
  await tick();
  player.emit({ playedFrames: 1, state: 'playing' });
  stream.finishText();
  const result = await stream.result();
  assert.deepEqual(result, { outcome: 'incomplete' });
  assert.equal(player.stopCalls, 1);
});

test('audio before the start frame is a protocol violation', async () => {
  const { socket, stream } = createSession();
  await tick();
  socket.open();
  socket.binary([1, 2]);
  const result = await stream.result();
  assert.deepEqual(result, { outcome: 'unspoken', reason: 'error' });
  assert.equal(socket.closed.length, 1);
});

test('oversized and unreadable control frames fail deterministically', async () => {
  {
    const { socket, stream } = createSession();
    await tick();
    socket.open();
    socket.onmessage?.({ data: 'not json' });
    assert.deepEqual(await stream.result(), {
      outcome: 'unspoken',
      reason: 'error',
    });
  }
  {
    const { socket, stream } = createSession();
    await tick();
    socket.open();
    socket.onmessage?.({ data: `{"type":"x","pad":"${'y'.repeat(5_000)}"}` });
    assert.deepEqual(await stream.result(), {
      outcome: 'unspoken',
      reason: 'error',
    });
  }
});

test('an oversized binary frame fails deterministically', async () => {
  const { socket, stream } = createSession();
  await tick();
  socket.open();
  socket.control({ type: 'start', sample_rate: 24_000, channels: 1 });
  socket.binary(new Uint8Array(512 * 1024 + 2));
  assert.deepEqual(await stream.result(), {
    outcome: 'unspoken',
    reason: 'error',
  });
});

test('unknown bounded control frames are ignored for future gateways', async () => {
  const { socket, stream } = createSession();
  await tick();
  socket.open();
  socket.control({ type: 'start', sample_rate: 24_000, channels: 1 });
  socket.control({ type: 'telemetry', detail: 'ignored' });
  stream.finishText();
  socket.control({ type: 'end' });
  await tick();
  assert.deepEqual(await stream.result(), { outcome: 'completed' });
});

test('admission pauses at the six-second high water and resumes on playback', async () => {
  const { player, socket, stream } = createSession();
  await tick();
  socket.open();
  socket.control({ type: 'start', sample_rate: 8_000, channels: 1 });
  const highWaterFrames = (8_000 * SPEECH_STREAM_HIGH_WATER_MS) / 1_000;
  // Ten seconds of audio in one burst: only six may reach the player.
  socket.binary(new Uint8Array(10 * 8_000 * 2));
  await tick();
  assert.equal(player.writtenFrames, highWaterFrames);
  // Playback progress reopens exactly the drained headroom.
  player.emit({ playedFrames: 8_000, state: 'playing' });
  assert.equal(player.writtenFrames, highWaterFrames + 8_000);
  player.emit({ playedFrames: 16_000, state: 'playing' });
  assert.equal(player.writtenFrames, highWaterFrames + 16_000);
  stream.stop();
  assert.deepEqual(await stream.result(), { outcome: 'skipped' });
});

test('a producer that outruns playback beyond the pending bound fails', async () => {
  const { player, socket, stream } = createSession();
  await tick();
  socket.open();
  socket.control({ type: 'start', sample_rate: 8_000, channels: 1 });
  const pendingCapFrames = (8_000 * SPEECH_STREAM_MAX_PENDING_MS) / 1_000;
  const frameBytes = 512 * 1024;
  let sentFrames = 0;
  // Never report playback progress; keep bursting until the bound trips.
  for (let index = 0; index < 20; index += 1) {
    socket.binary(new Uint8Array(frameBytes));
    sentFrames += frameBytes / 2;
    if (sentFrames - player.writtenFrames > pendingCapFrames) break;
  }
  assert.deepEqual(await stream.result(), {
    outcome: 'unspoken',
    reason: 'error',
  });
  assert.equal(player.stopCalls, 1);
});

test('the total per-session audio bound fails a runaway stream', async () => {
  const { player, socket, stream } = createSession();
  await tick();
  socket.open();
  socket.control({ type: 'start', sample_rate: 8_000, channels: 1 });
  const sessionCapFrames = (8_000 * SPEECH_STREAM_MAX_SESSION_AUDIO_MS) / 1_000;
  const frameBytes = 512 * 1024;
  let received = 0;
  let terminal = false;
  void stream.result().then(() => {
    terminal = true;
  });
  while (!terminal && received <= sessionCapFrames) {
    socket.binary(new Uint8Array(frameBytes));
    received += frameBytes / 2;
    // Fully drain between bursts — each played report reopens one high-water
    // window — so only the session bound can trip.
    let previous = -1;
    while (player.writtenFrames !== previous) {
      previous = player.writtenFrames;
      player.emit({ playedFrames: player.writtenFrames, state: 'playing' });
    }
    await tick();
  }
  const result = await stream.result();
  assert.deepEqual(result, { outcome: 'incomplete' });
  assert.ok(received > sessionCapFrames);
});

test('stop sends barge-in, stops playback, and resolves skipped', async () => {
  const { player, socket, stream } = createSession();
  await tick();
  socket.open();
  socket.control({ type: 'start', sample_rate: 24_000, channels: 1 });
  socket.binary([1, 2, 3, 4]);
  await tick();
  stream.stop();
  assert.deepEqual(await stream.result(), { outcome: 'skipped' });
  assert.equal(player.stopCalls, 1);
  assert.deepEqual(socket.sentFrames(), [{ stop: true }]);
  // Later frames and text are inert after the terminal state.
  stream.appendText('ignored');
  socket.control({ type: 'end' });
  assert.deepEqual(await stream.result(), { outcome: 'skipped' });
});

test('fed text is capped for one session', async () => {
  const { socket, stream } = createSession();
  await tick();
  socket.open();
  stream.appendText('a'.repeat(SPEECH_STREAM_MAX_TEXT_CHARS - 5));
  stream.appendText('b'.repeat(50));
  stream.appendText('c');
  const fed = socket
    .sentFrames()
    .map((frame) => String(frame.text ?? ''))
    .join('');
  assert.equal(fed.length, SPEECH_STREAM_MAX_TEXT_CHARS);
  assert.ok(fed.endsWith('bbbbb'));
  stream.stop();
  await stream.result();
});

test('a spontaneous player interruption maps through audibility', async () => {
  const { player, socket, stream } = createSession();
  await tick();
  socket.open();
  socket.control({ type: 'start', sample_rate: 24_000, channels: 1 });
  socket.binary([1, 2, 3, 4]);
  await tick();
  player.emit({ playedFrames: 1, state: 'playing' });
  player.emit({ playedFrames: 2, reason: 'interrupted', state: 'idle' });
  assert.deepEqual(await stream.result(), { outcome: 'incomplete' });
});

test('an empty reply completes without ever starting playback', async () => {
  const { player, socket, stream } = createSession();
  await tick();
  socket.open();
  socket.control({ type: 'start', sample_rate: 24_000, channels: 1 });
  stream.finishText();
  socket.control({ type: 'end' });
  await tick();
  assert.deepEqual(await stream.result(), { outcome: 'completed' });
  assert.equal(player.startCalls, 0);
  assert.equal(player.finishCalls, 0);
});

test('the client dials the ticketed speak-stream URL and caches fallback', async () => {
  const requests: string[] = [];
  const sockets: FakeSocket[] = [];
  const fetchImpl = (async (url: string | URL) => {
    requests.push(String(url));
    assert.ok(String(url).endsWith('/api/auth/ws-ticket'));
    return new Response(JSON.stringify({ ticket: 'tick-1' }), {
      headers: { 'content-type': 'application/json' },
      status: 200,
    });
  }) as unknown as typeof globalThis.fetch;
  let socketUrl = '';
  const client = new GatewayClient({
    baseUrl: 'http://localhost:9119',
    fetch: fetchImpl,
    socketFactory: (url: string) => {
      socketUrl = url;
      const socket = new FakeSocket();
      sockets.push(socket);
      setTimeout(() => {
        socket.open();
        socket.control({ type: 'fallback' });
      }, 0);
      return socket as unknown as WebSocket;
    },
    tokens: { accessToken: 'a', provider: 'basic', refreshToken: 'r' },
  });
  const player = new FakePlayer();
  const first = client.openSpeechStream({ player });
  assert.deepEqual(await first.result(), {
    outcome: 'unspoken',
    reason: 'fallback',
  });
  assert.equal(
    socketUrl,
    'ws://localhost:9119/api/audio/speak-stream?ticket=tick-1',
  );
  await tick();
  // The fallback verdict is cached: no new ticket, no new dial for a while.
  const second = client.openSpeechStream({ player });
  assert.deepEqual(await second.result(), {
    outcome: 'unspoken',
    reason: 'fallback',
  });
  assert.equal(sockets.length, 1);
  assert.equal(requests.length, 1);
});
