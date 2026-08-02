/**
 * Scheme policy for the Wave Companion base URL.
 *
 * Plain HTTP splits into two trust tiers:
 *
 * - Hosts where the transport is already private — loopback, and Tailscale's
 *   CGNAT range (100.64.0.0/10), which is not publicly routable and is
 *   carried inside the WireGuard tunnel on a tailnet. Bare hosts in this
 *   tier default to http.
 * - Private LAN hosts — RFC 1918 IPv4 literals and mDNS `.local` names,
 *   which never route beyond the local network but cross it unencrypted.
 *   These are accepted only when the user types `http://` explicitly; bare
 *   hosts still default to https so cleartext is a deliberate choice.
 *   `.local` resolution is the platform resolver's job: iOS and current
 *   Android resolve mDNS names (validated on Android 17); a device that
 *   cannot resolve one falls back to the LAN IP.
 *
 * Every other host must use HTTPS outside local development.
 */
export function isTrustedPlainHttpHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1') {
    return true;
  }
  const octets = parseIpv4(host);
  if (!octets) {
    return false;
  }
  return octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127;
}

/**
 * True for hosts that cannot route beyond the local network: RFC 1918 IPv4
 * literals (10/8, 172.16/12, 192.168/16) and mDNS `.local` names, whose
 * resolution is link-local by construction. Traffic to them is cleartext on
 * the LAN, so these hosts never receive a default scheme — they are valid
 * only with an explicitly typed `http://`.
 */
export function isPrivateLanPlainHttpHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (host.length > '.local'.length && host.endsWith('.local')) {
    return true;
  }
  const octets = parseIpv4(host);
  if (!octets) {
    return false;
  }
  return (
    octets[0] === 10 ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  );
}

/**
 * Prefixes a scheme when the user typed a bare host: https normally,
 * http for hosts where plain HTTP is trusted. Inputs that already carry
 * a scheme, or that cannot be parsed as a host, pass through unchanged
 * so `normalizeWaveBaseUrl` reports the error.
 */
export function applyDefaultScheme(value: string): string {
  const trimmed = value.trim();
  if (trimmed === '' || trimmed.includes('://')) {
    return trimmed;
  }
  let hostname: string;
  try {
    hostname = new URL(`http://${trimmed}`).hostname;
  } catch {
    return trimmed;
  }
  if (!hostname) {
    return trimmed;
  }
  return `${isTrustedPlainHttpHost(hostname) ? 'http' : 'https'}://${trimmed}`;
}

function parseIpv4(host: string): number[] | undefined {
  const octets = host.split('.');
  if (octets.length !== 4 || octets.some((octet) => !/^\d{1,3}$/.test(octet))) {
    return undefined;
  }
  const values = octets.map(Number);
  if (values.some((value) => value > 255)) {
    return undefined;
  }
  return values;
}
