/**
 * The app's persisted device preferences, one Zustand-backed store each.
 *
 * Every store pairs an existing strict record codec with
 * `createPreferenceStore`: hydrate once from secure storage, degrade to the
 * app-owned default on anything invalid, apply writes optimistically. UI
 * reads them through `use-device-state.ts`; imperative flows (call setup)
 * use `read()`.
 */
// Relative imports with extensions: this module is exercised by the node
// test runner, which resolves neither the `@/` alias nor extensionless paths.
import {
  parseRealtimeCaptionPreference,
  serializeRealtimeCaptionPreference,
  WAVE_REALTIME_DEFAULT_CAPTIONS,
} from '../services/realtime/realtime-caption-preference-record.ts';
import {
  parseRealtimeModelPreference,
  serializeRealtimeModelPreference,
  WAVE_REALTIME_DEFAULT_MODEL,
  type WaveRealtimeModelId,
} from '../services/realtime/realtime-model-preference-record.ts';
import {
  parseRealtimeVoicePreference,
  REALTIME_DEFAULT_VOICE_PREFERENCE,
  serializeRealtimeVoicePreference,
  type RealtimeVoicePreference,
} from '../services/realtime/realtime-voice-preference-record.ts';
import {
  createPreferenceStore,
  type PreferenceStorage,
} from './create-preference-store.ts';

export type WaveThemeAppearance = 'system' | 'light' | 'dark';

export const DEFAULT_THEME_APPEARANCE: WaveThemeAppearance = 'system';

const THEME_APPEARANCES: readonly WaveThemeAppearance[] = [
  'system',
  'light',
  'dark',
];

/**
 * Version 1 records carried a theme family alongside the appearance; only
 * the appearance survives. Version 2 is appearance-only.
 */
export function parseThemeAppearance(serialized: string): WaveThemeAppearance {
  const value = JSON.parse(serialized) as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid theme appearance preference.');
  }
  const record = value as Record<string, unknown>;
  if (
    (record.version !== 1 && record.version !== 2) ||
    !THEME_APPEARANCES.includes(record.appearance as WaveThemeAppearance)
  ) {
    throw new Error('Invalid theme appearance preference.');
  }
  return record.appearance as WaveThemeAppearance;
}

export function serializeThemeAppearance(appearance: WaveThemeAppearance) {
  if (!THEME_APPEARANCES.includes(appearance)) {
    throw new Error('Invalid theme appearance preference.');
  }
  return JSON.stringify({ appearance, version: 2 });
}

/** Factory so tests can build the full set against an injected storage. */
export function createDevicePreferenceStores(storage?: PreferenceStorage) {
  return {
    realtimeCaptions: createPreferenceStore<boolean>({
      codec: {
        decode: parseRealtimeCaptionPreference,
        encode: serializeRealtimeCaptionPreference,
      },
      defaultValue: WAVE_REALTIME_DEFAULT_CAPTIONS,
      key: 'wave.realtime-caption-preference.v1',
      storeErrorMessage: 'Wave could not save the Realtime caption preference.',
      ...(storage ? { storage } : {}),
    }),
    realtimeModel: createPreferenceStore<WaveRealtimeModelId>({
      codec: {
        decode: parseRealtimeModelPreference,
        encode: serializeRealtimeModelPreference,
      },
      defaultValue: WAVE_REALTIME_DEFAULT_MODEL,
      key: 'wave.realtime-model-preference.v1',
      storeErrorMessage: 'Wave could not save the Realtime model preference.',
      ...(storage ? { storage } : {}),
    }),
    realtimeVoice: createPreferenceStore<RealtimeVoicePreference>({
      codec: {
        decode: parseRealtimeVoicePreference,
        encode: serializeRealtimeVoicePreference,
      },
      defaultValue: REALTIME_DEFAULT_VOICE_PREFERENCE,
      key: 'wave.realtime-voice-preference.v1',
      storeErrorMessage: 'Wave could not save the voice preference.',
      ...(storage ? { storage } : {}),
    }),
    themeAppearance: createPreferenceStore<WaveThemeAppearance>({
      codec: {
        decode: parseThemeAppearance,
        encode: serializeThemeAppearance,
      },
      defaultValue: DEFAULT_THEME_APPEARANCE,
      key: 'wave.theme-preference.v1',
      storeErrorMessage: 'Wave could not save the appearance preference.',
      ...(storage ? { storage } : {}),
    }),
  };
}

const stores = createDevicePreferenceStores();

export const realtimeCaptionPreference = stores.realtimeCaptions;
export const realtimeModelPreference = stores.realtimeModel;
export const realtimeVoicePreference = stores.realtimeVoice;
export const themeAppearancePreference = stores.themeAppearance;
