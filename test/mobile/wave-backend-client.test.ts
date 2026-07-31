import assert from 'node:assert/strict';
import test from 'node:test';

import {
  WaveBackendClient,
  WaveBackendError,
  normalizeWaveBaseUrl,
} from '../../src/services/wave/wave-backend-client.ts';

const credential = `wave_device_${'a'.repeat(43)}`;

test('normalizes private base paths and rejects unsafe URLs', () => {
  assert.equal(
    normalizeWaveBaseUrl(' https://wave.test/private/// '),
    'https://wave.test/private',
  );
  assert.equal(
    normalizeWaveBaseUrl('http://10.0.2.2:8787', {
      allowInsecureHttp: true,
    }),
    'http://10.0.2.2:8787',
  );
  assert.throws(
    () => normalizeWaveBaseUrl('http://wave.test'),
    (error: unknown) =>
      error instanceof WaveBackendError && error.kind === 'invalid_base_url',
  );
  assert.throws(
    () => normalizeWaveBaseUrl('https://user:secret@wave.test'),
    /cannot include credentials/,
  );
});

test('validates pairing responses without sending a device credential', async () => {
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    assert.equal(String(input), 'https://wave.test/root/v1/pairings/redeem');
    assert.equal(new Headers(init?.headers).has('authorization'), false);
    assert.equal(init?.redirect, 'error');
    assert.deepEqual(JSON.parse(String(init?.body)), {
      code: 'ABCD-EFGH-JKLM-NPQR',
      deviceName: 'Test phone',
    });
    return jsonResponse(
      {
        apiVersion: 'v1',
        credential,
        device: {
          createdAt: '2026-07-30T02:00:00.000Z',
          id: 'device-1',
          name: 'Test phone',
        },
      },
      201,
    );
  };
  const client = new WaveBackendClient({
    baseUrl: 'https://wave.test/root',
    fetch,
  });

  const paired = await client.redeemPairing({
    code: 'ABCD-EFGH-JKLM-NPQR',
    deviceName: 'Test phone',
  });

  assert.equal(paired.device.id, 'device-1');
  assert.equal(paired.credential, credential);
});

test('adds the credential only to authenticated operations', async () => {
  const requests: { authorization: string | null; path: string }[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    requests.push({
      authorization: new Headers(init?.headers).get('authorization'),
      path: url.pathname,
    });
    if (url.pathname.endsWith('/status')) {
      return jsonResponse({
        apiVersion: 'v1',
        features: { chat: true, pairing: true, realtime: false },
        hermes: { configured: true },
        serverTime: '2026-07-30T02:00:00.000Z',
        service: 'wave-companion',
        serviceVersion: '0.1.0',
        status: 'ok',
      });
    }
    return jsonResponse({
      apiVersion: 'v1',
      compatible: true,
      missingEndpoints: [],
      missingFeatures: [],
    });
  };
  const client = new WaveBackendClient({
    baseUrl: 'https://wave.test',
    credential,
    fetch,
  });

  await client.getStatus();
  await client.getCompatibility();

  assert.deepEqual(requests, [
    { authorization: null, path: '/v1/status' },
    { authorization: `Bearer ${credential}`, path: '/v1/compatibility' },
  ]);
});

test('starts and ends a Realtime call through strict Wave-owned contracts', async () => {
  const requests: Array<{
    body: unknown;
    path: string;
  }> = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    assert.equal(
      new Headers(init?.headers).get('authorization'),
      `Bearer ${credential}`,
    );
    requests.push({
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      path: url.pathname,
    });
    if (url.pathname.endsWith('/realtime/calls')) {
      return jsonResponse(
        {
          apiVersion: 'v1',
          call: {
            expiresAt: '2026-07-30T05:30:00.000Z',
            id: 'wave-call-1',
            sdpAnswer: 'v=0\r\no=- 2 3 IN IP4 127.0.0.1\r\n',
          },
        },
        201,
      );
    }
    return jsonResponse({
      apiVersion: 'v1',
      callId: 'wave-call-1',
      status: 'ended',
    });
  };
  const client = new WaveBackendClient({
    baseUrl: 'https://wave.test/root',
    credential,
    fetch,
  });

  const started = await client.startRealtimeCall(
    'hermes-session-1',
    'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n',
    'cedar',
  );
  assert.equal(started.call.id, 'wave-call-1');
  const ended = await client.endRealtimeCall(started.call.id);
  assert.equal(ended.status, 'ended');
  assert.deepEqual(requests, [
    {
      body: {
        sdpOffer: 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n',
        voiceId: 'cedar',
      },
      path: '/root/v1/sessions/hermes-session-1/realtime/calls',
    },
    {
      body: undefined,
      path: '/root/v1/realtime/calls/wave-call-1/end',
    },
  ]);
});

