import { Host } from '@expo/ui';
import { Form, Section, Text } from '@expo/ui/swift-ui';
import {
  accessibilityIdentifier,
  foregroundStyle,
} from '@expo/ui/swift-ui/modifiers';
import { Redirect } from 'expo-router';

import { SettingsRow } from '@/features/settings/components/settings-row';
import {
  useSettingsSelection,
  type SettingsSelection,
} from '@/features/settings/selection/settings-selection.shared';

export function SettingsSelectionScreen({
  selection,
}: {
  selection: SettingsSelection;
}) {
  const settings = useSettingsSelection(selection);

  if (!settings.connected) return <Redirect href="/" />;

  const forcedColorScheme =
    settings.appearance === 'system' ? undefined : settings.appearance;

  return (
    <Host colorScheme={forcedColorScheme} style={{ flex: 1 }}>
      <Form>
        <Section>
          {settings.definition.options.map((option) => (
            <SettingsRow
              key={option.value}
              description={option.description}
              enabled={settings.hydrated}
              label={option.label}
              selected={option.value === settings.selectedValue}
              testID={option.testID}
              onPress={() => settings.select(option.value)}
            />
          ))}
          {settings.saveError ? (
            <Text
              modifiers={[
                foregroundStyle('red'),
                accessibilityIdentifier(`settings-${selection}-error`),
              ]}>
              {settings.definition.errorMessage}
            </Text>
          ) : null}
          {settings.previewError ? (
            <Text
              modifiers={[
                foregroundStyle('red'),
                accessibilityIdentifier('settings-voice-preview-error'),
              ]}>
              {settings.previewError}
            </Text>
          ) : null}
        </Section>
      </Form>
    </Host>
  );
}
