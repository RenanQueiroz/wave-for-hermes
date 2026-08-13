import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import type { RefObject } from 'react';
import { ReactNativeLegal } from 'react-native-legal';

import { useWaveConnection } from '@/features/connection/connection-provider';
import {
  useOpenAiKeySettings,
  type OpenAiKeyFieldRef,
} from '@/features/realtime/use-openai-key-settings';
import {
  realtimeCaptionPreference,
  updateAutoCheckPreference,
} from '@/state/device-preferences';
import { useConnectedWave } from '@/state/use-connected-wave';
import { useDevicePreference } from '@/state/use-device-state';

import {
  SETTINGS_SELECTION_PATHS,
  useSettingsPreferences,
} from '@/features/settings/selection/settings-selection.shared';

export const SETTINGS_COPY = {
  captionsDescription:
    'Show what you said during live voice. Adds $0.0045 per minute of transcription billed to your key',
  connectionFooter: 'Your Hermes sign-in is stored securely on this phone.',
  disconnectAlertMessage:
    "Wave will remove this phone's saved sign-in. Active Hermes work will continue, and the gateway can invalidate outstanding tokens only when its token secret rotates.",
  disconnectDescription: "Remove this phone's saved sign-in",
  developmentToolsDescription:
    'Local diagnostics are only available in development builds',
  licensesDescription:
    'Review the open-source software and licenses included in this build',
  realtimeFooter:
    'Your OpenAI key is stored securely on this phone and sent only to OpenAI.',
  realtimePreferenceDescription:
    'Use Realtime for voice mode. Off means the keyless server-side voice',
  updateAutoCheckDescription:
    'Look for new Wave releases on GitHub when the app opens',
  versionDescription: 'The Wave build installed on this phone',
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
  const { disconnect } = useWaveConnection();
  const router = useRouter();
  const key = useOpenAiKeySettings(keyDraftRef);
  const preferences = useSettingsPreferences();
  const updateAutoCheck = useDevicePreference(updateAutoCheckPreference);
  const disconnectMutation = useMutation({
    mutationFn: disconnect,
    onSuccess: (disconnected) => {
      if (disconnected) router.replace('/');
    },
  });

  const keyBusy = key.saveKey.isPending || key.removeKey.isPending;

  const updateKeyDraft = (value: string) => {
    key.setHasDraft(value.trim().length > 0);
    if (key.error) key.clearError();
  };

  const saveKey = () => {
    if (keyBusy || key.draft.value.trim().length === 0) return;
    key.saveKey.mutate(key.draft.value);
  };

  return {
    appearance: preferences.appearance,
    appearanceHydrated: preferences.appearanceHydrated,
    canSaveKey: key.hasDraft && !keyBusy,
    captions: key.captions.value,
    captionsHydrated: key.captions.hydrated,
    connected,
    disconnect: disconnectMutation.mutate,
    disconnecting: disconnectMutation.isPending,
    keyBusy,
    keyDraft: key.draft,
    keyError: key.error,
    keyPresent: key.hasKey,
    modelHydrated: preferences.modelHydrated,
    realtimeEnabled: key.realtimeEnabled,
    realtimeEnabledPending: key.setRealtimeEnabled.isPending,
    removeKeyPending: key.removeKey.isPending,
    saveKeyPending: key.saveKey.isPending,
    selectedAppearanceLabel: preferences.selectedAppearanceLabel,
    selectedModelLabel: preferences.selectedModelLabel,
    selectedVoiceLabel: preferences.selectedVoiceLabel,
    showDevelopmentTools: __DEV__,
    updateAutoCheck: updateAutoCheck.value,
    updateAutoCheckHydrated: updateAutoCheck.hydrated,
    voiceHydrated: preferences.voiceHydrated,
    openAppearanceSettings: () =>
      router.push(SETTINGS_SELECTION_PATHS.appearance),
    openDevelopmentTools: () => router.push('/development'),
    openLicenses: () =>
      ReactNativeLegal.launchLicenseListScreen('Open-source licenses'),
    openModelSettings: () => router.push(SETTINGS_SELECTION_PATHS.model),
    openVoiceSettings: () => router.push(SETTINGS_SELECTION_PATHS.voice),
    removeKey: () => {
      if (!keyBusy) key.removeKey.mutate();
    },
    saveKey,
    setCaptions: (value: boolean) =>
      void realtimeCaptionPreference.set(value).catch(() => undefined),
    setUpdateAutoCheck: (value: boolean) =>
      void updateAutoCheckPreference.set(value).catch(() => undefined),
    setRealtimeEnabled: (value: boolean) =>
      key.setRealtimeEnabled.mutate(value),
    updateKeyDraft,
  };
}
