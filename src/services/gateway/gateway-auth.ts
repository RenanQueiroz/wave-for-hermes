/**
 * Gateway sign-in. Pure transport + parsing so node tests cover the failure
 * shapes; the caller owns storage.
 *
 * Verified against hermes-agent 0.19.0: `POST /auth/password-login` with
 * `{provider, username, password}` returns 200 plus the session cookies, 401
 * for bad credentials (deliberately generic — never distinguish unknown user
 * from wrong password in the UI either), 404 for an unknown provider, 429
 * when rate limited.
 */
import {
  isCompleteTokenSet,
  parseGatewaySetCookies,
  type GatewayTokens,
} from './gateway-tokens.ts';
import { WaveBackendError } from '../wave/wave-backend-client.ts';

export interface GatewayAuthProvider {
  displayName: string;
  name: string;
  supportsPassword: boolean;
}

const AUTH_REQUEST_TIMEOUT_MS = 20_000;

function readSetCookies(response: Response): string[] {
  const getSetCookie = (
    response.headers as unknown as { getSetCookie?: () => string[] }
  ).getSetCookie;
  if (typeof getSetCookie === 'function')
    return getSetCookie.call(response.headers);
  const single = response.headers.get('set-cookie');
  return single ? single.split(/,(?=\s*[^=;,]+=)/).map((v) => v.trim()) : [];
}

async function withTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AUTH_REQUEST_TIMEOUT_MS);
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

/** Discover which sign-in methods a gateway offers (public endpoint). */
export async function fetchGatewayAuthProviders(
  baseUrl: string,
  fetchImpl: typeof globalThis.fetch,
  signal?: AbortSignal,
): Promise<GatewayAuthProvider[]> {
  const response = await withTimeout(
    (timeoutSignal) =>
      fetchImpl(`${baseUrl}/api/auth/providers`, {
        headers: { accept: 'application/json' },
        signal: timeoutSignal,
      }),
    signal,
  ).catch(() => {
    throw new WaveBackendError('Wave could not reach that Hermes gateway.', {
      kind: 'network',
      retryable: true,
    });
  });
  if (!response.ok) {
    throw new WaveBackendError(
      'That address did not answer as a Hermes gateway.',
      { kind: 'upstream_incompatible', statusCode: response.status },
    );
  }
  const body = (await response.json().catch(() => null)) as {
    providers?: unknown;
  } | null;
  const providers = Array.isArray(body?.providers) ? body.providers : [];
  return providers.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) return [];
    const record = entry as Record<string, unknown>;
    const name = typeof record.name === 'string' ? record.name : '';
    if (!name) return [];
    return [
      {
        displayName:
          typeof record.display_name === 'string' ? record.display_name : name,
        name,
        supportsPassword: record.supports_password === true,
      },
    ];
  });
}

/** Exchange credentials for the gateway session tokens. */
export async function signInWithPassword(
  input: {
    baseUrl: string;
    password: string;
    provider: string;
    username: string;
  },
  fetchImpl: typeof globalThis.fetch,
  signal?: AbortSignal,
): Promise<GatewayTokens> {
  const response = await withTimeout(
    (timeoutSignal) =>
      fetchImpl(`${input.baseUrl}/auth/password-login`, {
        body: JSON.stringify({
          password: input.password,
          provider: input.provider,
          username: input.username,
        }),
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        method: 'POST',
        signal: timeoutSignal,
      }),
    signal,
  ).catch(() => {
    throw new WaveBackendError('Wave could not reach that Hermes gateway.', {
      kind: 'network',
      retryable: true,
    });
  });

  if (response.status === 401) {
    throw new WaveBackendError('That username and password did not match.', {
      kind: 'unauthorized',
      statusCode: 401,
    });
  }
  if (response.status === 429) {
    throw new WaveBackendError('Too many sign-in attempts. Wait a moment.', {
      kind: 'rate_limited',
      retryable: true,
      statusCode: 429,
    });
  }
  if (response.status === 404) {
    throw new WaveBackendError(
      'This gateway does not offer username and password sign-in.',
      { kind: 'upstream_incompatible', statusCode: 404 },
    );
  }
  if (!response.ok) {
    throw new WaveBackendError('Hermes could not complete the sign-in.', {
      kind: 'upstream_unavailable',
      retryable: true,
      statusCode: response.status,
    });
  }

  const tokens = parseGatewaySetCookies(readSetCookies(response));
  if (!isCompleteTokenSet(tokens)) {
    throw new WaveBackendError(
      'Hermes signed in but did not return a usable session.',
      { kind: 'invalid_response' },
    );
  }
  return tokens;
}
