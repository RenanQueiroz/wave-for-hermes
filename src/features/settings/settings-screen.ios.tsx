/** Native iOS settings, rendered entirely as a SwiftUI Form. */
import { Host } from '@expo/ui';
import {
  Button,
  Form,
  Picker,
  Section,
  SecureField,
  Text,
  Toggle,
  VStack,
} from '@expo/ui/swift-ui';
import {
  accessibilityIdentifier,
  autocorrectionDisabled,
  disabled,
  foregroundStyle,
  keyboardType,
  onSubmit,
  pickerStyle,
  submitLabel,
  tag,
  textInputAutocapitalization,
} from '@expo/ui/swift-ui/modifiers';
import { Redirect } from 'expo-router';
import { useRef } from 'react';

import type { OpenAiKeyFieldRef } from '@/features/realtime/use-openai-key-settings';
import {
  SETTINGS_APPEARANCE_OPTIONS,
  SETTINGS_COPY,
  SETTINGS_REALTIME_MODEL_OPTIONS,
  SETTINGS_REALTIME_VOICE_OPTIONS,
  useSettingsScreen,
} from '@/features/settings/settings-screen.shared';

const SECONDARY_TEXT = foregroundStyle({
  style: 'secondary',
  type: 'hierarchical',
});

function SectionHeader({ children, id }: { children: string; id: string }) {
  // Put the identifier on the leaf header. SwiftUI propagates identifiers
  // from containers to descendants, which would hide the controls' own IDs.
  return <Text modifiers={[accessibilityIdentifier(id)]}>{children}</Text>;
}

function SupportingButton({
  description,
  label,
  onPress,
  testID,
}: {
  description: string;
  label: string;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Button modifiers={[accessibilityIdentifier(testID)]} onPress={onPress}>
      <VStack alignment="leading" spacing={3}>
        <Text>{label}</Text>
        <Text modifiers={[SECONDARY_TEXT]}>{description}</Text>
      </VStack>
    </Button>
  );
}

