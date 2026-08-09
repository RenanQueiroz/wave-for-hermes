import {
  WAVE_REALTIME_VOICE_IDS,
  type WaveRealtimeVoiceId,
} from '@wave/contracts';
import { useRouter } from 'expo-router';
import { useState, type RefObject } from 'react';
import { ReactNativeLegal } from 'react-native-legal';

import {
  useOpenAiKeySettings,
  type OpenAiKeyFieldRef,
} from '@/features/realtime/use-openai-key-settings';
import {
  isWaveRealtimeModelId,
  WAVE_REALTIME_MODEL_OPTIONS,
} from '@/services/realtime/realtime-model-preference-record';
import {
  REALTIME_DEFAULT_VOICE_PREFERENCE,
  type RealtimeVoicePreference,
} from '@/services/realtime/realtime-voice-preference-record';
import {
  realtimeCaptionPreference,
  realtimeModelPreference,
  realtimeVoicePreference,
  themeAppearancePreference,
  type WaveThemeAppearance,
} from '@/state/device-preferences';
import { useConnectedWave } from '@/state/use-connected-wave';
import { useDevicePreference } from '@/state/use-device-state';

const VOICE_DESCRIPTIONS: Record<WaveRealtimeVoiceId, string> = {
  alloy: 'Balanced and clear.',
  ash: 'Warm and steady.',
  ballad: 'Soft and expressive.',
  cedar: 'Grounded and natural.',
  coral: 'Bright and friendly.',
  echo: 'Calm and direct.',
  marin: 'Crisp and articulate.',
  sage: 'Gentle and thoughtful.',
  shimmer: 'Light and upbeat.',
  verse: 'Animated and quick.',
};

export const SETTINGS_APPEARANCE_OPTIONS: readonly {
  label: string;
  testID: string;
  value: WaveThemeAppearance;
}[] = [
  { label: 'System', testID: 'theme-appearance-system', value: 'system' },
  { label: 'Light', testID: 'theme-appearance-light', value: 'light' },
  { label: 'Dark', testID: 'theme-appearance-dark', value: 'dark' },
];

export const SETTINGS_REALTIME_MODEL_OPTIONS = WAVE_REALTIME_MODEL_OPTIONS;

export const SETTINGS_REALTIME_VOICE_OPTIONS: readonly {
  label: string;
  testID: string;
  value: RealtimeVoicePreference;
}[] = [
  {
    label: 'Default',
    testID: 'realtime-voice-default',
    value: REALTIME_DEFAULT_VOICE_PREFERENCE,
  },
  ...WAVE_REALTIME_VOICE_IDS.map((value) => ({
    label: value.charAt(0).toUpperCase() + value.slice(1),
    testID: `realtime-voice-${value}`,
    value,
  })),
];

export const SETTINGS_COPY = {
  aboutFooter:
    "Wave stores only this device's rotating sign-in tokens — and your OpenAI key, if you add one — in the platform secure store.",
  captionsDescription:
    'Show what you said during live voice. Adds $0.0045 per minute of transcription billed to your key.',
  connectionFooter: "This phone's sign-in to your Hermes gateway.",
  developmentToolsDescription:
    'Local diagnostics are only available in development builds.',
  licensesDescription:
    'Review the open-source software and licenses included in this build.',
  realtimeFooter:
    'Full-duplex voice runs directly against OpenAI with your own API key. Use a dedicated project-scoped key so you can revoke it independently. It is stored only on this phone and sent only to OpenAI.',
  realtimePreferenceDescription:
    'Use Realtime for voice mode. Off means the keyless server-side voice.',
  themeFooter: 'Run Wave light, dark, or follow this phone.',
} as const;

/**
 * Owns every platform-neutral setting, mutation, and validation branch. The
 * iOS and Android files deliberately contain presentation only so their
 * SwiftUI and Compose trees can diverge without duplicating product behavior.
 */
