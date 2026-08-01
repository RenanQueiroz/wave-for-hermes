import assert from 'node:assert/strict';
import test from 'node:test';

import {
  WaveEndRealtimeCallResponseSchema,
  WaveErrorResponseSchema,
  WaveRealtimeVoiceListResponseSchema,
  WaveStartRealtimeCallResponseSchema,
  WaveStatusResponseSchema,
  type WaveRealtimeVoiceId,
} from '@wave/contracts';

import { buildCompanionServer } from '../src/app.ts';
import { SqliteDeviceStore } from '../src/auth/sqlite-device-store.ts';
import type { CompanionConfig } from '../src/config.ts';
import type {
  HermesClient,
  HermesStreamEvent,
} from '../src/hermes/hermes-types.ts';
import { HermesClientError } from '../src/hermes/hermes-errors.ts';
import { RealtimeCallRegistry } from '../src/realtime/realtime-call-registry.ts';
import type {
  RealtimeFunctionCall,
  RealtimeProvider,
  RealtimeProviderCall,
  RealtimeSideband,
} from '../src/realtime/realtime-provider.ts';

const NOW = new Date('2026-07-30T04:00:00.000Z');
const config: CompanionConfig = {
  databasePath: ':memory:',
  hermes: {
    baseUrl: 'https://hermes.example.test',
    bearerToken: 'server-only-hermes-key',
  },
  hermesFirstEventTimeoutMs: 30_000,
  hermesIdleTimeoutMs: 60_000,
  hermesTotalTimeoutMs: 600_000,
  host: '127.0.0.1',
  maxActiveRealtimeCalls: 2,
  maxActiveTurns: 4,
  pairingCodeTtlSeconds: 600,
  port: 8787,
  realtimeCallTtlMs: 1_800_000,
  realtimeToolTimeoutMs: 120_000,
  turnResumeWindowMs: 120_000,
};
const SDP_OFFER = 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n';

test('authenticates Realtime call setup and returns only Wave-owned call state', async () => {
  const store = new SqliteDeviceStore(':memory:', { now: () => NOW });
  const hermes = createHermesClient();
  const provider = new FakeRealtimeProvider();
  const registry = new RealtimeCallRegistry(
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
      provider,
    },
    {
      createId: () => 'wave-call-1',
      now: () => NOW,
    },
  );
  const app = buildCompanionServer(config, {
    deviceStore: store,
    hermesClient: hermes,
    now: () => NOW,
    realtimeCallRegistry: registry,
  });
  const first = pairDevice(store, 'First Realtime device');
  const second = pairDevice(store, 'Second Realtime device');

  const status = WaveStatusResponseSchema.parse(
    (
      await app.inject({
        method: 'GET',
        url: '/v1/status',
      })
    ).json(),
  );
  assert.equal(status.features.realtime, true);

  const unauthorizedVoices = await app.inject({
    method: 'GET',
    url: '/v1/realtime/voices',
  });
  assert.equal(unauthorizedVoices.statusCode, 401);

  const voicesResponse = await app.inject({
    headers: authorizationHeader(first.credential),
    method: 'GET',
    url: '/v1/realtime/voices',
  });
  assert.equal(voicesResponse.statusCode, 200);
  const voices = WaveRealtimeVoiceListResponseSchema.parse(
    voicesResponse.json(),
  );
  assert.equal(voices.defaultVoiceId, 'marin');
  assert.equal(voices.voices.length, 10);
  assert.equal(
    voices.voices.some((voice) => voice.id === 'cedar'),
    true,
  );

  const unauthorized = await app.inject({
    method: 'POST',
    payload: { sdpOffer: SDP_OFFER },
    url: '/v1/sessions/hermes-session-1/realtime/calls',
  });
  assert.equal(unauthorized.statusCode, 401);
  assert.equal(provider.createCalls, 0);

  const crossSession = await app.inject({
    headers: authorizationHeader(first.credential),
    method: 'POST',
    payload: { sdpOffer: SDP_OFFER },
    url: '/v1/sessions/not-authorized/realtime/calls',
  });
  assert.equal(crossSession.statusCode, 404);
  assert.equal(provider.createCalls, 0);

  const createdResponse = await app.inject({
    headers: authorizationHeader(first.credential),
    method: 'POST',
    payload: { sdpOffer: SDP_OFFER, voiceId: 'cedar' },
    url: '/v1/sessions/hermes-session-1/realtime/calls',
  });
  assert.equal(createdResponse.statusCode, 201);
  const created = WaveStartRealtimeCallResponseSchema.parse(
    createdResponse.json(),
  );
  assert.deepEqual(created.call, {
    expiresAt: '2026-07-30T04:30:00.000Z',
    id: 'wave-call-1',
    sdpAnswer: 'v=0\r\no=- 2 3 IN IP4 127.0.0.1\r\n',
  });
  assert.equal(createdResponse.body.includes('rtc_provider_call'), false);
  assert.equal(createdResponse.body.includes('server-only'), false);
  assert.equal(provider.createCalls, 1);
  assert.equal(provider.lastVoice, 'cedar');

  const crossDeviceEnd = await app.inject({
    headers: authorizationHeader(second.credential),
    method: 'POST',
    url: '/v1/realtime/calls/wave-call-1/end',
  });
  assert.equal(crossDeviceEnd.statusCode, 404);

  const endedResponse = await app.inject({
    headers: authorizationHeader(first.credential),
    method: 'POST',
    url: '/v1/realtime/calls/wave-call-1/end',
  });
  assert.equal(endedResponse.statusCode, 200);
  assert.deepEqual(
    WaveEndRealtimeCallResponseSchema.parse(endedResponse.json()),
    {
      apiVersion: 'v1',
      callId: 'wave-call-1',
      requestId: endedResponse.json().requestId,
      status: 'ended',
    },
  );
  assert.equal(provider.endedCalls, 1);

  await app.close();
  store.close();
});