export function SettingsScreen() {
  const keyDraftRef = useRef<OpenAiKeyFieldRef>(null);
  const settings = useSettingsScreen(keyDraftRef);

  if (!settings.connected) {
    return <Redirect href="/" />;
  }

  const forcedColorScheme =
    settings.appearance === 'system' ? undefined : settings.appearance;

  return (
    <Host colorScheme={forcedColorScheme} style={{ flex: 1 }}>
      <Form>
        <Section
          header={
            <SectionHeader id="gateway-connection-card">
              Connection
            </SectionHeader>
          }
          footer={<Text>{SETTINGS_COPY.connectionFooter}</Text>}>
          <VStack alignment="leading" spacing={3}>
            <Text>{settings.connected.label}</Text>
            <Text modifiers={[SECONDARY_TEXT]}>
              {settings.connected.baseUrl}
            </Text>
          </VStack>
        </Section>

        <Section
          header={
            <SectionHeader id="openai-key-card">
              Live voice (Realtime)
            </SectionHeader>
          }
          footer={<Text>{SETTINGS_COPY.realtimeFooter}</Text>}>
          {settings.keyError && settings.keyPresent ? (
            <Text
              modifiers={[
                foregroundStyle('red'),
                accessibilityIdentifier('openai-key-error'),
              ]}>
              {settings.keyError}
            </Text>
          ) : null}

          {settings.keyPresent ? (
            <>
              <Text modifiers={[accessibilityIdentifier('openai-key-present')]}>
                An OpenAI key is saved on this device.
              </Text>
              <Toggle
                isOn={settings.realtimeEnabled}
                modifiers={[
                  disabled(settings.realtimeEnabledPending),
                  accessibilityIdentifier('realtime-enabled-switch'),
                ]}
                onIsOnChange={settings.setRealtimeEnabled}>
                <Text>Prefer live voice</Text>
                <Text modifiers={[SECONDARY_TEXT]}>
                  {SETTINGS_COPY.realtimePreferenceDescription}
                </Text>
              </Toggle>
              <Toggle
                isOn={settings.captions}
                modifiers={[
                  disabled(!settings.captionsHydrated),
                  accessibilityIdentifier('realtime-captions-switch'),
                ]}
                onIsOnChange={settings.setCaptions}>
                <Text>Live captions</Text>
                <Text modifiers={[SECONDARY_TEXT]}>
                  {SETTINGS_COPY.captionsDescription}
                </Text>
              </Toggle>
              <Button
                label={settings.removeKeyPending ? 'Removing…' : 'Remove key'}
                role="destructive"
                modifiers={[
                  disabled(settings.keyBusy),
                  accessibilityIdentifier('openai-key-remove'),
                ]}
                onPress={settings.removeKey}
              />
            </>
          ) : (
            <>
              {settings.keyError ? (
                <Text
                  modifiers={[
                    foregroundStyle('red'),
                    accessibilityIdentifier('openai-key-error'),
                  ]}>
                  {settings.keyError}
                </Text>
              ) : null}
              <SecureField
                ref={keyDraftRef}
                placeholder="OpenAI API key (sk-…)"
                text={
                  settings.keyDraft as Parameters<typeof SecureField>[0]['text']
                }
                modifiers={[
                  disabled(settings.keyBusy),
                  autocorrectionDisabled(),
                  textInputAutocapitalization('never'),
                  keyboardType('ascii-capable'),
                  submitLabel('done'),
                  onSubmit(settings.saveKey),
                  accessibilityIdentifier('openai-key-input'),
                ]}
                onTextChange={settings.updateKeyDraft}
              />
              <Button
                label={
                  settings.saveKeyPending ? 'Validating…' : 'Validate and save'
                }
                modifiers={[
                  disabled(!settings.canSaveKey),
                  accessibilityIdentifier('openai-key-save'),
                ]}
                onPress={settings.saveKey}
              />
            </>
          )}
        </Section>

        {settings.showRealtimeOptions ? (
          <>
            <Section
              header={
                <SectionHeader id="realtime-model-card">
                  Live voice model
                </SectionHeader>
              }
              footer={<Text>{settings.modelDescription}</Text>}>
              <Picker
                label="Model"
                selection={settings.model}
                modifiers={[
                  pickerStyle('menu'),
                  disabled(!settings.modelHydrated),
                  accessibilityIdentifier('realtime-model-picker'),
                ]}
                onSelectionChange={settings.selectModel}>
                {SETTINGS_REALTIME_MODEL_OPTIONS.map((option) => (
                  <Text
                    key={option.id}
                    modifiers={[
                      tag(option.id),
                      accessibilityIdentifier(option.testID),
                    ]}>
                    {option.id}
                  </Text>
                ))}
              </Picker>
              {settings.modelSaveError ? (
                <Text
                  modifiers={[
                    foregroundStyle('red'),
                    accessibilityIdentifier('realtime-model-error'),
                  ]}>
                  Wave could not save the Realtime model preference.
                </Text>
              ) : null}
            </Section>

            <Section
              header={
                <SectionHeader id="realtime-voice-card">
                  Live voice sound
                </SectionHeader>
              }
              footer={<Text>{settings.voiceDescription}</Text>}>
              <Picker
                label="Voice"
                selection={settings.voice}
                modifiers={[
                  pickerStyle('menu'),
                  disabled(!settings.voiceHydrated),
                  accessibilityIdentifier('realtime-voice-picker'),
                ]}
                onSelectionChange={settings.selectVoice}>
                {SETTINGS_REALTIME_VOICE_OPTIONS.map((option) => (
                  <Text
                    key={option.value}
                    modifiers={[
                      tag(option.value),
                      accessibilityIdentifier(option.testID),
                    ]}>
                    {option.label}
                  </Text>
                ))}
              </Picker>
              {settings.voiceSaveError ? (
                <Text
                  modifiers={[
                    foregroundStyle('red'),
                    accessibilityIdentifier('realtime-voice-error'),
                  ]}>
                  Wave could not save the voice preference.
                </Text>
              ) : null}
            </Section>
          </>
        ) : null}

        <Section
          header={
            <SectionHeader id="appearance-card">Appearance</SectionHeader>
          }
          footer={<Text>{SETTINGS_COPY.themeFooter}</Text>}>
          <Picker
            label="Theme"
            selection={settings.appearance}
            modifiers={[
              pickerStyle('menu'),
              disabled(!settings.appearanceHydrated),
              accessibilityIdentifier('theme-appearance-picker'),
            ]}
            onSelectionChange={settings.selectAppearance}>
            {SETTINGS_APPEARANCE_OPTIONS.map((option) => (
              <Text
                key={option.value}
                modifiers={[
                  tag(option.value),
                  accessibilityIdentifier(option.testID),
                ]}>
                {option.label}
              </Text>
            ))}
          </Picker>
        </Section>

        <Section
          header={<SectionHeader id="legal-card">About</SectionHeader>}
          footer={<Text>{SETTINGS_COPY.aboutFooter}</Text>}>
          <SupportingButton
            description={SETTINGS_COPY.licensesDescription}
            label="Open-source licenses"
            testID="open-source-licenses"
            onPress={settings.openLicenses}
          />
          {settings.showDevelopmentTools ? (
            <SupportingButton
              description={SETTINGS_COPY.developmentToolsDescription}
              label="Open development tools"
              testID="open-development-tools"
              onPress={settings.openDevelopmentTools}
            />
          ) : null}
        </Section>
      </Form>
    </Host>
  );
}
