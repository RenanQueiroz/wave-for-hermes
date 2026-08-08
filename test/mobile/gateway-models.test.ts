import assert from 'node:assert/strict';
import test from 'node:test';

import { GatewayClient } from '../../src/services/gateway/gateway-client.ts';
import {
  buildModelSwitchValue,
  normalizeModelCatalog,
  normalizeModelSwitch,
} from '../../src/services/gateway/gateway-models.ts';

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status: 200,
  });
}

const CATALOG_PAYLOAD = {
  model: 'kimi-k2',
  provider: 'nous',
  providers: [
    {
      api_url: 'https://internal.example', // admin field: must not survive
      authenticated: true,
      capabilities: { 'kimi-k2': { fast: true, reasoning: true } },
      featured_models: ['kimi-k2'],
      is_current: true,
      key_env: 'NOUS_API_KEY',
      models: ['kimi-k2', 'hermes-4-70b'],
      name: 'Nous Research',
      pricing: { 'kimi-k2': { input: 0.6, output: 2.5 } },
      slug: 'nous',
      unavailable_models: ['hermes-4-70b'],
    },
    {
      authenticated: false, // onboarding surface: dropped entirely
      models: ['gpt-5'],
      name: 'OpenAI',
      slug: 'openai',
    },
    { models: [], name: 'Empty', slug: 'empty' },
    { models: ['bad id with spaces'], name: 'Weird', slug: 'weird' },
  ],
};

test('catalog normalization keeps bounded rows and drops admin surface', () => {
  const catalog = normalizeModelCatalog(CATALOG_PAYLOAD);
  assert.equal(catalog.currentModel, 'kimi-k2');
  assert.equal(catalog.currentProvider, 'nous');
  assert.equal(catalog.providers.length, 1);
  const nous = catalog.providers[0];
  assert.equal(nous.current, true);
  assert.equal(nous.name, 'Nous Research');
  assert.deepEqual(nous.models, [
    {
      fast: true,
      featured: true,
      id: 'kimi-k2',
      pricing: '$0.6 in / $2.5 out per Mtok',
      reasoning: true,
      unavailable: false,
    },
    { featured: false, id: 'hermes-4-70b', unavailable: true },
  ]);
  assert.equal(JSON.stringify(catalog).includes('NOUS_API_KEY'), false);
  assert.equal(JSON.stringify(catalog).includes('internal.example'), false);
});

test('catalog normalization caps runaway payloads', () => {
  const oversized = {
    providers: Array.from({ length: 60 }, (_, index) => ({
      authenticated: true,
      models: Array.from({ length: 200 }, (_, model) => `m-${model}`),
      name: `P${index}`,
      slug: `p-${index}`,
    })),
  };
  const catalog = normalizeModelCatalog(oversized);
  assert.equal(catalog.providers.length, 24);
  assert.equal(catalog.providers[0].models.length, 60);
});

test('the switch value is session-scoped and flag-proof', () => {
  assert.equal(
    buildModelSwitchValue({ model: 'kimi-k2', provider: 'nous' }),
    'kimi-k2 --provider nous --session',
  );
  assert.throws(() =>
    buildModelSwitchValue({ model: 'x --global', provider: 'nous' }),
  );
  assert.throws(() =>
    buildModelSwitchValue({ model: '-leading', provider: 'nous' }),
  );
  assert.throws(() =>
    buildModelSwitchValue({ model: 'kimi-k2', provider: 'nous --once' }),
  );
});

test('switch results map applied, deferred, and confirm-required', () => {
  const selection = { model: 'kimi-k2', provider: 'nous' };
  assert.deepEqual(
    normalizeModelSwitch(
      { confirm_required: false, deferred: false, value: 'kimi-k2' },
      selection,
    ),
    { model: 'kimi-k2', outcome: 'applied' },
  );
  assert.deepEqual(
    normalizeModelSwitch(
      { deferred: true, value: 'kimi-k2', warning: '' },
      selection,
    ),
    { model: 'kimi-k2', outcome: 'deferred' },
  );
  assert.deepEqual(
    normalizeModelSwitch(
      { confirm_message: 'Pricey. Continue?', confirm_required: true },
      selection,
    ),
    { message: 'Pricey. Continue?', outcome: 'confirm-required' },
  );
});

