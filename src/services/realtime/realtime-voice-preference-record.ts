import {
  WaveRealtimeVoiceIdSchema,
  type WaveRealtimeVoiceId,
} from '@wave/contracts';

export const REALTIME_DEFAULT_VOICE_PREFERENCE = 'default' as const;
export type RealtimeVoicePreference =
  typeof REALTIME_DEFAULT_VOICE_PREFERENCE | WaveRealtimeVoiceId;

export function parseRealtimeVoicePreference(
  serialized: string,
): RealtimeVoicePreference {
  const value = JSON.parse(serialized) as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid Realtime voice preference.');
  }
  const record = value as Record<string, unknown>;
  if (
    record.version !== 1 ||
    Object.keys(record).some((key) => key !== 'preference' && key !== 'version')
  ) {
    throw new Error('Invalid Realtime voice preference.');
  }
  if (record.preference === REALTIME_DEFAULT_VOICE_PREFERENCE) {
    return REALTIME_DEFAULT_VOICE_PREFERENCE;
  }
  const voice = WaveRealtimeVoiceIdSchema.safeParse(record.preference);
  if (!voice.success) throw new Error('Invalid Realtime voice preference.');
  return voice.data;
}

export function serializeRealtimeVoicePreference(
  preference: RealtimeVoicePreference,
) {
  const validPreference =
    preference === REALTIME_DEFAULT_VOICE_PREFERENCE
      ? preference
      : WaveRealtimeVoiceIdSchema.parse(preference);
  return JSON.stringify({
    preference: validPreference,
    version: 1,
  });
}
