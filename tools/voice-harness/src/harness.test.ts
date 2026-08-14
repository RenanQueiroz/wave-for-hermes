/**
 * Wire-level self-tests: raw HTTP + WebSocket against the fake gateway,
 * pinned to the protocol shapes Wave's GatewayClient consumes.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { WebSocket } from 'ws';

import { startVoiceHarness, type RunningVoiceHarness } from './index.js';

interface CookieJar {
  at?: string;
  provider?: string;
  rt?: string;
}

function harvest(jar: CookieJar, response: Response): void {
  for (const cookie of response.headers.getSetCookie()) {
    const [pair] = cookie.split(';');
    const separator = pair?.indexOf('=') ?? -1;
    if (!pair || separator <= 0) continue;
    const name = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    if (name === 'hermes_session_at') jar.at = value;
    if (name === 'hermes_session_rt') jar.rt = value;
    if (name === 'hermes_session_provider') jar.provider = value;
  }
}

function cookieHeader(jar: CookieJar): string {
  return [
    `hermes_session_at=${jar.at ?? ''}`,
    `hermes_session_rt=${jar.rt ?? ''}`,
    `hermes_session_provider=${jar.provider ?? 'password'}`,
  ].join('; ');
}

async function signIn(harness: RunningVoiceHarness): Promise<CookieJar> {
  const jar: CookieJar = {};
  const response = await fetch(`${harness.gatewayUrl}/auth/password-login`, {
    body: JSON.stringify({
      password: 'secret',
      provider: 'password',
      username: 'tester',
    }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });
  assert.equal(response.status, 200);
  harvest(jar, response);
  assert.ok(jar.at, 'sign-in must set the access cookie');
  return jar;
}

async function api(
  harness: RunningVoiceHarness,
  jar: CookieJar,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const response = await fetch(`${harness.gatewayUrl}${path}`, {
    ...init,
    headers: {
      cookie: cookieHeader(jar),
      ...(init.body === undefined
        ? {}
        : { 'content-type': 'application/json' }),
    },
  });
  harvest(jar, response);
  return response;
}

async function mintTicket(
  harness: RunningVoiceHarness,
  jar: CookieJar,
): Promise<string> {
  const response = await api(harness, jar, '/api/auth/ws-ticket', {
    method: 'POST',
  });
  assert.equal(response.status, 200);
  const body = (await response.json()) as { ticket: string };
  return body.ticket;
}

interface RpcClient {
  call(
    method: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
  callError(
    method: string,
    params: Record<string, unknown>,
  ): Promise<{ code: number }>;
  close(): void;
  events: { payload: Record<string, unknown>; type: string }[];
  waitForEvent(
    type: string,
    timeoutMs?: number,
  ): Promise<Record<string, unknown>>;
}

async function openRpc(
  harness: RunningVoiceHarness,
  jar: CookieJar,
): Promise<RpcClient> {
  const ticket = await mintTicket(harness, jar);
  const wsBase = harness.gatewayUrl.replace(/^http/, 'ws');
  const socket = new WebSocket(`${wsBase}/api/ws?ticket=${ticket}`);
  const events: RpcClient['events'] = [];
  const waiters: {
    reject: (error: Error) => void;
    resolve: (payload: Record<string, unknown>) => void;
    type: string;
  }[] = [];
  const pending = new Map<
    number,
    {
      reject: (error: Error & { code?: number }) => void;
      resolve: (result: Record<string, unknown>) => void;
    }
  >();
  let nextId = 1;

  socket.on('message', (data) => {
    const frame = JSON.parse(String(data)) as Record<string, unknown>;
    if (frame.method === 'event') {
      const params = frame.params as {
        payload: Record<string, unknown>;
        type: string;
      };
      events.push({ payload: params.payload, type: params.type });
      for (let index = waiters.length - 1; index >= 0; index -= 1) {
        if (waiters[index]?.type === params.type) {
          const waiter = waiters.splice(index, 1)[0];
          waiter?.resolve(params.payload);
        }
      }
      return;
    }
    const id = frame.id as number;
    const call = pending.get(id);
    if (!call) return;
    pending.delete(id);
    if (frame.error) {
      const { code, message } = frame.error as {
        code: number;
        message: string;
      };
      const error = new Error(message) as Error & { code?: number };
      error.code = code;
      call.reject(error);
      return;
    }
    call.resolve(frame.result as Record<string, unknown>);
  });

  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });

  return {
    call: (method, params) =>
      new Promise((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { reject, resolve });
        socket.send(JSON.stringify({ id, jsonrpc: '2.0', method, params }));
      }),
    callError: async (method, params) => {
      try {
        await new Promise((resolve, reject) => {
          const id = nextId++;
          pending.set(id, { reject, resolve });
          socket.send(JSON.stringify({ id, jsonrpc: '2.0', method, params }));
        });
      } catch (error) {
        return { code: (error as { code?: number }).code ?? -1 };
      }
      throw new Error(`${method} unexpectedly succeeded`);
    },
    close: () => socket.close(),
    events,
    waitForEvent: (type, timeoutMs = 5_000) =>
      new Promise((resolve, reject) => {
        const existing = events.find((event) => event.type === type);
        if (existing) {
          resolve(existing.payload);
          return;
        }
        const timer = setTimeout(
          () => reject(new Error(`timed out waiting for ${type}`)),
          timeoutMs,
        );
        waiters.push({
          reject,
          resolve: (payload) => {
            clearTimeout(timer);
            resolve(payload);
          },
          type,
        });
      }),
  };
}

async function loadScenario(
  harness: RunningVoiceHarness,
  scenario: unknown,
): Promise<void> {
  const response = await fetch(`${harness.controlUrl}/control/scenario`, {
    body: JSON.stringify(scenario),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });
  assert.equal(response.status, 200);
}

test('auth: sign-in issues cookies, requests rotate them, junk is rejected', async () => {
  const harness = await startVoiceHarness({ controlPort: 0, gatewayPort: 0 });
  try {
    const providers = await fetch(`${harness.gatewayUrl}/api/auth/providers`);
    const providerBody = (await providers.json()) as {
      providers: { supports_password: boolean }[];
    };
    assert.equal(providerBody.providers[0]?.supports_password, true);

    const jar = await signIn(harness);
    const before = jar.at;
    const me = await api(harness, jar, '/api/auth/me');
    assert.equal(me.status, 200);
    assert.equal(
      ((await me.json()) as { user_id: string }).user_id,
      'harness-user',
    );
    assert.notEqual(
      jar.at,
      before,
      'authenticated responses must rotate tokens',
    );

    const junk = await fetch(`${harness.gatewayUrl}/api/auth/me`, {
      headers: { cookie: 'hermes_session_at=nope' },
    });
    assert.equal(junk.status, 401);

    const badLogin = await fetch(`${harness.gatewayUrl}/auth/password-login`, {
      body: JSON.stringify({
        password: '',
        provider: 'password',
        username: 'x',
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
    assert.equal(badLogin.status, 401);
  } finally {
    await harness.close();
  }
});

test('turns: default echo, scripted frames, interrupt, and history rows', async () => {
  const harness = await startVoiceHarness({ controlPort: 0, gatewayPort: 0 });
  try {
    const jar = await signIn(harness);
    const rpc = await openRpc(harness, jar);
    const created = await rpc.call('session.create', {});
    const liveId = created.session_id as string;
    const storedId = created.stored_session_id as string;
    assert.ok(liveId && storedId);

    await rpc.call('prompt.submit', {
      session_id: liveId,
      text: 'hello there',
    });
    const completion = await rpc.waitForEvent('message.complete');
    assert.equal(completion.text, 'You said: hello there');

    const messages = await api(
      harness,
      jar,
      `/api/sessions/${storedId}/messages?limit=100&offset=0`,
    );
    const rows = (
      (await messages.json()) as {
        messages: { content: string; role: string }[];
      }
    ).messages;
    assert.deepEqual(
      rows.map((row) => [row.role, row.content]),
      [
        ['user', 'hello there'],
        ['assistant', 'You said: hello there'],
      ],
    );

    // A scripted slow turn can be interrupted mid-flight.
    await loadScenario(harness, {
      turns: [
        {
          frames: [
            { type: 'message.start' },
            { payload: { text: 'thinking…' }, type: 'message.delta' },
            {
              delayMs: 5_000,
              payload: { text: 'never' },
              type: 'message.delta',
            },
            {
              payload: { status: 'complete', text: 'never' },
              type: 'message.complete',
            },
          ],
        },
      ],
    });
    await rpc.call('prompt.submit', { session_id: liveId, text: 'slow one' });
    await rpc.waitForEvent('message.delta');
    await rpc.call('session.interrupt', { session_id: liveId });
    await rpc.waitForEvent('turn.interrupted');

    rpc.close();
  } finally {
    await harness.close();
  }
});

test('models: default catalog, config values, and scenario overrides', async () => {
  const harness = await startVoiceHarness({ controlPort: 0, gatewayPort: 0 });
  try {
    const jar = await signIn(harness);
    const rpc = await openRpc(harness, jar);

    const catalog = await rpc.call('model.options', { explicit_only: true });
    assert.equal(catalog.model, 'gpt-5.6-sol');
    const providers = catalog.providers as { models: string[] }[];
    assert.deepEqual(providers[0]?.models, [
      'gpt-5.6-sol',
      'gpt-5.6-terra',
      'gpt-5.6-luna',
    ]);

    const reasoning = await rpc.call('config.get', { key: 'reasoning' });
    assert.equal(reasoning.value, 'xhigh');
    const fast = await rpc.call('config.get', { key: 'fast' });
    assert.equal(fast.value, 'normal');
    const unknown = await rpc.callError('config.get', { key: 'nope' });
    assert.equal(unknown.code, 4000);

    await loadScenario(harness, {
      models: {
        config: { reasoning: 'medium' },
        options: { model: 'scripted-model', providers: [] },
      },
    });
    const overridden = await rpc.call('model.options', {});
    assert.equal(overridden.model, 'scripted-model');
    const overriddenReasoning = await rpc.call('config.get', {
      key: 'reasoning',
    });
    assert.equal(overriddenReasoning.value, 'medium');

    rpc.close();
  } finally {
    await harness.close();
  }
});

test('redirects: scripted statuses, race error codes, and journal entries', async () => {
  const harness = await startVoiceHarness({ controlPort: 0, gatewayPort: 0 });
  try {
    const jar = await signIn(harness);
    const rpc = await openRpc(harness, jar);
    const created = await rpc.call('session.create', {});
    const liveId = created.session_id as string;

    await loadScenario(harness, {
      redirects: [
        { status: 'redirected' },
        { status: 'queued' },
        { status: 'rejected' },
        { errorCode: 4010, errorMessage: 'no redirect support' },
      ],
    });

    const first = await rpc.call('session.redirect', {
      session_id: liveId,
      text: 'steer one',
    });
    assert.equal(first.status, 'redirected');
    const second = await rpc.call('session.redirect', {
      session_id: liveId,
      text: 'steer two',
    });
    assert.equal(second.status, 'queued');
    const third = await rpc.call('session.redirect', {
      session_id: liveId,
      text: 'steer three',
    });
    assert.equal(third.status, 'rejected');
    const failure = await rpc.callError('session.redirect', {
      session_id: liveId,
      text: 'steer four',
    });
    assert.equal(failure.code, 4010);

    const empty = await rpc.callError('session.redirect', {
      session_id: liveId,
      text: '   ',
    });
    assert.equal(empty.code, 4002);

    // Default outcome with no script left is `redirected`.
    const fifth = await rpc.call('session.redirect', {
      session_id: liveId,
      text: 'steer five',
    });
    assert.equal(fifth.status, 'redirected');

    const journal = await fetch(`${harness.controlUrl}/control/journal`);
    const entries = (
      (await journal.json()) as {
        entries: { detail: Record<string, unknown>; kind: string }[];
      }
    ).entries;
    const redirected = entries.filter(
      (entry) => entry.kind === 'session.redirect',
    );
    // The empty-text call fails validation before journaling, like the real
    // gateway's 4002 path, so five of the six calls are recorded.
    assert.equal(redirected.length, 5);
    assert.equal(redirected[0]?.detail.text, 'steer one');

    rpc.close();
  } finally {
    await harness.close();
  }
});

test('audio: transcript FIFO, scripted failure, buffered speak, capabilities', async () => {
  const harness = await startVoiceHarness({ controlPort: 0, gatewayPort: 0 });
  try {
    const jar = await signIn(harness);
    await loadScenario(harness, {
      transcripts: ['first utterance', 'second utterance'],
    });

    const transcribeBody = JSON.stringify({
      data_url: 'data:audio/m4a;base64,AAAA',
      mime_type: 'audio/m4a',
    });
    const first = await api(harness, jar, '/api/audio/transcribe', {
      body: transcribeBody,
      method: 'POST',
    });
    assert.equal(
      ((await first.json()) as { transcript: string }).transcript,
      'first utterance',
    );
    const second = await api(harness, jar, '/api/audio/transcribe', {
      body: transcribeBody,
      method: 'POST',
    });
    assert.equal(
      ((await second.json()) as { transcript: string }).transcript,
      'second utterance',
    );
    const drained = await api(harness, jar, '/api/audio/transcribe', {
      body: transcribeBody,
      method: 'POST',
    });
    assert.equal(
      ((await drained.json()) as { transcript: string }).transcript,
      'Hello from the harness.',
    );

    await loadScenario(harness, { transcribe: { failWith: 503 } });
    const failed = await api(harness, jar, '/api/audio/transcribe', {
      body: transcribeBody,
      method: 'POST',
    });
    assert.equal(failed.status, 503);

    const speak = await api(harness, jar, '/api/audio/speak', {
      body: JSON.stringify({ text: 'read this aloud' }),
      method: 'POST',
    });
    const speakBody = (await speak.json()) as {
      data_url: string;
      mime_type: string;
    };
    assert.equal(speakBody.mime_type, 'audio/wav');
    assert.ok(speakBody.data_url.startsWith('data:audio/wav;base64,'));

    const config = await api(harness, jar, '/api/config');
    const configBody = (await config.json()) as {
      stt?: { provider: string };
      tts?: { provider: string };
    };
    assert.equal(configBody.stt?.provider, 'harness');
    assert.equal(configBody.tts?.provider, 'harness');

    await loadScenario(harness, {
      audioCapabilities: { stt: true, tts: false },
    });
    const partial = await api(harness, jar, '/api/config');
    const partialBody = (await partial.json()) as { tts?: unknown };
    assert.equal(partialBody.tts, undefined);
  } finally {
    await harness.close();
  }
});

test('speak-stream: start, PCM for each text, end on done; fallback mode; single-use tickets', async () => {
  const harness = await startVoiceHarness({ controlPort: 0, gatewayPort: 0 });
  try {
    const jar = await signIn(harness);
    const wsBase = harness.gatewayUrl.replace(/^http/, 'ws');

    const ticket = await mintTicket(harness, jar);
    const socket = new WebSocket(
      `${wsBase}/api/audio/speak-stream?ticket=${ticket}`,
    );
    socket.binaryType = 'arraybuffer';
    const control: Record<string, unknown>[] = [];
    let binaryBytes = 0;
    const ended = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no end frame')), 5_000);
      socket.on('message', (data, isBinary) => {
        if (isBinary || data instanceof ArrayBuffer) {
          binaryBytes +=
            data instanceof ArrayBuffer
              ? data.byteLength
              : (data as Buffer).byteLength;
          return;
        }
        const frame = JSON.parse(String(data)) as Record<string, unknown>;
        control.push(frame);
        if (frame.type === 'end') {
          clearTimeout(timer);
          resolve();
        }
      });
      socket.on('error', reject);
    });
    await new Promise<void>((resolve) => socket.once('open', () => resolve()));
    socket.send(JSON.stringify({ text: 'Hello there, listener.' }));
    socket.send(JSON.stringify({ done: true }));
    await ended;
    assert.equal(control[0]?.type, 'start');
    assert.equal(control[0]?.sample_rate, 24_000);
    assert.equal(control[0]?.channels, 1);
    assert.ok(binaryBytes > 0, 'text must produce PCM bytes');
    assert.equal(binaryBytes % 2, 0, 'PCM must be whole Int16 frames');
    socket.close();

    // Ticket reuse is refused.
    const reused = new WebSocket(`${wsBase}/api/ws?ticket=${ticket}`);
    await new Promise<void>((resolve) => {
      reused.once('error', () => resolve());
      reused.once('unexpected-response', () => resolve());
    });

    // Fallback mode answers fallback instead of start.
    await loadScenario(harness, { speech: { mode: 'fallback' } });
    const fallbackTicket = await mintTicket(harness, jar);
    const fallbackSocket = new WebSocket(
      `${wsBase}/api/audio/speak-stream?ticket=${fallbackTicket}`,
    );
    const fallbackFrame = await new Promise<Record<string, unknown>>(
      (resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('no fallback')), 5_000);
        fallbackSocket.on('message', (data) => {
          clearTimeout(timer);
          resolve(JSON.parse(String(data)) as Record<string, unknown>);
        });
        fallbackSocket.on('error', reject);
      },
    );
    assert.equal(fallbackFrame.type, 'fallback');
    fallbackSocket.close();
  } finally {
    await harness.close();
  }
});

test('control: seedSessions fixture populates the session list', async () => {
  const harness = await startVoiceHarness({ controlPort: 0, gatewayPort: 0 });
  try {
    await loadScenario(harness, {
      seedSessions: { count: 5, pinnedEvery: 2, titlePrefix: 'Fixture' },
    });
    const jar = await signIn(harness);
    const listed = await api(harness, jar, '/api/sessions');
    assert.equal(listed.status, 200);
    const body = (await listed.json()) as {
      sessions: { pinned: boolean; title: string }[];
    };
    assert.equal(body.sessions.length, 5);
    assert.equal(body.sessions[0]?.title, 'Fixture 1');
    assert.equal(body.sessions.filter((session) => session.pinned).length, 3);
  } finally {
    await harness.close();
  }
});

test('control: seedConversations fixture builds named showcase history', async () => {
  const harness = await startVoiceHarness({ controlPort: 0, gatewayPort: 0 });
  try {
    await loadScenario(harness, {
      seedConversations: [
        {
          ageHours: 2,
          messages: [
            { content: 'Make a plan.', role: 'user' },
            { content: 'Here is the plan.', role: 'assistant' },
          ],
          pinned: true,
          source: 'cron',
          title: 'Launch checklist',
        },
      ],
    });
    const jar = await signIn(harness);
    const listed = await api(harness, jar, '/api/sessions');
    assert.equal(listed.status, 200);
    const listBody = (await listed.json()) as {
      sessions: {
        id: string;
        pinned: boolean;
        source: string;
        title: string;
      }[];
    };
    assert.equal(listBody.sessions.length, 1);
    assert.equal(listBody.sessions[0]?.title, 'Launch checklist');
    assert.equal(listBody.sessions[0]?.source, 'cron');
    assert.equal(listBody.sessions[0]?.pinned, true);

    const history = await api(
      harness,
      jar,
      `/api/sessions/${listBody.sessions[0]?.id}/messages`,
    );
    assert.equal(history.status, 200);
    const historyBody = (await history.json()) as {
      messages: { content: string; role: string; timestamp: number }[];
    };
    assert.deepEqual(
      historyBody.messages.map(({ content, role }) => ({ content, role })),
      [
        { content: 'Make a plan.', role: 'user' },
        { content: 'Here is the plan.', role: 'assistant' },
      ],
    );
    assert.ok(
      historyBody.messages[1]!.timestamp > historyBody.messages[0]!.timestamp,
    );
  } finally {
    await harness.close();
  }
});

test('control: reset clears sessions, journal, and scenario', async () => {
  const harness = await startVoiceHarness({ controlPort: 0, gatewayPort: 0 });
  try {
    const jar = await signIn(harness);
    const rpc = await openRpc(harness, jar);
    await rpc.call('session.create', {});
    rpc.close();

    await loadScenario(harness, { transcripts: ['scripted'] });
    const reset = await fetch(`${harness.controlUrl}/control/reset`, {
      method: 'POST',
    });
    assert.equal(reset.status, 200);

    const status = await fetch(`${harness.controlUrl}/control/status`);
    const statusBody = (await status.json()) as { sessions: number };
    assert.equal(statusBody.sessions, 0);

    // Reset also invalidates issued tokens; the client must sign in again.
    const stale = await api(harness, jar, '/api/auth/me');
    assert.equal(stale.status, 401);
  } finally {
    await harness.close();
  }
});
