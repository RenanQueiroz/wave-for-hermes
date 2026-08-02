/**
 * Gateway session tokens.
 *
 * The Hermes gateway speaks cookies, but Wave is not a browser: it holds the
 * access/refresh pair as opaque values and sends them back on a hand-built
 * `Cookie` header. The gateway rotates BOTH tokens on any request that
 * refreshes an expired access token, so every response's `Set-Cookie` must be
 * harvested and persisted — dropping a rotation silently signs the user out
 * once the old refresh token ages out.
 *
 * Pure module (node-testable); the secure-storage binding lives in
 * `gateway-token-store.ts`.
 */

export const GATEWAY_ACCESS_COOKIE = 'hermes_session_at';
export const GATEWAY_REFRESH_COOKIE = 'hermes_session_rt';
export const GATEWAY_PROVIDER_COOKIE = 'hermes_session_provider';

export interface GatewayTokens {
  accessToken: string;
  provider: string;
  refreshToken: string;
}

const COOKIE_NAMES = new Set([
  GATEWAY_ACCESS_COOKIE,
  GATEWAY_REFRESH_COOKIE,
  GATEWAY_PROVIDER_COOKIE,
]);

/**
 * Parse `Set-Cookie` values into the Wave-relevant tokens. Accepts the
 * `__Host-`/`__Secure-` prefixed variants the gateway emits over HTTPS, and
 * strips the quoting its signed tokens carry.
 */
export function parseGatewaySetCookies(
  values: readonly string[],
): Partial<GatewayTokens> {
  const parsed: Partial<GatewayTokens> = {};
  for (const value of values) {
    const [pair] = value.split(';');
    if (!pair) continue;
    const separator = pair.indexOf('=');
    if (separator <= 0) continue;
    const rawName = pair.slice(0, separator).trim();
    const name = rawName.replace(/^__(?:Host|Secure)-/, '');
    if (!COOKIE_NAMES.has(name)) continue;
    const rawValue = pair
      .slice(separator + 1)
      .trim()
      .replace(/^"(.*)"$/, '$1');
    if (!rawValue) continue;
    if (name === GATEWAY_ACCESS_COOKIE) parsed.accessToken = rawValue;
    if (name === GATEWAY_REFRESH_COOKIE) parsed.refreshToken = rawValue;
    if (name === GATEWAY_PROVIDER_COOKIE) parsed.provider = rawValue;
  }
  return parsed;
}

/**
 * Fold a response's rotated cookies onto the stored pair. Returns the same
 * object when nothing changed so callers can skip a storage write.
 */
export function mergeRotatedTokens(
  current: GatewayTokens,
  rotated: Partial<GatewayTokens>,
): GatewayTokens {
  const next: GatewayTokens = {
    accessToken: rotated.accessToken ?? current.accessToken,
    provider: rotated.provider ?? current.provider,
    refreshToken: rotated.refreshToken ?? current.refreshToken,
  };
  const unchanged =
    next.accessToken === current.accessToken &&
    next.provider === current.provider &&
    next.refreshToken === current.refreshToken;
  return unchanged ? current : next;
}

/** The `Cookie` header value for an authenticated gateway request. */
export function toCookieHeader(tokens: GatewayTokens): string {
  return [
    `${GATEWAY_ACCESS_COOKIE}=${tokens.accessToken}`,
    `${GATEWAY_REFRESH_COOKIE}=${tokens.refreshToken}`,
    `${GATEWAY_PROVIDER_COOKIE}=${tokens.provider}`,
  ].join('; ');
}

export function isCompleteTokenSet(
  value: Partial<GatewayTokens> | undefined,
): value is GatewayTokens {
  return Boolean(value?.accessToken && value.refreshToken && value.provider);
}
