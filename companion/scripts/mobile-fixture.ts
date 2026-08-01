import type { WaveRealtimeVoiceId } from '@wave/contracts';

import { buildCompanionServer } from '../src/app.ts';
import { SqliteDeviceStore } from '../src/auth/sqlite-device-store.ts';
import type { CompanionConfig } from '../src/config.ts';
import { RealtimeCallRegistry } from '../src/realtime/realtime-call-registry.ts';
import {
  RealtimeProviderError,
  type RealtimeProvider,
} from '../src/realtime/realtime-provider.ts';
import { wrapPcmInWav } from '../src/realtime/realtime-voice-sampler.ts';
import type {
  HermesCapabilityReport,
  HermesClient,
  HermesConversationMessage,
  HermesCreateSessionInput,
  HermesSessionSummary,
  HermesStreamChatInput,
  HermesStreamEvent,
} from '../src/hermes/hermes-types.ts';

const host = process.env.WAVE_FIXTURE_HOST?.trim() || '127.0.0.1';
const port = parsePort(process.env.WAVE_FIXTURE_PORT);
const cancellationPrompt = 'Cancel the Wave chat fixture';
const store = new SqliteDeviceStore(':memory:');
const hermes = createFixtureHermesClient();
const config: CompanionConfig = {
  databasePath: ':memory:',
  hermes: {
    baseUrl: 'https://fixture.hermes.invalid',
    bearerToken: 'fixture-not-a-real-credential',
  },
  hermesFirstEventTimeoutMs: 30_000,
  hermesIdleTimeoutMs: 60_000,
  hermesTotalTimeoutMs: 600_000,
  host,
  maxActiveRealtimeCalls: 2,
  maxActiveTurns: 4,
  pairingCodeTtlSeconds: 600,
  port,
  realtimeCallTtlMs: 1_800_000,
  realtimeToolTimeoutMs: 120_000,
  turnResumeWindowMs: 120_000,
};
// The fixture cannot reach OpenAI, so live calls stay unavailable while the
// voice catalog and previews work end to end with locally synthesized tones.
const fixtureRealtimeProvider: RealtimeProvider = {
  createCall: async () => {
    throw new RealtimeProviderError(
      'The Wave mobile fixture cannot create live Realtime calls.',
      { kind: 'unavailable' },
    );
  },
};
const app = buildCompanionServer(config, {
  deviceStore: store,
  hermesClient: hermes,
  realtimeCallRegistry: new RealtimeCallRegistry(
    {
      callTtlMs: config.realtimeCallTtlMs,
      defaultVoiceId: 'marin',
      maxActiveCalls: config.maxActiveRealtimeCalls,
      toolTimeoutMs: config.realtimeToolTimeoutMs,
    },
    {
      deviceStore: store,
      hermesClient: hermes,
      interactionStore: store,
      provider: fixtureRealtimeProvider,
    },
  ),
  realtimeVoiceSampler: {
    getSample: async (voice) => createFixtureToneSample(voice),
    samplesVersion: 'fixture-tones-1',
  },
});
let closing = false;

try {
  await app.listen({ host, port });
  const pairing = store.issuePairingCode(
    new Date(Date.now() + config.pairingCodeTtlSeconds * 1_000),
  );
  console.log(
    `Wave mobile fixture listening on http://${displayHost(host)}:${port}`,
  );
  console.log(`Pairing code: ${pairing.code}`);
  console.log(`Expires at: ${pairing.expiresAt}`);
  console.log(
    'This fixture is development-only and keeps all state in memory.',
  );
} catch (error) {
  store.close();
  throw error;
}

process.once('SIGINT', () => void close());
process.once('SIGTERM', () => void close());

async function close() {
  if (closing) return;
  closing = true;
  await app.close();
  store.close();
}

function createFixtureToneSample(voice: WaveRealtimeVoiceId) {
  const sampleRateHz = 24_000;
  const durationSeconds = 1.2;
  // A distinct pitch per voice keeps fixture previews tellable apart by ear.
  const voiceSeed = [...voice].reduce(
    (total, character) => total + character.charCodeAt(0),
    0,
  );
  const frequencyHz = 220 + ((60 * voiceSeed) % 660);
  const frameCount = Math.floor(sampleRateHz * durationSeconds);
  const pcm = Buffer.alloc(frameCount * 2);
  for (let frame = 0; frame < frameCount; frame += 1) {
    const fade = Math.min(1, (frameCount - frame) / (sampleRateHz * 0.1));
    const amplitude =
      Math.sin((2 * Math.PI * frequencyHz * frame) / sampleRateHz) * 0.3 * fade;
    pcm.writeInt16LE(Math.round(amplitude * 32_767), frame * 2);
  }
  return wrapPcmInWav(pcm, sampleRateHz);
}

function displayHost(value: string) {
  return value === '0.0.0.0' || value === '::' ? '<host-address>' : value;
}

function parsePort(value: string | undefined) {
  if (!value) return 8787;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error(
      'WAVE_FIXTURE_PORT must be an integer from 1 through 65535.',
    );
  }
  return parsed;
}

