import {
  WAVE_REALTIME_VOICE_IDS,
  type WaveRealtimeVoiceId,
} from '@wave/contracts';
import { useState } from 'react';

import { useVoicePreview } from '@/features/realtime/use-voice-preview';
import {
  isWaveRealtimeModelId,
  WAVE_REALTIME_MODEL_OPTIONS,
  type WaveRealtimeModelId,
} from '@/services/realtime/realtime-model-preference-record';
import {
  REALTIME_DEFAULT_VOICE_PREFERENCE,
  resolveRealtimeVoicePreference,
  WAVE_REALTIME_DEFAULT_VOICE,
  type RealtimeVoicePreference,
} from '@/services/realtime/realtime-voice-preference-record';
import {
  realtimeModelPreference,
  realtimeVoicePreference,
  themeAppearancePreference,
  type WaveThemeAppearance,
} from '@/state/device-preferences';
import { useConnectedWave } from '@/state/use-connected-wave';
import { useDevicePreference } from '@/state/use-device-state';

export type SettingsSelection = 'appearance' | 'model' | 'voice';

export interface SettingsSelectionOption<Value extends string = string> {
  description: string;
  label: string;
  testID: string;
  value: Value;
}

export interface SettingsSelectionDefinition {
  errorMessage: string;
  options: readonly SettingsSelectionOption[];
  title: string;
}

const VOICE_DESCRIPTIONS: Record<WaveRealtimeVoiceId, string> = {
  alloy: 'Balanced and clear',
  ash: 'Warm and steady',
  ballad: 'Soft and expressive',
  cedar: 'Grounded and natural',
  coral: 'Bright and friendly',
  echo: 'Calm and direct',
  marin: 'Crisp and articulate',
  sage: 'Gentle and thoughtful',
  shimmer: 'Light and upbeat',
  verse: 'Animated and quick',
};

const APPEARANCE_OPTIONS: readonly SettingsSelectionOption<WaveThemeAppearance>[] =
  [
    {
      description: "Match this phone's appearance",
      label: 'System',
      testID: 'theme-appearance-system',
      value: 'system',
    },
    {
      description: 'Always use the light appearance',
      label: 'Light',
      testID: 'theme-appearance-light',
      value: 'light',
    },
    {
      description: 'Always use the dark appearance',
      label: 'Dark',
      testID: 'theme-appearance-dark',
      value: 'dark',
    },
  ];

const MODEL_OPTIONS: readonly SettingsSelectionOption<WaveRealtimeModelId>[] =
  WAVE_REALTIME_MODEL_OPTIONS.map((option) => ({
    description: option.description,
    label: option.label,
    testID: option.testID,
    value: option.id,
  }));

const DEFAULT_VOICE_LABEL = `Default (${formatVoiceLabel(
  WAVE_REALTIME_DEFAULT_VOICE,
)})`;

const VOICE_OPTIONS: readonly SettingsSelectionOption<RealtimeVoicePreference>[] =
  [
    {
      description: 'Let Wave choose the voice',
      label: DEFAULT_VOICE_LABEL,
      testID: 'realtime-voice-default',
      value: REALTIME_DEFAULT_VOICE_PREFERENCE,
    },
    ...WAVE_REALTIME_VOICE_IDS.map((value) => ({
      description: VOICE_DESCRIPTIONS[value],
      label: formatVoiceLabel(value),
      testID: `realtime-voice-${value}`,
      value,
    })),
  ];

function formatVoiceLabel(value: WaveRealtimeVoiceId) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export const SETTINGS_SELECTION_DEFINITIONS = {
  appearance: {
    errorMessage: 'Wave could not save the appearance preference.',
    options: APPEARANCE_OPTIONS,
    title: 'Appearance',
  },
  model: {
    errorMessage: 'Wave could not save the Realtime model preference.',
    options: MODEL_OPTIONS,
    title: 'Live voice model',
  },
  voice: {
    errorMessage: 'Wave could not save the voice preference.',
    options: VOICE_OPTIONS,
    title: 'Live voice sound',
  },
} as const satisfies Record<SettingsSelection, SettingsSelectionDefinition>;

export const SETTINGS_SELECTION_PATHS = {
  appearance: '/settings/appearance',
  model: '/settings/model',
  voice: '/settings/voice',
} as const;

export function getSettingsSelection(
  value: string | string[] | undefined,
): SettingsSelection | undefined {
  if (typeof value !== 'string') return undefined;
  return value === 'appearance' || value === 'model' || value === 'voice'
    ? value
    : undefined;
}

export function useSettingsPreferences() {
  const appearance = useDevicePreference(themeAppearancePreference);
  const model = useDevicePreference(realtimeModelPreference);
  const voice = useDevicePreference(realtimeVoicePreference);

  const selectedAppearance = APPEARANCE_OPTIONS.find(
    (option) => option.value === appearance.value,
  );
  const selectedModel = MODEL_OPTIONS.find(
    (option) => option.value === model.value,
  );
  const selectedVoice = VOICE_OPTIONS.find(
    (option) => option.value === voice.value,
  );

  return {
    appearance: appearance.value,
    appearanceHydrated: appearance.hydrated,
    model: model.value,
    modelHydrated: model.hydrated,
    selectedAppearanceLabel: selectedAppearance?.label ?? 'System',
    selectedModelLabel: selectedModel?.label ?? model.value,
    selectedVoiceLabel: selectedVoice?.label ?? DEFAULT_VOICE_LABEL,
    voice: voice.value,
    voiceHydrated: voice.hydrated,
  };
}

function setSelectionPreference(
  selection: SettingsSelection,
  value: string,
): Promise<void> | undefined {
  if (selection === 'model') {
    return isWaveRealtimeModelId(value)
      ? realtimeModelPreference.set(value)
      : undefined;
  }

  if (selection === 'voice') {
    const voice = VOICE_OPTIONS.find((option) => option.value === value)?.value;
    return voice ? realtimeVoicePreference.set(voice) : undefined;
  }

  const appearance = APPEARANCE_OPTIONS.find(
    (option) => option.value === value,
  )?.value;
  return appearance ? themeAppearancePreference.set(appearance) : undefined;
}

export function useSettingsSelection(selection: SettingsSelection) {
  const connected = useConnectedWave();
  const preferences = useSettingsPreferences();
  const [saveError, setSaveError] = useState(false);
  const preview = useVoicePreview({ model: preferences.model });
  const definition = SETTINGS_SELECTION_DEFINITIONS[selection];
  const current =
    selection === 'appearance'
      ? {
          hydrated: preferences.appearanceHydrated,
          value: preferences.appearance,
        }
      : selection === 'model'
        ? {
            hydrated: preferences.modelHydrated,
            value: preferences.model,
          }
        : {
            hydrated: preferences.voiceHydrated,
            value: preferences.voice,
          };

  const select = (value: string) => {
    if (!current.hydrated) return;
    if (selection === 'voice') {
      const preference = VOICE_OPTIONS.find(
        (option) => option.value === value,
      )?.value;
      if (!preference) return;
      void preview.play(resolveRealtimeVoicePreference(preference));
    }
    if (value === current.value) return;
    const write = setSelectionPreference(selection, value);
    if (!write) return;
    setSaveError(false);
    void write.catch(() => setSaveError(true));
  };

  return {
    appearance: preferences.appearance,
    connected,
    definition,
    hydrated: current.hydrated,
    previewError: selection === 'voice' ? preview.state.error : undefined,
    saveError,
    selectedValue: current.value,
    select,
  };
}