export function useSettingsScreen(
  keyDraftRef: RefObject<OpenAiKeyFieldRef | null>,
) {
  const connected = useConnectedWave();
  const router = useRouter();
  const key = useOpenAiKeySettings(keyDraftRef);
  const model = useDevicePreference(realtimeModelPreference);
  const voice = useDevicePreference(realtimeVoicePreference);
  const appearance = useDevicePreference(themeAppearancePreference);
  const [modelSaveError, setModelSaveError] = useState(false);
  const [voiceSaveError, setVoiceSaveError] = useState(false);

  const keyBusy = key.saveKey.isPending || key.removeKey.isPending;
  const selectedModel = SETTINGS_REALTIME_MODEL_OPTIONS.find(
    (option) => option.id === model.value,
  );
  const selectedVoice = SETTINGS_REALTIME_VOICE_OPTIONS.find(
    (option) => option.value === voice.value,
  );
  const selectedAppearance = SETTINGS_APPEARANCE_OPTIONS.find(
    (option) => option.value === appearance.value,
  );

  const selectModel = (value: unknown) => {
    if (!isWaveRealtimeModelId(value)) return;
    setModelSaveError(false);
    void realtimeModelPreference
      .set(value)
      .catch(() => setModelSaveError(true));
  };

  const selectVoice = (value: unknown) => {
    const selected = SETTINGS_REALTIME_VOICE_OPTIONS.find(
      (option) => option.value === value,
    )?.value;
    if (!selected) return;
    setVoiceSaveError(false);
    void realtimeVoicePreference
      .set(selected)
      .catch(() => setVoiceSaveError(true));
  };

  const selectAppearance = (value: unknown) => {
    const selected = SETTINGS_APPEARANCE_OPTIONS.find(
      (option) => option.value === value,
    )?.value;
    if (!selected) return;
    void themeAppearancePreference.set(selected).catch(() => undefined);
  };

  const updateKeyDraft = (value: string) => {
    key.setHasDraft(value.trim().length > 0);
    if (key.error) key.clearError();
  };

  const saveKey = () => {
    if (keyBusy || key.draft.value.trim().length === 0) return;
    key.saveKey.mutate(key.draft.value);
  };

  const voiceDescription =
    voice.value === REALTIME_DEFAULT_VOICE_PREFERENCE
      ? 'Let Wave pick.'
      : VOICE_DESCRIPTIONS[voice.value];

  return {
    appearance: appearance.value,
    appearanceHydrated: appearance.hydrated,
    canSaveKey: key.hasDraft && !keyBusy,
    captions: key.captions.value,
    captionsHydrated: key.captions.hydrated,
    connected,
    keyBusy,
    keyDraft: key.draft,
    keyError: key.error,
    keyPresent: key.hasKey,
    model: model.value,
    modelDescription:
      selectedModel?.description ??
      'Choose the OpenAI model for your next Realtime call.',
    modelHydrated: model.hydrated,
    modelSaveError,
    realtimeEnabled: key.realtimeEnabled,
    realtimeEnabledPending: key.setRealtimeEnabled.isPending,
    removeKeyPending: key.removeKey.isPending,
    saveKeyPending: key.saveKey.isPending,
    selectedAppearanceLabel: selectedAppearance?.label ?? 'System',
    selectedModelLabel: selectedModel?.id ?? model.value,
    selectedVoiceLabel: selectedVoice?.label ?? 'Default',
    showDevelopmentTools: __DEV__,
    showRealtimeOptions: key.hasKey,
    voice: voice.value,
    voiceDescription: `${voiceDescription} A new selection applies to your next call.`,
    voiceHydrated: voice.hydrated,
    voiceSaveError,
    openDevelopmentTools: () => router.push('/development'),
    openLicenses: () =>
      ReactNativeLegal.launchLicenseListScreen('Open-source licenses'),
    removeKey: () => {
      if (!keyBusy) key.removeKey.mutate();
    },
    saveKey,
    selectAppearance,
    selectModel,
    selectVoice,
    setCaptions: (value: boolean) =>
      void realtimeCaptionPreference.set(value).catch(() => undefined),
    setRealtimeEnabled: (value: boolean) =>
      key.setRealtimeEnabled.mutate(value),
    updateKeyDraft,
  };
}
