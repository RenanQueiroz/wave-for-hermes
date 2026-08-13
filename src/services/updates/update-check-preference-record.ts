/**
 * Versioned device record for the Android "automatically check for updates"
 * preference. On by default; any malformed stored record degrades to the
 * default.
 */

export const WAVE_UPDATE_AUTO_CHECK_DEFAULT = true;

export function parseUpdateAutoCheckPreference(serialized: string): boolean {
  const value = JSON.parse(serialized) as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid update auto-check preference.');
  }
  const record = value as Record<string, unknown>;
  if (
    record.version !== 1 ||
    Object.keys(record).some(
      (key) => key !== 'autoCheck' && key !== 'version',
    ) ||
    typeof record.autoCheck !== 'boolean'
  ) {
    throw new Error('Invalid update auto-check preference.');
  }
  return record.autoCheck;
}

export function serializeUpdateAutoCheckPreference(autoCheck: boolean) {
  if (typeof autoCheck !== 'boolean') {
    throw new Error('Invalid update auto-check preference.');
  }
  return JSON.stringify({ autoCheck, version: 1 });
}
