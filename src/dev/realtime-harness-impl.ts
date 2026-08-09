/**
 * Realtime harness overrides: point the OpenAI Realtime backend at a local
 * scripted fake (`tools/voice-harness`) instead of `api.openai.com`, with a
 * `ScriptedRealtimeTransport` replacing WebRTC.
 *
 * This module holds the pure, node-testable implementation. It is reachable
 * only through the `__DEV__`-gated wrapper in `realtime-harness.ts`, which
 * Metro eliminates from production bundles (the production smoke scan
 * asserts the marker strings below are absent).
 *
 * Secret safety is structural: the override fetch replaces the Authorization
 * header with a fixed dummy marker and the override socket factory sends no
 * headers at all, so the user's saved OpenAI key never travels toward a
 * harness regardless of configuration.
 */
// Relative imports with extensions: this module is exercised by the node
// test runner, which resolves neither the `@/` alias nor extensionless paths.
import { fetch as expoFetch } from 'expo/fetch';

import {
  createPreferenceStore,
  type DevicePreferenceStore,
} from '../state/create-preference-store.ts';
import { ScriptedRealtimeTransport } from './scripted-realtime-transport.ts';

const HARNESS_URL_KEY = 'wave.realtime-harness-url.v1';
const MAX_HARNESS_URL_CHARS = 200;
/** The only bearer value the override fetch ever sends toward a harness. */
export const REALTIME_HARNESS_DUMMY_KEY =
  'sk-wave-harness-000000000000000000000';

export interface RealtimeHarnessOverrides {
  fetchImpl: typeof globalThis.fetch;
  socketFactory: (url: string, apiKey: string) => WebSocket;
  transport: ScriptedRealtimeTransport;
}

/** '' clears harness mode; anything else must be a plain http(s) origin. */
export function normalizeRealtimeHarnessUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.length > MAX_HARNESS_URL_CHARS) {
    throw new Error('Enter a shorter harness URL.');
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('Enter a valid harness URL, like http://localhost:8790.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('The harness URL must use http or https.');
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error(
      'The harness URL cannot include credentials, a query, or a fragment.',
    );
  }
  return parsed.origin;
}

export function parseRealtimeHarnessUrlRecord(serialized: string): string {
  const value = JSON.parse(serialized) as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid Realtime harness record.');
  }
  const record = value as Record<string, unknown>;
  if (record.version !== 1 || typeof record.url !== 'string') {
    throw new Error('Invalid Realtime harness record.');
  }
  return normalizeRealtimeHarnessUrl(record.url);
}

export function serializeRealtimeHarnessUrlRecord(url: string): string {
  return JSON.stringify({ url: normalizeRealtimeHarnessUrl(url), version: 1 });
}

let store: DevicePreferenceStore<string> | undefined;

function harnessUrlStore(): DevicePreferenceStore<string> {
  store ??= createPreferenceStore<string>({
    codec: {
      decode: parseRealtimeHarnessUrlRecord,
      encode: serializeRealtimeHarnessUrlRecord,
    },
    defaultValue: '',
    key: HARNESS_URL_KEY,
    storeErrorMessage: 'Wave could not save the Realtime harness URL.',
  });
  return store;
}

export function readStoredRealtimeHarnessUrl(): Promise<string> {
  return harnessUrlStore().read();
}

export function storeRealtimeHarnessUrl(url: string): Promise<void> {
  return harnessUrlStore().set(normalizeRealtimeHarnessUrl(url));
}

export function createRealtimeHarnessOverrides(
  harnessUrl: string,
  options: {
    createSocket?: (url: string) => WebSocket;
    fetchImpl?: typeof globalThis.fetch;
  } = {},
): RealtimeHarnessOverrides {
  const origin = normalizeRealtimeHarnessUrl(harnessUrl);
  if (!origin) throw new Error('The Realtime harness URL is empty.');
  const wsOrigin = origin.replace(/^http/, 'ws');
  const baseFetch =
    options.fetchImpl ?? (expoFetch as unknown as typeof globalThis.fetch);
  const createSocket =
    options.createSocket ?? ((url: string) => new WebSocket(url));
  const transport = new ScriptedRealtimeTransport();

  const rewrite = (target: string, base: string): string => {
    const url = new URL(target);
    return `${base}${url.pathname}${url.search}`;
  };

  const fetchImpl = ((input: RequestInfo | URL, init?: RequestInit) => {
    const target =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    return baseFetch(rewrite(target, origin), {
      ...init,
      headers: {
        ...(init?.headers as Record<string, string> | undefined),
        Authorization: `Bearer ${REALTIME_HARNESS_DUMMY_KEY}`,
      },
    });
  }) as typeof globalThis.fetch;

  return {
    fetchImpl,
    socketFactory: (url, _apiKey) => {
      const socket = createSocket(rewrite(url, wsOrigin));
      // One socket for everything: the sideband owns it, and its inbound
      // frames tee into the scripted transport, which maps the standard
      // OpenAI event shapes and ignores the sideband's own traffic.
      socket.addEventListener('message', (event) => {
        const data = (event as { data?: unknown }).data;
        if (typeof data === 'string') transport.deliverFrame(data);
      });
      return socket;
    },
    transport,
  };
}