test('serves authorized bounded voice samples with a model-keyed version', async () => {
  const store = new SqliteDeviceStore(':memory:', { now: () => NOW });
  const hermes = createHermesClient();
  const registry = new RealtimeCallRegistry(
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
      provider: new FakeRealtimeProvider(),
    },
  );
  const sample = Buffer.from('RIFF-fake-wave-bytes');
  const sampledVoices: WaveRealtimeVoiceId[] = [];
  const app = buildCompanionServer(config, {
    deviceStore: store,
    hermesClient: hermes,
    now: () => NOW,
    realtimeCallRegistry: registry,
    realtimeVoiceSampler: {
      getSample: async (voice) => {
        sampledVoices.push(voice);
        return sample;
      },
      samplesVersion: 'model4a1b2c3d',
    },
  });
  const paired = pairDevice(store, 'Preview device');

  const catalog = WaveRealtimeVoiceListResponseSchema.parse(
    (
      await app.inject({
        headers: authorizationHeader(paired.credential),
        method: 'GET',
        url: '/v1/realtime/voices',
      })
    ).json(),
  );
  assert.equal(catalog.samplesVersion, 'model4a1b2c3d');

  const unauthorized = await app.inject({
    method: 'GET',
    url: '/v1/realtime/voices/marin/sample',
  });
  assert.equal(unauthorized.statusCode, 401);
  assert.equal(sampledVoices.length, 0);

  const unknownVoice = await app.inject({
    headers: authorizationHeader(paired.credential),
    method: 'GET',
    url: '/v1/realtime/voices/not-a-voice/sample',
  });
  assert.equal(unknownVoice.statusCode, 400);
  assert.equal(
    WaveErrorResponseSchema.parse(unknownVoice.json()).error.code,
    'bad_request',
  );

  const response = await app.inject({
    headers: authorizationHeader(paired.credential),
    method: 'GET',
    url: '/v1/realtime/voices/marin/sample',
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['content-type'], 'audio/wav');
  assert.deepEqual(response.rawPayload, sample);
  assert.deepEqual(sampledVoices, ['marin']);

  await app.close();
  store.close();
});

test('keeps voice samples unavailable without a configured sampler', async () => {
  const store = new SqliteDeviceStore(':memory:', { now: () => NOW });
  const hermes = createHermesClient();
  const registry = new RealtimeCallRegistry(
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
      provider: new FakeRealtimeProvider(),
    },
  );
  const app = buildCompanionServer(config, {
    deviceStore: store,
    hermesClient: hermes,
    now: () => NOW,
    realtimeCallRegistry: registry,
  });
  const paired = pairDevice(store, 'No-sampler device');

  const catalog = WaveRealtimeVoiceListResponseSchema.parse(
    (
      await app.inject({
        headers: authorizationHeader(paired.credential),
        method: 'GET',
        url: '/v1/realtime/voices',
      })
    ).json(),
  );
  assert.equal(catalog.samplesVersion, undefined);

  const response = await app.inject({
    headers: authorizationHeader(paired.credential),
    method: 'GET',
    url: '/v1/realtime/voices/marin/sample',
  });
  assert.equal(response.statusCode, 503);
  assert.equal(
    WaveErrorResponseSchema.parse(response.json()).error.code,
    'upstream_unavailable',
  );

  await app.close();
  store.close();
});

