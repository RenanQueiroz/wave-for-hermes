import { RealtimeCaptionPreferenceStore } from '@/services/realtime/realtime-caption-preference-store';

export const realtimeCaptionPreferenceStore =
  new RealtimeCaptionPreferenceStore();

export const realtimeCaptionPreferenceQueryKey = [
  'wave',
  'device',
  'realtime',
  'caption-preference',
] as const;
