/**
 * Protocol-drift guard: the voice harness's live wire behavior must stay
 * within the recorded v0.20 shapes in `test/fixtures/gateway-compatibility.ts`.
 *
 * `gateway-protocol.test.ts` proves the app's normalizers accept the fixture;
 * this file proves the harness still emits those same shapes, so the fake and
 * the recorded protocol cannot drift apart silently. Like the integration
 * proof, it skips until the harness is built (`npm run harness:build`).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { GATEWAY_V020_FIXTURE } from '../fixtures/gateway-compatibility.ts';
import { signInWithPassword } from '../../src/services/gateway/gateway-auth.ts';
import { GatewayClient } from '../../src/services/gateway/gateway-client.ts';
import { PENDING_SESSION_PREFIX } from '../../src/services/wave/wave-chat-client.ts';

interface HarnessModule {
  startVoiceHarness(options?: {
    controlPort?: number;
    gatewayPort?: number;
  }): Promise<{
    close(): Promise<void>;
    controlUrl: string;
    gatewayUrl: string;
  }>;
}

// A computed specifier keeps tsc from requiring the built harness to exist.
const harnessSpecifier = '../../tools/voice-harness/dist/index.js';
const harnessModule: HarnessModule | undefined = await import(
  harnessSpecifier
).catch(() => undefined);
const skip = harnessModule
  ? false
  : 'voice harness is not built (npm run harness:build)';

async function startHarness() {
  if (!harnessModule) throw new Error('harness unavailable');
  const harness = await harnessModule.startVoiceHarness({
    controlPort: 0,
    gatewayPort: 0,
  });
  const loadScenario = async (scenario: unknown) => {
    const response = await fetch(`${harness.controlUrl}/control/scenario`, {
      body: JSON.stringify(scenario),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
    assert.equal(response.status, 200);
  };
  return { ...harness, loadScenario };
}

async function signedInClient(harness: { gatewayUrl: string }) {
  const tokens = await signInWithPassword(
    {
      baseUrl: harness.gatewayUrl,
      password: 'secret',
      provider: 'password',
      username: 'tester',
    },
    globalThis.fetch,
  );
  return new GatewayClient({ baseUrl: harness.gatewayUrl, tokens });
}

/** Raw cookie-jar sign-in for the wire-level assertions. */
async function rawSignIn(gatewayUrl: string) {
  const jar = new Map<string, string>();
  const harvest = (response: Response) => {
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(';');
      const separator = pair?.indexOf('=') ?? -1;
      if (!pair || separator <= 0) continue;
      jar.set(
        pair.slice(0, separator).trim(),
        pair.slice(separator + 1).trim(),
      );
    }
  };
  const login = await fetch(`${gatewayUrl}/auth/password-login`, {
    body: JSON.stringify({
      password: 'secret',
      provider: 'password',
      username: 'tester',
    }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });
  assert.equal(login.status, 200);
  harvest(login);
  const mintTicket = async () => {
    const response = await fetch(`${gatewayUrl}/api/auth/ws-ticket`, {
      headers: {
        cookie: [...jar.entries()]
          .map(([name, value]) => `${name}=${value}`)
          .join('; '),
      },
      method: 'POST',
    });
    assert.equal(response.status, 200);
    harvest(response);
    return ((await response.json()) as { ticket: string }).ticket;
  };
  return { mintTicket };
}

/** Collect the JSON frames of one WebSocket exchange until it closes. */
function openJsonSocket(url: string, onOpen: (socket: WebSocket) => void) {
  return new Promise<Record<string, unknown>[]>((resolve, reject) => {
    const frames: Record<string, unknown>[] = [];
    const socket = new WebSocket(url);
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error('socket timed out'));
    }, 5_000);
    socket.addEventListener('open', () => onOpen(socket));
    socket.addEventListener('message', (event) => {
      if (typeof event.data !== 'string') return;
      frames.push(JSON.parse(event.data) as Record<string, unknown>);
    });
    socket.addEventListener('close', () => {
      clearTimeout(timer);
      resolve(frames);
    });
    socket.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error('socket errored'));
    });
  });
}

