/** Native iOS settings, rendered entirely as a SwiftUI Form. */
import { Host } from '@expo/ui';
import {
  Button,
  Form,
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
  submitLabel,
  textInputAutocapitalization,
} from '@expo/ui/swift-ui/modifiers';
import { Redirect } from 'expo-router';
import { useRef } from 'react';

import type { OpenAiKeyFieldRef } from '@/features/realtime/use-openai-key-settings';
import { SettingsRow } from '@/features/settings/components/settings-row';
import {
  SETTINGS_COPY,
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
              <SettingsRow
                description={settings.selectedModelLabel}
                enabled={settings.modelHydrated}
                label="Live voice model"
                testID="realtime-model-picker"
                onPress={settings.openModelSettings}
              />
              <SettingsRow
                description={settings.selectedVoiceLabel}
                enabled={settings.voiceHydrated}
                label="Live voice sound"
                testID="realtime-voice-picker"
                onPress={settings.openVoiceSettings}
              />
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

        <Section
          header={
            <SectionHeader id="appearance-card">Appearance</SectionHeader>
          }
          footer={<Text>{SETTINGS_COPY.themeFooter}</Text>}>
          <SettingsRow
            description={settings.selectedAppearanceLabel}
            enabled={settings.appearanceHydrated}
            label="Theme"
            testID="theme-appearance-picker"
            onPress={settings.openAppearanceSettings}
          />
        </Section>

        <Section
          header={<SectionHeader id="legal-card">About</SectionHeader>}
          footer={<Text>{SETTINGS_COPY.aboutFooter}</Text>}>
          <SettingsRow
            description={SETTINGS_COPY.licensesDescription}
            label="Open-source licenses"
            testID="open-source-licenses"
            onPress={settings.openLicenses}
          />
          {settings.showDevelopmentTools ? (
            <SettingsRow
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
