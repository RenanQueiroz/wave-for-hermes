/**
 * Integration proof for the voice harness: the real GatewayClient, over real
 * HTTP and WebSockets, against `tools/voice-harness`'s fake gateway.
 *
 * The harness ships compiled (its dist/ is gitignored), so these tests skip
 * when it has not been built. Build once with `npm run harness:build`; after
 * that, plain `npm test` exercises this file.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { signInWithPassword } from '../../src/services/gateway/gateway-auth.ts';
import { GatewayClient } from '../../src/services/gateway/gateway-client.ts';
import type {
  SpeechPlaybackOwner,
  SpeechPlaybackStatus,
} from '../../src/services/gateway/gateway-speech-stream.ts';
import { WaveBackendError } from '../../src/services/wave/wave-backend-error.ts';
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
  const journalEntries = async () => {
    const response = await fetch(`${harness.controlUrl}/control/journal`);
    return (
      (await response.json()) as {
        entries: { detail: Record<string, unknown>; kind: string }[];
      }
    ).entries;
  };
  return { ...harness, journalEntries, loadScenario };
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
  let rotations = 0;
  const client = new GatewayClient({
    baseUrl: harness.gatewayUrl,
    onTokensRotated: () => {
      rotations += 1;
    },
    tokens,
  });
  return { client, rotations: () => rotations };
}

class DrainingFakePlayer implements SpeechPlaybackOwner {
  writtenBytes = 0;
  private listeners = new Set<(event: SpeechPlaybackStatus) => void>();
  private playedFrames = 0;

  async start(): Promise<void> {
    this.playedFrames = 0;
  }

  write(chunk: Uint8Array): void {
    this.writtenBytes += chunk.byteLength;
    // Report everything written as already played so admission never stalls.
    this.playedFrames += chunk.byteLength / 2;
    const event: SpeechPlaybackStatus = {
      playedFrames: this.playedFrames,
      queuedDurationMs: 0,
      state: 'playing',
    };
    for (const listener of this.listeners) listener(event);
  }

  async finish(): Promise<{ outcome: string }> {
    return { outcome: 'drained' };
  }

  async stop(): Promise<unknown> {
    return undefined;
  }

  subscribe(listener: (event: SpeechPlaybackStatus) => void) {
    this.listeners.add(listener);
    return { remove: () => this.listeners.delete(listener) };
  }
}

test(
  'GatewayClient signs in, probes identity, and harvests rotations',
  { skip },
  async () => {
    const harness = await startHarness();
    try {
      const { client, rotations } = await signedInClient(harness);
      const identity = await client.getIdentity();
      assert.equal(identity.userId, 'harness-user');
      assert.ok(rotations() >= 1, 'the rotated cookie pair must be harvested');
      const baseline = await client.getCompatibilityBaseline();
      assert.equal(baseline.version, '0.20.5');
    } finally {
      await harness.close();
    }
  },
);

test(
  'streamTurn creates a session, streams scripted frames, and accepts a mid-turn redirect',
  { skip },
  async () => {
    const harness = await startHarness();
    try {
      const { client } = await signedInClient(harness);
      await harness.loadScenario({
        turns: [
          {
            frames: [
              { type: 'message.start' },
              { payload: { text: 'Working on it. ' }, type: 'message.delta' },
              // The hold keeps the turn open long enough for the redirect.
              {
                delayMs: 400,
                payload: { text: 'Done now.' },
                type: 'message.delta',
              },
              {
                payload: {
                  status: 'complete',
                  text: 'Working on it. Done now.',
                },
                type: 'message.complete',
              },
            ],
          },
        ],
      });

      const pendingId = `${PENDING_SESSION_PREFIX}integration`;
      const events: { content?: string; type: string }[] = [];
      let redirectStatus = '';
      for await (const event of client.streamTurn(pendingId, 'start the job')) {
        events.push({
          type: event.type,
          ...('content' in event && typeof event.content === 'string'
            ? { content: event.content }
            : {}),
        });
        if (event.type === 'assistant.delta' && !redirectStatus) {
          const redirect = await client.redirectTurn(pendingId, 'also do this');
          redirectStatus = redirect.status;
        }
      }
      assert.equal(redirectStatus, 'redirected');
      assert.equal(events[0]?.type, 'turn.started');
      assert.equal(events.at(-1)?.type, 'turn.completed');
      const completed = events.find(
        (event) => event.type === 'assistant.completed',
      );
      assert.equal(completed?.content, 'Working on it. Done now.');

      // The stored timeline shows the prompt, the accepted correction, and the
      // assistant reply — the same reconciliation a device performs.
      const timeline = await client.getSessionTimeline(pendingId, {});
      const rows = timeline.entries.flatMap((entry) =>
        entry.type === 'message'
          ? [[entry.message.role, entry.message.content]]
          : [],
      );
      assert.deepEqual(rows, [
        ['user', 'start the job'],
        ['user', 'also do this'],
        ['assistant', 'Working on it. Done now.'],
      ]);

      const journal = await harness.journalEntries();
      const redirect = journal.find(
        (entry) => entry.kind === 'session.redirect',
      );
      assert.equal(redirect?.detail.text, 'also do this');
    } finally {
      await harness.close();
    }
  },
);

test(
  'a queued redirect drains as a follow-on turn the open stream keeps translating',
  { skip },
  async () => {
    const harness = await startHarness();
    try {
      const { client } = await signedInClient(harness);
      await harness.loadScenario({
        redirects: [{ status: 'queued' }],
        turns: [
          {
            frames: [
              { type: 'message.start' },
              {
                delayMs: 300,
                payload: { status: 'complete', text: 'First answer.' },
                type: 'message.complete',
              },
            ],
          },
          { reply: 'Follow-on answer.' },
        ],
      });
      const pendingId = `${PENDING_SESSION_PREFIX}follow-on`;
      let queuedFollowOns = 0;
      const completions: string[] = [];
      let turnsCompleted = 0;
      for await (const event of client.streamTurn(
        pendingId,
        'first job',
        undefined,
        { followOn: () => queuedFollowOns-- > 0 },
      )) {
        if (event.type === 'turn.started' && turnsCompleted === 0) {
          if (queuedFollowOns === 0 && completions.length === 0) {
            const redirect = await client.redirectTurn(
              pendingId,
              'run this next',
            );
            assert.equal(redirect.status, 'queued');
            queuedFollowOns += 1;
          }
        }
        if (event.type === 'assistant.completed') {
          completions.push(event.content);
        }
        if (event.type === 'turn.completed') turnsCompleted += 1;
      }
      assert.equal(turnsCompleted, 2, 'the stream translated both turns');
      assert.deepEqual(completions, ['First answer.', 'Follow-on answer.']);
      const journal = await harness.journalEntries();
      const drained = journal.find((entry) => entry.kind === 'turn.drain');
      assert.equal(drained?.detail.text, 'run this next');
    } finally {
      await harness.close();
    }
  },
);

test(
  'redirectTurn surfaces scripted queued/race outcomes the way Wave maps them',
  { skip },
  async () => {
    const harness = await startHarness();
    try {
      const { client } = await signedInClient(harness);
      await harness.loadScenario({
        redirects: [{ status: 'queued' }, { errorCode: 4009 }],
        turns: [
          {
            frames: [
              { type: 'message.start' },
              {
                delayMs: 600,
                payload: { status: 'complete', text: 'ok' },
                type: 'message.complete',
              },
            ],
          },
        ],
      });
      const pendingId = `${PENDING_SESSION_PREFIX}races`;
      let sawQueued = false;
      let conflictKind = '';
      for await (const event of client.streamTurn(pendingId, 'busy work')) {
        if (event.type === 'turn.started') {
          const queued = await client.redirectTurn(pendingId, 'first steer');
          sawQueued = queued.status === 'queued';
          conflictKind = await client
            .redirectTurn(pendingId, 'second steer')
            .then(() => 'none')
            .catch((error: unknown) =>
              error instanceof WaveBackendError ? error.kind : 'unexpected',
            );
        }
      }
      assert.equal(sawQueued, true);
      assert.equal(conflictKind, 'conflict');
    } finally {
      await harness.close();
    }
  },
);

test(
  'audio surfaces: scripted transcription, buffered speech, capabilities',
  { skip },
  async () => {
    const harness = await startHarness();
    try {
      const { client } = await signedInClient(harness);
      await harness.loadScenario({ transcripts: ['play some jazz'] });

      const transcription = await client.transcribeAudio({
        dataUrl: 'data:audio/m4a;base64,AAAA',
        mimeType: 'audio/m4a',
      });
      assert.equal(transcription.transcript, 'play some jazz');

      const speech = await client.speakText('read this aloud');
      assert.equal(speech.mimeType, 'audio/wav');
      assert.ok(speech.dataUrl.startsWith('data:audio/wav;base64,'));

      const capabilities = await client.getAudioCapabilities();
      assert.deepEqual(capabilities, { stt: true, tts: true });
    } finally {
      await harness.close();
    }
  },
);

test(
  'speech stream session completes against the harness PCM stream',
  { skip },
  async () => {
    const harness = await startHarness();
    try {
      const { client } = await signedInClient(harness);
      const player = new DrainingFakePlayer();
      const stream = client.openSpeechStream({ player });
      stream.appendText('Hello there, this is streamed narration.');
      stream.finishText();
      const result = await stream.result();
      assert.deepEqual(result, { outcome: 'completed' });
      assert.ok(player.writtenBytes > 0, 'PCM must reach the playback owner');
    } finally {
      await harness.close();
    }
  },
);
