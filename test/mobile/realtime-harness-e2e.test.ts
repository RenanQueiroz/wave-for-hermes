/**
 * End-to-end proof of Realtime harness mode: the real WaveRealtimeController,
 * OpenAiRealtimeBackend, sideband, orchestrator, and gateway executors run a
 * scripted voice call against `tools/voice-harness` — both fakes at once, no
 * microphone, no OpenAI, no key.
 *
 * Skips until the harness is built (`npm run harness:build`).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { createRealtimeHarnessOverrides } from '../../src/dev/realtime-harness-impl.ts';
import { createGatewayAskHermesExecutor } from '../../src/features/realtime/gateway-ask-hermes-executor.ts';
import { createGatewayCorrectHermesExecutor } from '../../src/features/realtime/gateway-correct-hermes-executor.ts';
import { WaveRealtimeController } from '../../src/features/realtime/realtime-controller.ts';
import { signInWithPassword } from '../../src/services/gateway/gateway-auth.ts';
import { GatewayClient } from '../../src/services/gateway/gateway-client.ts';
import { OpenAiRealtimeBackend } from '../../src/services/realtime/openai-realtime-backend.ts';
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

async function until(
  predicate: () => boolean | Promise<boolean>,
  label: string,
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for ${label}`);
}

test(
  'a scripted realtime call delegates to Hermes through the fakes end-to-end',
  { skip },
  async () => {
    if (!harnessModule) throw new Error('harness unavailable');
    const harness = await harnessModule.startVoiceHarness({
      controlPort: 0,
      gatewayPort: 0,
    });
    try {
      const journalEntries = async () => {
        const response = await fetch(`${harness.controlUrl}/control/journal`);
        return (
          (await response.json()) as {
            entries: { detail: Record<string, unknown>; kind: string }[];
          }
        ).entries;
      };
      const scenario = await fetch(`${harness.controlUrl}/control/scenario`, {
        body: JSON.stringify({
          realtimeCalls: [
            {
              script: [
                {
                  transcript: 'Turn off the kitchen lights',
                  type: 'user_speech',
                },
                {
                  arguments: { instruction: 'Turn off the kitchen lights' },
                  name: 'ask_hermes',
                  type: 'function_call',
                },
                { type: 'wait_function_result' },
                {
                  text: 'Done — the kitchen lights are off.',
                  type: 'assistant_speech',
                },
              ],
            },
          ],
          turns: [{ reply: 'The kitchen lights are off now.' }],
        }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      });
      assert.equal(scenario.status, 200);

      const tokens = await signInWithPassword(
        {
          baseUrl: harness.gatewayUrl,
          password: 'secret',
          provider: 'password',
          username: 'tester',
        },
        globalThis.fetch,
      );
      const client = new GatewayClient({ baseUrl: harness.gatewayUrl, tokens });
      const sessionId = `${PENDING_SESSION_PREFIX}realtime-e2e`;

      const overrides = createRealtimeHarnessOverrides(harness.gatewayUrl);
      const backend = new OpenAiRealtimeBackend({
        // Stand-in for a real saved key; the override fetch must replace it
        // with the dummy bearer or the fake rejects the call outright.
        apiKey: 'sk-user-saved-key-that-must-never-cross-000000',
        executeAskHermes: createGatewayAskHermesExecutor({ client, sessionId }),
        executeCorrectHermes: createGatewayCorrectHermesExecutor({
          client,
          sessionId,
        }),
        fetchImpl: overrides.fetchImpl,
        socketFactory: overrides.socketFactory,
      });
      const controller = new WaveRealtimeController({
        backend,
        transport: overrides.transport,
      });

      await controller.start(sessionId);
      await until(
        () =>
          controller.getState().phase !== 'idle' &&
          controller.getState().phase !== 'connecting',
        'the call to establish',
      );

      // The scripted model called ask_hermes; the real orchestrator ran it
      // against the fake gateway and delivered the answer as a function
      // result on the sideband.
      await until(
        async () =>
          (await journalEntries()).some(
            (entry) =>
              entry.kind === 'realtime.item.create' &&
              entry.detail.itemType === 'function_call_output' &&
              String(entry.detail.output).includes(
                'The kitchen lights are off now.',
              ),
          ),
        'the Hermes answer to reach the realtime session',
      );

      // Tool surface: active snapshot while Hermes worked, idle afterward.
      await until(async () => {
        const updates = (await journalEntries())
          .filter((entry) => entry.kind === 'realtime.session.update')
          .map((entry) => entry.detail.toolNames);
        return (
          updates.length === 2 &&
          updates[0] === 'ask_hermes,correct_hermes' &&
          updates[1] === 'ask_hermes'
        );
      }, 'both tool-surface updates');

      // Transcripts flowed through the scripted transport tee.
      await until(
        () =>
          controller.getState().userTranscript ===
            'Turn off the kitchen lights' &&
          controller.getState().assistantTranscript ===
            'Done — the kitchen lights are off.',
        'both transcripts',
      );

      // The fake gateway received the delegated work as an ordinary turn.
      const journal = await journalEntries();
      const submit = journal.find(
        (entry) =>
          entry.kind === 'rpc.call' &&
          entry.detail.method === 'prompt.submit' &&
          String(entry.detail.params).includes('Turn off the kitchen lights'),
      );
      assert.ok(submit, 'prompt.submit must carry the instruction');
      const callStart = journal.find(
        (entry) => entry.kind === 'realtime.call.start',
      );
      assert.equal(
        callStart?.detail.toolNames,
        'ask_hermes',
        'the initial call config advertises the idle tool surface',
      );

      await controller.stop();
      assert.equal(controller.getState().phase, 'idle');
      await until(
        async () =>
          (await journalEntries()).some(
            (entry) => entry.kind === 'realtime.call.hangup',
          ),
        'the hangup to reach the fake',
      );
    } finally {
      await harness.close();
    }
  },
);