test('/api/status keeps the fixture status shape', { skip }, async () => {
  const harness = await startHarness();
  try {
    const response = await fetch(`${harness.gatewayUrl}/api/status`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as Record<string, unknown>;
    for (const key of Object.keys(GATEWAY_V020_FIXTURE.status)) {
      assert.equal(typeof body[key], 'string', `status.${key} present`);
    }
    assert.equal(body.version, '0.20.5');
  } finally {
    await harness.close();
  }
});

test(
  'session.active_list rows stay within the fixture row shape',
  { skip },
  async () => {
    const harness = await startHarness();
    try {
      const client = await signedInClient(harness);
      await harness.loadScenario({ turns: [{ reply: 'ok' }] });
      const pendingId = `${PENDING_SESSION_PREFIX}active-list`;
      for await (const event of client.streamTurn(pendingId, 'hello')) {
        void event;
      }

      const { mintTicket } = await rawSignIn(harness.gatewayUrl);
      const wsBase = harness.gatewayUrl.replace(/^http/, 'ws');
      const frames = await openJsonSocket(
        `${wsBase}/api/ws?ticket=${await mintTicket()}`,
        (socket) => {
          socket.send(
            JSON.stringify({
              id: 1,
              jsonrpc: '2.0',
              method: 'session.active_list',
              params: {},
            }),
          );
          // The gateway greets with `gateway.ready` before answering
          // anything, so close on THIS request's reply rather than on the
          // first frame that happens to arrive.
          socket.addEventListener('message', (event) => {
            const frame = JSON.parse(String(event.data)) as { id?: unknown };
            if (frame.id === 1) socket.close();
          });
        },
      );

      const result = frames.find((frame) => frame.id === 1)?.result as
        { sessions: Record<string, unknown>[] } | undefined;
      assert.ok(result, 'active_list must respond');
      assert.ok(result.sessions.length >= 1);
      const fixtureKeys = new Set(
        GATEWAY_V020_FIXTURE.activeList.sessions.flatMap((row) =>
          Object.keys(row),
        ),
      );
      const fixtureStatuses = new Set<string>(
        GATEWAY_V020_FIXTURE.activeList.sessions.map((row) => row.status),
      );
      for (const row of result.sessions) {
        for (const key of Object.keys(row)) {
          assert.ok(fixtureKeys.has(key), `active_list key ${key} is recorded`);
        }
        assert.ok(
          fixtureStatuses.has(String(row.status)),
          `status ${String(row.status)} is in the recorded vocabulary`,
        );
      }
    } finally {
      await harness.close();
    }
  },
);

test(
  'session.redirect replays the fixture status vocabulary',
  { skip },
  async () => {
    const harness = await startHarness();
    try {
      const client = await signedInClient(harness);
      await harness.loadScenario({
        redirects: GATEWAY_V020_FIXTURE.redirectResults.map((row) => ({
          status: row.status,
        })),
        turns: [
          {
            frames: [
              { type: 'message.start' },
              {
                delayMs: 600,
                payload: { status: 'complete', text: 'done' },
                type: 'message.complete',
              },
            ],
          },
        ],
      });
      const pendingId = `${PENDING_SESSION_PREFIX}redirect-vocab`;
      const statuses: string[] = [];
      for await (const event of client.streamTurn(pendingId, 'busy work')) {
        if (event.type === 'turn.started') {
          for (const _row of GATEWAY_V020_FIXTURE.redirectResults) {
            const outcome = await client.redirectTurn(pendingId, 'steer text');
            statuses.push(outcome.status);
          }
        }
      }
      assert.deepEqual(
        statuses,
        GATEWAY_V020_FIXTURE.redirectResults.map((row) => row.status),
      );
    } finally {
      await harness.close();
    }
  },
);

test(
  'scripted fixture turn frames cross the real client as Wave events',
  { skip },
  async () => {
    const harness = await startHarness();
    try {
      const client = await signedInClient(harness);
      await harness.loadScenario({
        turns: [
          {
            frames: [
              { type: 'message.start' },
              ...GATEWAY_V020_FIXTURE.turnFrames.map((frame) => ({
                payload: { ...frame.payload },
                type: frame.type,
              })),
              {
                payload: { status: 'complete', text: 'Synthetic interim.' },
                type: 'message.complete',
              },
            ],
          },
        ],
      });
      const pendingId = `${PENDING_SESSION_PREFIX}fixture-frames`;
      const events: Record<string, unknown>[] = [];
      for await (const event of client.streamTurn(pendingId, 'replay')) {
        events.push(event as unknown as Record<string, unknown>);
      }
      const interim = events.find(
        (event) => event.type === 'assistant.interim',
      );
      assert.equal(interim?.content, 'Synthetic interim.');
      const tool = events.find((event) => event.type === 'tool.status');
      assert.equal(tool?.status, 'progress');
      assert.equal(tool?.toolName, 'search');
      const activity = events.find((event) => event.type === 'activity.status');
      assert.equal(activity?.status, 'compacting');
      // Interim reconciliation: the completion must not duplicate the text.
      const completed = events.find(
        (event) => event.type === 'assistant.completed',
      );
      assert.equal(completed?.content, 'Synthetic interim.');
    } finally {
      await harness.close();
    }
  },
);

test(
  'speak-stream control frames match the fixture shapes',
  { skip },
  async () => {
    const harness = await startHarness();
    try {
      const [startFrame, fallbackFrame, endFrame] =
        GATEWAY_V020_FIXTURE.speakStreamControlFrames;
      const { mintTicket } = await rawSignIn(harness.gatewayUrl);
      const wsBase = harness.gatewayUrl.replace(/^http/, 'ws');

      const streamed = await openJsonSocket(
        `${wsBase}/api/audio/speak-stream?ticket=${await mintTicket()}`,
        (socket) => {
          socket.send(JSON.stringify({ text: 'hello' }));
          socket.send(JSON.stringify({ done: true }));
        },
      );
      assert.deepEqual(streamed[0], { ...startFrame });
      assert.deepEqual(streamed.at(-1), { ...endFrame });

      await harness.loadScenario({ speech: { mode: 'fallback' } });
      const fallback = await openJsonSocket(
        `${wsBase}/api/audio/speak-stream?ticket=${await mintTicket()}`,
        (socket) => {
          // The harness answers a fallback-scripted socket immediately, but
          // never closes it itself: end the exchange after the first frame.
          socket.addEventListener('message', () => socket.close());
        },
      );
      assert.deepEqual(fallback[0], { ...fallbackFrame });
    } finally {
      await harness.close();
    }
  },
);