function createFixtureHermesClient(): HermesClient {
  const sessions: HermesSessionSummary[] = [];
  const messages = new Map<string, HermesConversationMessage[]>();
  let turnCount = 0;
  return {
    async createSession(
      input: HermesCreateSessionInput = {},
    ): Promise<HermesSessionSummary> {
      const session: HermesSessionSummary = {
        id: input.id ?? `fixture-session-${sessions.length + 1}`,
        messageCount: 0,
        startedAt: Math.floor(Date.now() / 1_000),
        title: input.title ?? 'Fixture conversation',
      };
      sessions.push(session);
      messages.set(session.id, []);
      return session;
    },
    async deleteSession(sessionId: string): Promise<boolean> {
      const index = sessions.findIndex((session) => session.id === sessionId);
      if (index < 0) return false;
      sessions.splice(index, 1);
      messages.delete(sessionId);
      return true;
    },
    async getSession(sessionId: string): Promise<HermesSessionSummary> {
      const session = sessions.find((candidate) => candidate.id === sessionId);
      if (!session) throw new Error('Fixture session not found.');
      return session;
    },
    async getSessionMessages(
      sessionId: string,
    ): Promise<HermesConversationMessage[]> {
      return [...(messages.get(sessionId) ?? [])];
    },
    async listScheduledJobs() {
      return [];
    },
    async listSessions(options = {}) {
      const limit = options.limit ?? 50;
      const offset = options.offset ?? 0;
      const page = sessions.slice(offset, offset + limit);
      return {
        hasMore: offset + page.length < sessions.length,
        limit,
        offset,
        sessions: page,
      };
    },
    async probeCapabilities(): Promise<HermesCapabilityReport> {
      return {
        capabilities: {
          auth: {
            required: true,
            type: 'bearer',
          },
          endpoints: {},
          features: {},
          model: 'fixture',
          object: 'hermes.api_server.capabilities',
          platform: 'hermes-agent',
        },
        missingEndpoints: [],
        missingFeatures: [],
        supported: true,
      };
    },
    async stopRun() {},
    async *streamChat(
      sessionId: string,
      input: HermesStreamChatInput,
    ): AsyncGenerator<HermesStreamEvent> {
      turnCount += 1;
      const timestamp = Math.floor(Date.now() / 1_000);
      const messageId = `fixture-assistant-${turnCount}`;
      const response = 'Fixture response from Hermes.';
      const toolCallId = `fixture-call-${turnCount}`;
      const toolInput = JSON.stringify({
        query: input.input,
      });
      const toolOutput = JSON.stringify({
        result: 'Development fixture lookup completed.',
      });
      const base = {
        runId: `fixture-run-${turnCount}`,
        sequence: 0,
        sessionId,
        timestamp,
      };
      yield {
        ...base,
        messageId,
        type: 'message.started',
      };
      if (input.input === cancellationPrompt) {
        yield {
          ...base,
          delta: 'Waiting for cancellation…',
          messageId,
          sequence: 1,
          type: 'assistant.delta',
        };
        await waitForFixtureCancellation(input.signal);
        yield {
          ...base,
          completed: false,
          sequence: 2,
          type: 'run.completed',
        };
        yield {
          ...base,
          sequence: 3,
          type: 'done',
        };
        return;
      }
      yield {
        ...base,
        delta: 'Fixture response ',
        messageId,
        sequence: 1,
        type: 'assistant.delta',
      };
      yield {
        ...base,
        messageId,
        sequence: 2,
        status: 'started',
        toolInput,
        toolName: 'fixture_lookup',
        type: 'tool',
      };
      yield {
        ...base,
        messageId,
        sequence: 3,
        status: 'completed',
        toolName: 'fixture_lookup',
        toolOutput,
        toolOutputIsPreview: true,
        type: 'tool',
      };
      yield {
        ...base,
        delta: 'from Hermes.',
        messageId,
        sequence: 4,
        type: 'assistant.delta',
      };
      yield {
        ...base,
        content: response,
        interrupted: false,
        messageId,
        partial: false,
        sequence: 5,
        type: 'assistant.completed',
      };
      yield {
        ...base,
        completed: true,
        messageId,
        sequence: 6,
        type: 'run.completed',
      };
      const history = messages.get(sessionId) ?? [];
      history.push(
        {
          content:
            typeof input.input === 'string'
              ? input.input
              : input.input
                  .flatMap((part) => (part.type === 'text' ? [part.text] : []))
                  .join('\n'),
          id: `fixture-user-${turnCount}`,
          role: 'user',
          sessionId,
          timestamp,
        },
        {
          content: '',
          id: `fixture-tool-call-${turnCount}`,
          role: 'assistant',
          sessionId,
          timestamp,
          toolCalls: [
            {
              arguments: toolInput,
              id: toolCallId,
              name: 'fixture_lookup',
            },
          ],
        },
        {
          content: toolOutput,
          id: `fixture-tool-${turnCount}`,
          role: 'tool',
          sessionId,
          timestamp,
          toolCallId,
          toolName: 'fixture_lookup',
        },
        {
          content: response,
          id: messageId,
          role: 'assistant',
          sessionId,
          timestamp,
        },
      );
      messages.set(sessionId, history);
      const session = sessions.find((candidate) => candidate.id === sessionId);
      if (session) {
        session.lastActive = timestamp;
        session.messageCount = history.length;
        session.preview = response;
        session.toolCallCount = (session.toolCallCount ?? 0) + 1;
      }
      yield {
        ...base,
        sequence: 7,
        type: 'done',
      };
    },
    async updateSession(sessionId, input) {
      const session = sessions.find((candidate) => candidate.id === sessionId);
      if (!session) throw new Error('Fixture session not found.');
      session.title = input.title;
      return session;
    },
  };
}

function waitForFixtureCancellation(signal: AbortSignal | undefined) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('The fixture turn was cancelled.'));
      return;
    }
    const onAbort = () => {
      clearTimeout(timeout);
      reject(new Error('The fixture turn was cancelled.'));
    };
    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, 60_000);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
