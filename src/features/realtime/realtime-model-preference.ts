import { RealtimeModelPreferenceStore } from '@/services/realtime/realtime-model-preference-store';

export const realtimeModelPreferenceStore = new RealtimeModelPreferenceStore();

export const realtimeModelPreferenceQueryKey = [
  'wave',
  'device',
  'realtime',
  'model-preference',
] as const;
