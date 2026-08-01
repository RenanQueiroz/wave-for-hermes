/**
 * Scheme policy for the Wave Companion base URL.
 *
 * Plain HTTP is trusted only where the transport is already private:
 * loopback, and Tailscale's CGNAT range (100.64.0.0/10), which is not
 * publicly routable and is carried inside the WireGuard tunnel on a
 * tailnet. Every other host must use HTTPS outside local development.
 */
export function isTrustedPlainHttpHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1') {
    return true;
  }
  const octets = host.split('.');
  if (octets.length !== 4 || octets.some((octet) => !/^\d{1,3}$/.test(octet))) {
    return false;
  }
  const values = octets.map(Number);
  if (values.some((value) => value > 255)) {
    return false;
  }
  return values[0] === 100 && values[1] >= 64 && values[1] <= 127;
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
