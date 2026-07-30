import { buildCompanionServer } from '../src/app.ts';
import { SqliteDeviceStore } from '../src/auth/sqlite-device-store.ts';
import type { CompanionConfig } from '../src/config.ts';
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
  maxActiveTurns: 4,
  pairingCodeTtlSeconds: 600,
  port,
};
const app = buildCompanionServer(config, {
  deviceStore: store,
  hermesClient: hermes,
});
let closing = false;

try {
  await app.listen({ host, port });
  const pairing = store.issuePairingCode(
    new Date(Date.now() + config.pairingCodeTtlSeconds * 1_000),
  );
  console.log(`Wave mobile fixture listening on http://${displayHost(host)}:${port}`);
  console.log(`Pairing code: ${pairing.code}`);
  console.log(`Expires at: ${pairing.expiresAt}`);
  console.log('This fixture is development-only and keeps all state in memory.');
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

function displayHost(value: string) {
  return value === '0.0.0.0' || value === '::' ? '<host-address>' : value;
}

function parsePort(value: string | undefined) {
  if (!value) return 8787;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error('WAVE_FIXTURE_PORT must be an integer from 1 through 65535.');
  }
  return parsed;
}

function createFixtureHermesClient(): HermesClient {
  const sessions: HermesSessionSummary[] = [];
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
      return session;
    },
    async getSessionMessages(
      sessionId: string,
    ): Promise<HermesConversationMessage[]> {
      return [
        {
          content: 'Hello from the development-only Hermes fixture.',
          id: 'fixture-message-1',
          role: 'assistant',
          sessionId,
          timestamp: Math.floor(Date.now() / 1_000),
        },
      ];
    },
    async listSessions(): Promise<HermesSessionSummary[]> {
      return sessions;
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
      _input: HermesStreamChatInput,
    ): AsyncGenerator<HermesStreamEvent> {
      const timestamp = Math.floor(Date.now() / 1_000);
      const base = {
        runId: 'fixture-run',
        sequence: 0,
        sessionId,
        timestamp,
      };
      yield {
        ...base,
        messageId: 'fixture-assistant',
        type: 'message.started',
      };
      yield {
        ...base,
        delta: 'Fixture response',
        messageId: 'fixture-assistant',
        sequence: 1,
        type: 'assistant.delta',
      };
      yield {
        ...base,
        content: 'Fixture response',
        interrupted: false,
        messageId: 'fixture-assistant',
        partial: false,
        sequence: 2,
        type: 'assistant.completed',
      };
      yield {
        ...base,
        completed: true,
        messageId: 'fixture-assistant',
        sequence: 3,
        type: 'run.completed',
      };
      yield {
        ...base,
        sequence: 4,
        type: 'done',
      };
    },
  };
}
