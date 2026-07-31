import { RealtimeVoicePreferenceStore } from '@/services/realtime/realtime-voice-preference-store';

export const realtimeVoicePreferenceStore = new RealtimeVoicePreferenceStore();

export const realtimeVoicePreferenceQueryKey = [
  'wave',
  'device',
  'realtime',
  'voice-preference',
] as const;

export function realtimeVoiceCatalogQueryKey(
  connectionId: string,
  baseUrl: string,
) {
  return ['wave', connectionId, baseUrl, 'realtime', 'voice-catalog'] as const;
}