test('keeps Realtime unavailable when the server OpenAI credential is absent', async () => {
  const store = new SqliteDeviceStore(':memory:', { now: () => NOW });
  const hermes = createHermesClient();
  const app = buildCompanionServer(config, {
    deviceStore: store,
    hermesClient: hermes,
    now: () => NOW,
  });
  const paired = pairDevice(store, 'Text-only device');

  const status = WaveStatusResponseSchema.parse(
    (
      await app.inject({
        method: 'GET',
        url: '/v1/status',
      })
    ).json(),
  );
  assert.equal(status.features.realtime, false);

  const response = await app.inject({
    headers: authorizationHeader(paired.credential),
    method: 'POST',
    payload: { sdpOffer: SDP_OFFER },
    url: '/v1/sessions/hermes-session-1/realtime/calls',
  });
  assert.equal(response.statusCode, 503);
  const error = WaveErrorResponseSchema.parse(response.json()).error;
  assert.equal(error.code, 'upstream_unavailable');
  assert.equal(error.retryable, false);

  await app.close();
  store.close();
});

class FakeRealtimeProvider implements RealtimeProvider {
  createCalls = 0;
  endedCalls = 0;
  lastVoice?: WaveRealtimeVoiceId;

  async createCall(input: {
    voice: WaveRealtimeVoiceId;
  }): Promise<RealtimeProviderCall> {
    this.createCalls += 1;
    this.lastVoice = input.voice;
    const sideband = new FakeRealtimeSideband();
    return {
      end: async () => {
        this.endedCalls += 1;
        sideband.close();
      },
      sdpAnswer: 'v=0\r\no=- 2 3 IN IP4 127.0.0.1\r\n',
      sideband,
    };
  }
}

class FakeRealtimeSideband implements RealtimeSideband {
  private readonly closeListeners = new Set<() => void>();

  close() {
    for (const listener of this.closeListeners) {
      listener();
    }
  }

  onClose(listener: () => void) {
    this.closeListeners.add(listener);
  }

  onAssistantTranscript() {}

  onError() {}

  onFunctionCall(_listener: (call: RealtimeFunctionCall) => void) {}

  onUserItem() {}

  onUserTranscript() {}

  sendFunctionResult() {
    return true;
  }
}

function createHermesClient(): HermesClient {
  return {
    async createSession() {
      return { id: 'unused' };
    },
    async deleteSession() {
      return false;
    },
    async getSession(sessionId) {
      if (sessionId !== 'hermes-session-1') {
        throw new HermesClientError('Session not found.', {
          kind: 'not_found',
          status: 404,
        });
      }
      return { id: sessionId };
    },
    async getSessionMessages() {
      return [];
    },
    async listSessions() {
      return {
        hasMore: false,
        limit: 50,
        offset: 0,
        sessions: [],
      };
    },
    async listScheduledJobs() {
      return [];
    },
    async probeCapabilities() {
      return {
        capabilities: {
          auth: { required: true, type: 'bearer' },
          endpoints: {},
          features: {},
          model: 'test',
          object: 'hermes.api_server.capabilities',
          platform: 'hermes-agent',
        },
        missingEndpoints: [],
        missingFeatures: [],
        supported: true,
      };
    },
    async stopRun() {},
    streamChat() {
      return emptyHermesStream();
    },
    async updateSession() {
      return { id: 'unused' };
    },
  };
}

async function* emptyHermesStream(): AsyncGenerator<HermesStreamEvent> {
  return;
}

function pairDevice(store: SqliteDeviceStore, name: string) {
  const pairing = store.issuePairingCode(new Date('2026-07-30T04:10:00.000Z'));
  const paired = store.redeemPairingCode(pairing.code, name);
  assert.ok(paired);
  return paired;
}

function authorizationHeader(credential: string) {
  return {
    authorization: `Bearer ${credential}`,
  };
}
