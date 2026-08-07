/**
 * Whether Realtime calls transcribe the user's speech for on-screen captions.
 *
 * Off by default deliberately: input transcription is billed separately on
 * the user's own key (about half a cent per minute), so fresh installs pay
 * nothing extra until the user opts in from Settings.
 */
export const WAVE_REALTIME_DEFAULT_CAPTIONS = false;

export function parseRealtimeCaptionPreference(serialized: string): boolean {
  const value = JSON.parse(serialized) as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid Realtime caption preference.');
  }
  const record = value as Record<string, unknown>;
  if (
    record.version !== 1 ||
    Object.keys(record).some(
      (key) => key !== 'captions' && key !== 'version',
    ) ||
    typeof record.captions !== 'boolean'
  ) {
    throw new Error('Invalid Realtime caption preference.');
  }
  return record.captions;
}

export function serializeRealtimeCaptionPreference(captions: boolean) {
  if (typeof captions !== 'boolean') {
    throw new Error('Invalid Realtime caption preference.');
  }
  return JSON.stringify({ captions, version: 1 });
}
