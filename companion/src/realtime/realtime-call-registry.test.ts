import assert from 'node:assert/strict';
import test from 'node:test';

import type { WaveAskHermesToolResult } from '@wave/contracts';

import { SqliteDeviceStore } from '../auth/sqlite-device-store.ts';
import type {
  HermesCapabilityReport,
  HermesClient,
  HermesConversationMessage,
  HermesCreateSessionInput,
  HermesListSessionsOptions,
  HermesRequestOptions,
  HermesSessionSummary,
  HermesStreamChatInput,
  HermesStreamEvent,
} from '../hermes/hermes-types.ts';
import { WaveHttpError } from '../http/errors.ts';
import { RealtimeCallRegistry } from './realtime-call-registry.ts';
import type {
  RealtimeFunctionCall,
  RealtimeProvider,
  RealtimeProviderCall,
  RealtimeSideband,
} from './realtime-provider.ts';

const SDP_OFFER = 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n';
const SDP_ANSWER = 'v=0\r\no=- 2 3 IN IP4 127.0.0.1\r\n';

class FakeRealtimeSideband implements RealtimeSideband {
  closed = false;
  readonly results: {
    callId: string;
    result: WaveAskHermesToolResult;
  }[] = [];
  private readonly closeListeners = new Set<() => void>();
  private readonly functionCallListeners =
    new Set<(call: RealtimeFunctionCall) => void>();

  close() {
    if (this.closed) {
      return;
    }
    this.closed = true;
    for (const listener of this.closeListeners) {
      listener();
    }
  }

  emitFunctionCall(call: RealtimeFunctionCall) {
    for (const listener of this.functionCallListeners) {
      listener(call);
    }
  }

  onClose(listener: () => void) {
    this.closeListeners.add(listener);
  }

  onError() {}

  onFunctionCall(listener: (call: RealtimeFunctionCall) => void) {
    this.functionCallListeners.add(listener);
  }

  sendFunctionResult(
    callId: string,
    result: WaveAskHermesToolResult,
  ) {
    if (this.closed) {
      return false;
    }
    this.results.push({ callId, result });
    return true;
  }
}

class FakeRealtimeProvider implements RealtimeProvider {
  readonly calls: {
    ended: boolean;
    safetyIdentifier: string;
    sdpOffer: string;
    sideband: FakeRealtimeSideband;
  }[] = [];

  async createCall(input: {
    safetyIdentifier: string;
    sdpOffer: string;
  }): Promise<RealtimeProviderCall> {
    const call = {
      ended: false,
      safetyIdentifier: input.safetyIdentifier,
      sdpOffer: input.sdpOffer,
      sideband: new FakeRealtimeSideband(),
    };
    this.calls.push(call);
    return {
      end: async () => {
        call.ended = true;
        call.sideband.close();
      },
      sdpAnswer: SDP_ANSWER,
      sideband: call.sideband,
    };
  }
}

class FakeHermesClient implements HermesClient {
  instructions: string[] = [];
  stream:
    | ((input: HermesStreamChatInput) => AsyncGenerator<HermesStreamEvent>)
    | undefined;

  async createSession(
    _input: HermesCreateSessionInput = {},
  ): Promise<HermesSessionSummary> {
    throw new Error('Not implemented for this test.');
  }

  async getSessionMessages(
    _sessionId: string,
    _options: HermesRequestOptions = {},
  ): Promise<HermesConversationMessage[]> {
    return [];
  }

  async listSessions(
    _options: HermesListSessionsOptions = {},
  ): Promise<HermesSessionSummary[]> {
    return [];
  }

  async probeCapabilities(): Promise<HermesCapabilityReport> {
    throw new Error('Not implemented for this test.');
  }

  async stopRun() {}

  streamChat(
    sessionId: string,
    input: HermesStreamChatInput,
  ): AsyncGenerator<HermesStreamEvent> {
    this.instructions.push(input.input);
    return this.stream?.(input) ?? completedStream(sessionId);
  }
}

