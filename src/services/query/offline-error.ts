// Relative on purpose: node-run tests import this module directly and the
// test runner resolves no path aliases.
import { WaveBackendError } from '../wave/wave-backend-client.ts';

const TRANSIENT_STATUS_CODES = new Set([408, 502, 503, 504]);

/**
 * True for connectivity-shaped failures — the device being offline, a
 * timeout, or the companion/Hermes being transiently unreachable — where
 * showing cached data with a quiet offline notice is honest. Every other
 * error keeps its explicit surface; the cache must never mask a real fault.
 */
export function isOfflineLikeWaveError(error: unknown): boolean {
  if (!(error instanceof WaveBackendError)) {
    return false;
  }
  if (error.kind === 'network' || error.kind === 'timeout') {
    return true;
  }
  return (
    error.statusCode !== undefined &&
    TRANSIENT_STATUS_CODES.has(error.statusCode)
  );
}
