/**
 * Settings as a native form: SwiftUI `Form` on iOS, Material 3 grouped list
 * on Android, via `@expo/ui` `FieldGroup`. The form owns its own scrolling
 * and keyboard insets, so there is no RN ScrollView here.
 *
 * Every section is a literal `<FieldGroup.Section>` element in this tree:
 * Android's `FieldGroup` groups children by element type and treats custom
 * components as plain rows, cramming a whole section into one row surface.
 * Section logic therefore lives in hooks, and rows use the platform-split
 * `FormRow`/`FormPickerRow`. PanelUI theme tokens cross into native props
 * only through resolved values (`useDestructiveColor`).
 */
import {
  Button,
  FieldGroup,
  Host,
  Picker,
  Switch,
  Text,
  TextInput,
} from '@expo/ui';
import {
  WAVE_REALTIME_VOICE_IDS,
  type WaveRealtimeVoiceId,
} from '@wave/contracts';
import { Redirect, useRouter } from 'expo-router';
import { useState } from 'react';
import { ReactNativeLegal } from 'react-native-legal';

import { FormFooterText, FormPickerRow, FormRow } from '@/components/form-row';
import { useOpenAiKeySettings } from '@/features/realtime/use-openai-key-settings';
import { useDestructiveColor } from '@/hooks/use-theme';
import {
  isWaveRealtimeModelId,
  WAVE_REALTIME_MODEL_OPTIONS,
} from '@/services/realtime/realtime-model-preference-record';
import { REALTIME_DEFAULT_VOICE_PREFERENCE } from '@/services/realtime/realtime-voice-preference-record';
import {
  realtimeCaptionPreference,
  realtimeModelPreference,
  realtimeVoicePreference,
  themeAppearancePreference,
  type WaveThemeAppearance,
} from '@/state/device-preferences';
import { openAiKeyState } from '@/state/openai-key-state';
import { useConnectedWave } from '@/state/use-connected-wave';
import {
  useDevicePreference,
  useHydratedStore,
} from '@/state/use-device-state';

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

const APPEARANCE_OPTIONS: readonly {
  label: string;
  value: WaveThemeAppearance;
}[] = [
  { label: 'System', value: 'system' },
  { label: 'Light', value: 'light' },
  { label: 'Dark', value: 'dark' },
];