test('binds a Realtime call to trusted device and session state', async () => {
  const context = createContext();
  const started = await context.registry.start({
    deviceId: context.deviceId,
    sdpOffer: SDP_OFFER,
    sessionId: context.sessionId,
  });
  assert.equal(started.sdpAnswer, SDP_ANSWER);
  assert.equal(context.provider.calls[0]?.sdpOffer, SDP_OFFER);
  assert.match(
    context.provider.calls[0]?.safetyIdentifier ?? '',
    /^[a-f0-9]{64}$/,
  );
  assert.equal(context.provider.calls[0]?.safetyIdentifier.length, 64);
  assert.equal(
    context.provider.calls[0]?.safetyIdentifier.includes(
      context.deviceId,
    ),
    false,
  );

  context.provider.calls[0]?.sideband.emitFunctionCall({
    arguments: JSON.stringify({
      instruction: '  Check the production deployment  ',
    }),
    callId: 'tool-call-1',
    name: 'ask_hermes',
  });
  await waitFor(() => context.provider.calls[0]?.sideband.results.length === 1);

  assert.deepEqual(context.hermes.instructions, [
    'Check the production deployment',
  ]);
  assert.deepEqual(
    context.provider.calls[0]?.sideband.results[0],
    {
      callId: 'tool-call-1',
      result: {
        answer: 'Hermes completed the task.',
        ok: true,
        truncated: false,
      },
    },
  );
  await context.registry.end(context.deviceId, started.id);
  assert.equal(context.provider.calls[0]?.ended, true);
  closeContext(context);
});

test('rejects unknown tools, model-selected sessions, and malformed arguments before Hermes', async () => {
  const context = createContext();
  await context.registry.start({
    deviceId: context.deviceId,
    sdpOffer: SDP_OFFER,
    sessionId: context.sessionId,
  });
  const sideband = context.provider.calls[0]?.sideband;
  sideband?.emitFunctionCall({
    arguments: '{}',
    callId: 'tool-call-unknown',
    name: 'administer_hermes',
  });
  sideband?.emitFunctionCall({
    arguments: JSON.stringify({
      instruction: 'Do the work',
      sessionId: 'model-selected-session',
    }),
    callId: 'tool-call-session',
    name: 'ask_hermes',
  });
  sideband?.emitFunctionCall({
    arguments: '{broken',
    callId: 'tool-call-malformed',
    name: 'ask_hermes',
  });
  await waitFor(() => sideband?.results.length === 3);

  assert.deepEqual(context.hermes.instructions, []);
  assert.deepEqual(
    sideband?.results.map(({ result }) =>
      result.ok ? 'success' : result.error.code,
    ),
    ['unknown_tool', 'invalid_arguments', 'invalid_arguments'],
  );
  closeContext(context);
});

test('reauthorizes the device and session before every Hermes dispatch', async () => {
  const context = createContext();
  await context.registry.start({
    deviceId: context.deviceId,
    sdpOffer: SDP_OFFER,
    sessionId: context.sessionId,
  });
  context.store.revokeDevice(context.deviceId);
  const sideband = context.provider.calls[0]?.sideband;
  sideband?.emitFunctionCall({
    arguments: JSON.stringify({ instruction: 'Do not run' }),
    callId: 'tool-call-revoked',
    name: 'ask_hermes',
  });
  await waitFor(() => sideband?.results.length === 1);

  assert.deepEqual(context.hermes.instructions, []);
  assert.equal(
    sideband?.results[0]?.result.ok === false &&
      sideband.results[0].result.error.code,
    'unauthorized',
  );
  closeContext(context);
});

test('bounds call concurrency per device, session, and process', async () => {
  const context = createContext({ maxActiveCalls: 1 });
  await context.registry.start({
    deviceId: context.deviceId,
    sdpOffer: SDP_OFFER,
    sessionId: context.sessionId,
  });

  await assert.rejects(
    () =>
      context.registry.start({
        deviceId: context.deviceId,
        sdpOffer: SDP_OFFER,
        sessionId: context.sessionId,
      }),
    (error: unknown) =>
      error instanceof WaveHttpError &&
      error.code === 'rate_limited' &&
      error.statusCode === 429,
  );
  assert.equal(context.provider.calls.length, 1);
  closeContext(context);
});