test('loads the Gateway-authorized Realtime voice catalog', async () => {
  let requestedPath = '';
  const client = new WaveBackendClient({
    baseUrl: 'https://wave.test/root',
    credential,
    fetch: async (input, init) => {
      requestedPath = new URL(String(input)).pathname;
      assert.equal(
        new Headers(init?.headers).get('authorization'),
        `Bearer ${credential}`,
      );
      return jsonResponse({
        apiVersion: 'v1',
        defaultVoiceId: 'marin',
        voices: [
          {
            description:
              'Natural and expressive for a polished voice experience.',
            id: 'marin',
            label: 'Marin',
          },
          {
            description: 'Clear and grounded with a steady presence.',
            id: 'cedar',
            label: 'Cedar',
          },
        ],
      });
    },
  });

  const catalog = await client.getRealtimeVoices();

  assert.equal(requestedPath, '/root/v1/realtime/voices');
  assert.equal(catalog.defaultVoiceId, 'marin');
  assert.equal(catalog.voices[1]?.id, 'cedar');
});

test('loads authenticated redacted support diagnostics', async () => {
  let requestedPath = '';
  const client = new WaveBackendClient({
    baseUrl: 'https://wave.test/root',
    credential,
    fetch: async (input, init) => {
      requestedPath = new URL(String(input)).pathname;
      assert.equal(
        new Headers(init?.headers).get('authorization'),
        `Bearer ${credential}`,
      );
      return jsonResponse({
        apiVersion: 'v1',
        companion: {
          serviceVersion: '0.1.0',
          uptimeSeconds: 120,
        },
        features: {
          chat: true,
          pairing: true,
          realtime: true,
        },
        generatedAt: '2026-07-31T12:00:00.000Z',
        hermes: {
          status: 'compatible',
        },
      });
    },
  });

  const diagnostics = await client.getDiagnostics();

  assert.equal(requestedPath, '/root/v1/diagnostics');
  assert.equal(diagnostics.hermes.status, 'compatible');
  assert.equal(diagnostics.companion.uptimeSeconds, 120);
});

test('loads a cursor-paginated unified conversation timeline', async () => {
  let requestedUrl = '';
  const client = new WaveBackendClient({
    baseUrl: 'https://wave.test/root',
    credential,
    fetch: async (input) => {
      requestedUrl = String(input);
      return jsonResponse({
        apiVersion: 'v1',
        entries: [
          {
            id: 'wave-message-1',
            message: {
              content: 'The bedroom lights are off.',
              role: 'assistant',
            },
            source: 'wave',
            turnId: 'wave-turn-1',
            type: 'message',
          },
        ],
        hasMore: false,
        limit: 50,
        sessionId: 'session-1',
      });
    },
  });

  const timeline = await client.getSessionTimeline('session-1', {
    before: 'wave-cursor-1',
    limit: 50,
  });

  assert.equal(timeline.entries[0]?.type, 'message');
  assert.equal(
    requestedUrl,
    'https://wave.test/root/v1/sessions/session-1/timeline?limit=50&before=wave-cursor-1',
  );
});

test('uses paginated account sessions, lifecycle mutations, and read-only jobs', async () => {
  const requests: {
    body?: unknown;
    method: string;
    path: string;
    search: string;
  }[] = [];
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    requests.push({
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      method: init?.method ?? 'GET',
      path: url.pathname,
      search: url.search,
    });
    if (url.pathname.endsWith('/operations/jobs')) {
      return jsonResponse({
        apiVersion: 'v1',
        jobs: [
          {
            enabled: true,
            id: 'job-1',
            name: 'Morning briefing',
            schedule: 'Every day at 9:00 AM',
            state: 'scheduled',
          },
        ],
      });
    }
    if (init?.method === 'DELETE') {
      return jsonResponse({
        apiVersion: 'v1',
        deleted: true,
        sessionId: 'session-1',
      });
    }
    if (init?.method === 'PATCH') {
      return jsonResponse({
        apiVersion: 'v1',
        session: {
          id: 'session-1',
          title: 'Renamed',
        },
      });
    }
    return jsonResponse({
      apiVersion: 'v1',
      hasMore: false,
      limit: 25,
      offset: 50,
      sessions: [{ id: 'session-1', title: 'Existing' }],
    });
  };
  const client = new WaveBackendClient({
    baseUrl: 'https://wave.test/root',
    credential,
    fetch,
  });

  const sessions = await client.listSessions({
    limit: 25,
    offset: 50,
  });
  const renamed = await client.updateSession('session-1', {
    title: 'Renamed',
  });
  const deleted = await client.deleteSession('session-1');
  const jobs = await client.listScheduledJobs();

  assert.equal(sessions.sessions[0]?.title, 'Existing');
  assert.equal(renamed.session.title, 'Renamed');
  assert.equal(deleted.deleted, true);
  assert.equal(jobs.jobs[0]?.name, 'Morning briefing');
  assert.deepEqual(requests, [
    {
      body: undefined,
      method: 'GET',
      path: '/root/v1/sessions',
      search: '?limit=25&offset=50',
    },
    {
      body: { title: 'Renamed' },
      method: 'PATCH',
      path: '/root/v1/sessions/session-1',
      search: '',
    },
    {
      body: undefined,
      method: 'DELETE',
      path: '/root/v1/sessions/session-1',
      search: '',
    },
    {
      body: undefined,
      method: 'GET',
      path: '/root/v1/operations/jobs',
      search: '',
    },
  ]);
});