export function SettingsScreen() {
  const connected = useConnectedWave();
  const router = useRouter();
  // The Realtime model/voice sections only matter once a key exists.
  const keyState = useHydratedStore(openAiKeyState);
  const {
    captions,
    clearError: clearKeyError,
    draft: keyDraft,
    draftRef: keyDraftRef,
    error: keyError,
    hasDraft: hasKeyDraft,
    hasKey,
    realtimeEnabled,
    removeKey,
    saveKey,
    setHasDraft: setHasKeyDraft,
    setRealtimeEnabled,
  } = useOpenAiKeySettings();
  const model = useDevicePreference(realtimeModelPreference);
  const voice = useDevicePreference(realtimeVoicePreference);
  const appearance = useDevicePreference(themeAppearancePreference);
  const [modelSaveError, setModelSaveError] = useState(false);
  const [voiceSaveError, setVoiceSaveError] = useState(false);
  const destructive = useDestructiveColor();

  if (!connected) {
    return <Redirect href="/" />;
  }

  const keyBusy = saveKey.isPending || removeKey.isPending;

  const selectModel = (value: string) => {
    if (!isWaveRealtimeModelId(value)) return;
    setModelSaveError(false);
    void realtimeModelPreference
      .set(value)
      .catch(() => setModelSaveError(true));
  };
  const selectedModel = WAVE_REALTIME_MODEL_OPTIONS.find(
    (option) => option.id === model.value,
  );

  const selectVoice = (value: string) => {
    const selected =
      value === REALTIME_DEFAULT_VOICE_PREFERENCE
        ? value
        : WAVE_REALTIME_VOICE_IDS.find((id) => id === value);
    if (!selected) return;
    setVoiceSaveError(false);
    void realtimeVoicePreference
      .set(selected)
      .catch(() => setVoiceSaveError(true));
  };
  const voiceDescription =
    voice.value === REALTIME_DEFAULT_VOICE_PREFERENCE
      ? 'Let Wave pick.'
      : VOICE_DESCRIPTIONS[voice.value];

  return (
    <Host style={{ flex: 1 }}>
      <FieldGroup>
        <FieldGroup.Section testID="gateway-connection-card" title="Connection">
          <FormRow supportingText={connected.baseUrl}>
            {connected.label}
          </FormRow>
          <FieldGroup.SectionFooter>
            <FormFooterText>
              This phone&apos;s sign-in to your Hermes gateway.
            </FormFooterText>
          </FieldGroup.SectionFooter>
        </FieldGroup.Section>

        <FieldGroup.Section
          testID="openai-key-card"
          title="Live voice (Realtime)">
          {keyError ? (
            <Text testID="openai-key-error" textStyle={{ color: destructive }}>
              {keyError}
            </Text>
          ) : null}
          {hasKey ? (
            <>
              <Text testID="openai-key-present">
                An OpenAI key is saved on this device.
              </Text>
              <FormRow
                supportingText="Use Realtime for voice mode. Off means the keyless server-side voice."
                trailing={
                  <Switch
                    disabled={setRealtimeEnabled.isPending}
                    testID="realtime-enabled-switch"
                    value={realtimeEnabled}
                    onValueChange={(value) => setRealtimeEnabled.mutate(value)}
                  />
                }>
                Prefer live voice
              </FormRow>
              <FormRow
                supportingText="Show what you said during live voice. Adds $0.0045 per minute of transcription billed to your key."
                trailing={
                  <Switch
                    disabled={!captions.hydrated}
                    testID="realtime-captions-switch"
                    value={captions.value}
                    onValueChange={(value) =>
                      void realtimeCaptionPreference
                        .set(value)
                        .catch(() => undefined)
                    }
                  />
                }>
                Live captions
              </FormRow>
              <Button
                disabled={keyBusy}
                testID="openai-key-remove"
                variant="text"
                onPress={() => removeKey.mutate()}>
                <Text textStyle={{ color: destructive }}>
                  {removeKey.isPending ? 'Removing…' : 'Remove key'}
                </Text>
              </Button>
            </>
          ) : (
            <>
              <TextInput
                ref={keyDraftRef}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                editable={!keyBusy}
                placeholder="OpenAI API key (sk-…)"
                testID="openai-key-input"
                value={keyDraft}
                onChangeText={(text) => {
                  setHasKeyDraft(text.trim().length > 0);
                  if (keyError) clearKeyError();
                }}
              />
              <Button
                disabled={!hasKeyDraft || keyBusy}
                label={saveKey.isPending ? 'Validating…' : 'Validate and save'}
                testID="openai-key-save"
                variant="text"
                onPress={() => saveKey.mutate(keyDraft.value)}
              />
            </>
          )}
          <FieldGroup.SectionFooter>
            <FormFooterText>
              Full-duplex voice runs directly against OpenAI with your own API
              key. Use a dedicated project-scoped key so you can revoke it
              independently. It is stored only on this phone and sent only to
              OpenAI.
            </FormFooterText>
          </FieldGroup.SectionFooter>
        </FieldGroup.Section>

        {keyState.hasKey ? (
          <>
            <FieldGroup.Section
              testID="realtime-model-card"
              title="Live voice model">
              <FormPickerRow label="Model">
                <Picker
                  appearance="menu"
                  enabled={model.hydrated}
                  selectedValue={model.value}
                  testID="realtime-model-picker"
                  onValueChange={(value) => selectModel(String(value))}>
                  {WAVE_REALTIME_MODEL_OPTIONS.map((option) => (
                    <Picker.Item
                      key={option.id}
                      label={option.id}
                      value={option.id}
                    />
                  ))}
                </Picker>
              </FormPickerRow>
              {modelSaveError ? (
                <Text
                  testID="realtime-model-error"
                  textStyle={{ color: destructive }}>
                  Wave could not save the Realtime model preference.
                </Text>
              ) : null}
              <FieldGroup.SectionFooter>
                <FormFooterText>
                  {selectedModel
                    ? selectedModel.description
                    : 'Choose the OpenAI model for your next Realtime call.'}
                </FormFooterText>
              </FieldGroup.SectionFooter>
            </FieldGroup.Section>

            <FieldGroup.Section
              testID="realtime-voice-card"
              title="Live voice sound">
              <FormPickerRow label="Voice">
                <Picker
                  appearance="menu"
                  enabled={voice.hydrated}
                  selectedValue={voice.value}
                  testID="realtime-voice-picker"
                  onValueChange={(value) => selectVoice(String(value))}>
                  <Picker.Item
                    label="Default"
                    value={REALTIME_DEFAULT_VOICE_PREFERENCE}
                  />
                  {WAVE_REALTIME_VOICE_IDS.map((id) => (
                    <Picker.Item
                      key={id}
                      label={id.charAt(0).toUpperCase() + id.slice(1)}
                      value={id}
                    />
                  ))}
                </Picker>
              </FormPickerRow>
              {voiceSaveError ? (
                <Text
                  testID="realtime-voice-error"
                  textStyle={{ color: destructive }}>
                  Wave could not save the voice preference.
                </Text>
              ) : null}
              <FieldGroup.SectionFooter>
                <FormFooterText>
                  {`${voiceDescription} A new selection applies to your next call.`}
                </FormFooterText>
              </FieldGroup.SectionFooter>
            </FieldGroup.Section>
          </>
        ) : null}

        <FieldGroup.Section testID="appearance-card" title="Appearance">
          <FormPickerRow label="Theme">
            <Picker
              appearance="menu"
              enabled={appearance.hydrated}
              selectedValue={appearance.value}
              testID="theme-appearance-picker"
              onValueChange={(value) =>
                void themeAppearancePreference
                  .set(value as WaveThemeAppearance)
                  .catch(() => undefined)
              }>
              {APPEARANCE_OPTIONS.map((option) => (
                <Picker.Item
                  key={option.value}
                  label={option.label}
                  value={option.value}
                />
              ))}
            </Picker>
          </FormPickerRow>
          <FieldGroup.SectionFooter>
            <FormFooterText>
              Run Wave light, dark, or follow this phone.
            </FormFooterText>
          </FieldGroup.SectionFooter>
        </FieldGroup.Section>

        <FieldGroup.Section testID="legal-card" title="About">
          <FormRow
            supportingText="Review the open-source software and licenses included in this build."
            testID="open-source-licenses"
            onPress={() =>
              ReactNativeLegal.launchLicenseListScreen('Open-source licenses')
            }>
            Open-source licenses
          </FormRow>
          {__DEV__ ? (
            <FormRow
              supportingText="Local diagnostics are only available in development builds."
              testID="open-development-tools"
              onPress={() => router.push('/development')}>
              Open development tools
            </FormRow>
          ) : null}
          <FieldGroup.SectionFooter>
            <FormFooterText>
              Wave stores only this device&apos;s rotating sign-in tokens — and
              your OpenAI key, if you add one — in the platform secure store.
            </FormFooterText>
          </FieldGroup.SectionFooter>
        </FieldGroup.Section>
      </FieldGroup>
    </Host>
  );
}