test('returns a timeout result but ignores completion after the call closes', async () => {
  const timeoutContext = createContext({ toolTimeoutMs: 10 });
  timeoutContext.hermes.stream = async function* (input) {
    await new Promise<void>((_resolve, reject) => {
      input.signal?.addEventListener(
        'abort',
        () => reject(new Error('aborted')),
        { once: true },
      );
    });
  };
  await timeoutContext.registry.start({
    deviceId: timeoutContext.deviceId,
    sdpOffer: SDP_OFFER,
    sessionId: timeoutContext.sessionId,
  });
  const timeoutSideband = timeoutContext.provider.calls[0]?.sideband;
  timeoutSideband?.emitFunctionCall({
    arguments: JSON.stringify({ instruction: 'Take too long' }),
    callId: 'tool-call-timeout',
    name: 'ask_hermes',
  });
  await waitFor(() => timeoutSideband?.results.length === 1);
  assert.equal(
    timeoutSideband?.results[0]?.result.ok === false &&
      timeoutSideband.results[0].result.error.code,
    'timeout',
  );
  closeContext(timeoutContext);

  const closeContextValue = createContext();
  closeContextValue.hermes.stream = async function* (input) {
    await new Promise<void>((_resolve, reject) => {
      input.signal?.addEventListener(
        'abort',
        () => reject(new Error('aborted')),
        { once: true },
      );
    });
  };
  await closeContextValue.registry.start({
    deviceId: closeContextValue.deviceId,
    sdpOffer: SDP_OFFER,
    sessionId: closeContextValue.sessionId,
  });
  const closingSideband = closeContextValue.provider.calls[0]?.sideband;
  closingSideband?.emitFunctionCall({
    arguments: JSON.stringify({ instruction: 'Close while running' }),
    callId: 'tool-call-close',
    name: 'ask_hermes',
  });
  closingSideband?.close();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(closingSideband?.results, []);
  closeContext(closeContextValue);
});

function createContext(
  options: {
    maxActiveCalls?: number;
    toolTimeoutMs?: number;
  } = {},
) {
  const store = new SqliteDeviceStore(':memory:');
  const pairing = store.issuePairingCode(
    new Date(Date.now() + 60_000),
  );
  const redeemed = store.redeemPairingCode(
    pairing.code,
    'Realtime test device',
  );
  assert.ok(redeemed);
  const sessionId = 'hermes-session-1';
  store.bindSession(redeemed.device.id, sessionId);
  const provider = new FakeRealtimeProvider();
  const hermes = new FakeHermesClient();
  const registry = new RealtimeCallRegistry(
    {
      callTtlMs: 60_000,
      maxActiveCalls: options.maxActiveCalls ?? 2,
      toolTimeoutMs: options.toolTimeoutMs ?? 1_000,
    },
    {
      deviceStore: store,
      hermesClient: hermes,
      provider,
    },
  );
  return {
    deviceId: redeemed.device.id,
    hermes,
    provider,
    registry,
    sessionId,
    store,
  };
}

function closeContext(context: ReturnType<typeof createContext>) {
  void context.registry.abortAll();
  context.store.close();
}

async function* completedStream(
  sessionId: string,
): AsyncGenerator<HermesStreamEvent> {
  yield {
    content: 'Hermes completed the task.',
    interrupted: false,
    messageId: 'message-1',
    partial: false,
    runId: 'run-1',
    sequence: 1,
    sessionId,
    timestamp: 1,
    type: 'assistant.completed',
  };
  yield {
    runId: 'run-1',
    sequence: 2,
    sessionId,
    timestamp: 2,
    type: 'done',
  };
}

async function waitFor(
  predicate: () => boolean | undefined,
  timeoutMs = 1_000,
) {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error('Timed out waiting for the test condition.');
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