test('rejects invalid client inputs before a request can leave the app', async () => {
  let requestCount = 0;
  const client = new WaveBackendClient({
    baseUrl: 'https://wave.test',
    credential,
    fetch: async () => {
      requestCount += 1;
      return jsonResponse({});
    },
  });

  assert.throws(
    () => client.getSessionHistory('../admin'),
    (error: unknown) =>
      error instanceof WaveBackendError && error.kind === 'bad_request',
  );
  assert.throws(
    () => client.getSessionTimeline('../admin'),
    (error: unknown) =>
      error instanceof WaveBackendError && error.kind === 'bad_request',
  );
  assert.throws(
    () => client.cancelTurn('session-1', 'turn/1'),
    (error: unknown) =>
      error instanceof WaveBackendError && error.kind === 'bad_request',
  );
  assert.throws(
    () => client.startRealtimeCall('session-1', 'not-sdp'),
    (error: unknown) =>
      error instanceof WaveBackendError && error.kind === 'bad_request',
  );
  assert.throws(
    () => client.endRealtimeCall('call/1'),
    (error: unknown) =>
      error instanceof WaveBackendError && error.kind === 'bad_request',
  );
  assert.throws(
    () =>
      client.redeemPairing({
        code: 'too-short',
        deviceName: 'Test phone',
      }),
    (error: unknown) =>
      error instanceof WaveBackendError && error.kind === 'bad_request',
  );
  assert.equal(requestCount, 0);
});

test('returns safe typed server and protocol errors', async () => {
  const rejected = new WaveBackendClient({
    baseUrl: 'https://wave.test',
    credential,
    fetch: async () =>
      jsonResponse(
        {
          apiVersion: 'v1',
          error: {
            code: 'unauthorized',
            correlationId: 'request-1',
            message: 'Pair this device again.',
            retryable: false,
          },
        },
        401,
      ),
  });
  await assert.rejects(
    rejected.getCompatibility(),
    (error: unknown) =>
      error instanceof WaveBackendError &&
      error.kind === 'unauthorized' &&
      error.correlationId === 'request-1' &&
      !error.message.includes(credential),
  );

  const malformed = new WaveBackendClient({
    baseUrl: 'https://wave.test',
    fetch: async () =>
      jsonResponse({
        apiVersion: 'v1',
        credential,
        device: {
          createdAt: '2026-07-30T02:00:00.000Z',
          id: 'device-1',
          name: 'Test phone',
        },
        upstreamKey: 'must not be accepted',
      }),
  });
  await assert.rejects(
    malformed.redeemPairing({
      code: 'ABCD-EFGH-JKLM-NPQR',
      deviceName: 'Test phone',
    }),
    (error: unknown) =>
      error instanceof WaveBackendError && error.kind === 'invalid_response',
  );
});

test('cancels a chunked response as soon as its byte limit is exceeded', async () => {
  let cancelled = false;
  let chunks = 0;
  const response = new Response(
    new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
      pull(controller) {
        chunks += 1;
        controller.enqueue(new Uint8Array(1024 * 1024));
      },
    }),
    {
      headers: { 'content-type': 'application/json' },
    },
  );
  const client = new WaveBackendClient({
    baseUrl: 'https://wave.test',
    fetch: async () => response,
  });

  await assert.rejects(
    client.getStatus(),
    (error: unknown) =>
      error instanceof WaveBackendError &&
      error.kind === 'invalid_response' &&
      /too much data/.test(error.message),
  );
  assert.equal(cancelled, true);
});

test('distinguishes cancellation from request timeout', async () => {
  const fetch = (_input: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener(
        'abort',
        () => reject(new DOMException('Aborted', 'AbortError')),
        { once: true },
      );
    });
  const cancelledClient = new WaveBackendClient({
    baseUrl: 'https://wave.test',
    fetch,
    requestTimeoutMs: 1_000,
  });
  const controller = new AbortController();
  const request = cancelledClient.getStatus(controller.signal);
  controller.abort();
  await assert.rejects(
    request,
    (error: unknown) =>
      error instanceof WaveBackendError && error.kind === 'cancelled',
  );

  const timedOutClient = new WaveBackendClient({
    baseUrl: 'https://wave.test',
    fetch,
    requestTimeoutMs: 5,
  });
  await assert.rejects(
    timedOutClient.getStatus(),
    (error: unknown) =>
      error instanceof WaveBackendError && error.kind === 'timeout',
  );
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status,
  });
}