function createRpcFake(handlers: {
  onCall(
    method: string,
    params: Record<string, unknown>,
    emit: (type: string, payload: Record<string, unknown>) => void,
  ): unknown;
}) {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  class FakeSocket {
    onopen?: () => void;
    onmessage?: (message: { data: string }) => void;
    onerror?: () => void;
    onclose?: () => void;
    constructor() {
      setTimeout(() => this.onopen?.(), 0);
    }
    send(data: string): void {
      const frame = JSON.parse(data) as {
        id: number;
        method: string;
        params: Record<string, unknown>;
      };
      calls.push({ method: frame.method, params: frame.params });
      const emit = (type: string, payload: Record<string, unknown>) => {
        setTimeout(() => {
          this.onmessage?.({
            data: JSON.stringify({
              jsonrpc: '2.0',
              method: 'event',
              params: { payload, type },
            }),
          });
        }, 0);
      };
      const result = handlers.onCall(frame.method, frame.params, emit);
      setTimeout(() => {
        this.onmessage?.({
          data: JSON.stringify({ id: frame.id, jsonrpc: '2.0', result }),
        });
      }, 0);
    }
    close(): void {
      // No-op for the fake.
    }
  }
  const fetchImpl = (async (url: string | URL) => {
    if (String(url).endsWith('/api/auth/ws-ticket')) {
      return jsonResponse({ ticket: 't-1' });
    }
    throw new Error(`unexpected request: ${String(url)}`);
  }) as unknown as typeof globalThis.fetch;
  const client = new GatewayClient({
    baseUrl: 'http://localhost:9119',
    fetch: fetchImpl,
    socketFactory: () => new FakeSocket() as unknown as WebSocket,
    tokens: { accessToken: 'a', provider: 'basic', refreshToken: 'r' },
  });
  return { calls, client };
}

test('the catalog read resumes the session and asks with its live sid', async () => {
  const { calls, client } = createRpcFake({
    onCall: (method) => {
      if (method === 'session.resume') return { session_id: 'live-9' };
      if (method === 'model.options') return CATALOG_PAYLOAD;
      return {};
    },
  });
  const catalog = await client.getSessionModelContext('20260807_stored');
  assert.equal(catalog.currentModel, 'kimi-k2');
  assert.deepEqual(
    calls.map((call) => call.method),
    ['session.resume', 'model.options'],
  );
  assert.deepEqual(calls[1].params, {
    explicit_only: true,
    session_id: 'live-9',
  });
});

test('a switch sends one session-scoped config.set on the live sid', async () => {
  const { calls, client } = createRpcFake({
    onCall: (method) => {
      if (method === 'session.resume') return { session_id: 'live-9' };
      if (method === 'config.set') {
        return { confirm_required: false, deferred: true, value: 'kimi-k2' };
      }
      return {};
    },
  });
  const result = await client.setSessionModel('20260807_stored', {
    model: 'kimi-k2',
    provider: 'nous',
  });
  assert.deepEqual(result, { model: 'kimi-k2', outcome: 'deferred' });
  const configSet = calls.find((call) => call.method === 'config.set');
  assert.deepEqual(configSet?.params, {
    key: 'model',
    session_id: 'live-9',
    value: 'kimi-k2 --provider nous --session',
  });
});

test('a confirmed re-send carries confirm_expensive_model', async () => {
  const { calls, client } = createRpcFake({
    onCall: (method, params) => {
      if (method === 'session.resume') return { session_id: 'live-9' };
      if (method === 'config.set') {
        return params.confirm_expensive_model === true
          ? { confirm_required: false, value: 'big-model' }
          : { confirm_message: 'Pricey. Continue?', confirm_required: true };
      }
      return {};
    },
  });
  const first = await client.setSessionModel('20260807_stored', {
    model: 'big-model',
    provider: 'nous',
  });
  assert.equal(first.outcome, 'confirm-required');
  const second = await client.setSessionModel(
    '20260807_stored',
    { model: 'big-model', provider: 'nous' },
    { confirmExpensiveModel: true },
  );
  assert.deepEqual(second, { model: 'big-model', outcome: 'applied' });
  const configSets = calls.filter((call) => call.method === 'config.set');
  assert.equal(configSets.length, 2);
  assert.equal(configSets[0].params.confirm_expensive_model, undefined);
  assert.equal(configSets[1].params.confirm_expensive_model, true);
});

test('a pending conversation stores the pick locally and sends it on create', async () => {
  const { calls, client } = createRpcFake({
    onCall: (method, _params, emit) => {
      if (method === 'session.create') {
        return { session_id: 'live-1', stored_session_id: 'stored-1' };
      }
      if (method === 'model.options') return CATALOG_PAYLOAD;
      if (method === 'prompt.submit') {
        emit('message.complete', { text: 'done' });
        return { ok: true };
      }
      return {};
    },
  });

  // No gateway session yet: the pick is local and immediate.
  const picked = await client.setSessionModel('wave-pending-7', {
    model: 'hermes-4-405b',
    provider: 'nous',
  });
  assert.deepEqual(picked, { model: 'hermes-4-405b', outcome: 'applied' });
  assert.equal(calls.length, 0);

  // The catalog reflects the local pick without creating a session.
  const catalog = await client.getSessionModelContext('wave-pending-7');
  assert.equal(catalog.currentModel, 'hermes-4-405b');
  assert.deepEqual(
    calls.map((call) => call.method),
    ['model.options'],
  );
  assert.equal(calls[0].params.session_id, undefined);

  // The first turn's session.create carries the pick, exactly once.
  const abort = new AbortController();
  const turn = client.streamTurn('wave-pending-7', 'hello', abort.signal);
  for await (const event of turn) {
    if (event.type === 'turn.completed' || event.type === 'turn.error') break;
  }
  const created = calls.find((call) => call.method === 'session.create');
  assert.deepEqual(created?.params, {
    model: 'hermes-4-405b',
    provider: 'nous',
  });
});
