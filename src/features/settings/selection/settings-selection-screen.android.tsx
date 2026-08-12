import { Host } from '@expo/ui';
import { LazyColumn, Surface, Text } from '@expo/ui/jetpack-compose';
import {
  fillMaxSize,
  padding,
  testID as testIDModifier,
} from '@expo/ui/jetpack-compose/modifiers';
import { Redirect } from 'expo-router';
import { useCSSVariable } from 'uniwind';

import {
  SettingsListGroup,
  SettingsListItem,
} from '@/features/settings/settings-list-item';
import {
  useSettingsSelection,
  type SettingsSelection,
} from '@/features/settings/selection/settings-selection.shared';
import { useTheme } from '@/hooks/use-theme';
import { useWaveMaterialColors } from '@/hooks/use-wave-material-colors';

type NativeColor = NonNullable<Parameters<typeof Surface>[0]['color']>;

export function SettingsSelectionScreen({
  selection,
}: {
  selection: SettingsSelection;
}) {
  const settings = useSettingsSelection(selection);
  const theme = useTheme();
  const background = useCSSVariable('--color-background');
  const colors = useWaveMaterialColors({
    colorScheme:
      settings.appearance === 'system' ? undefined : settings.appearance,
  });

  if (!settings.connected) return <Redirect href="/" />;

  const forcedColorScheme =
    settings.appearance === 'system' ? undefined : settings.appearance;
  const pageBackground: NativeColor =
    typeof background === 'string' ? background : colors.background;

  return (
    <Host
      colorScheme={forcedColorScheme}
      seedColor={theme.primary}
      style={{ flex: 1 }}>
      <Surface color={pageBackground} modifiers={[fillMaxSize()]}>
        <LazyColumn
          contentPadding={{ top: 24, bottom: 32 }}
          modifiers={[fillMaxSize()]}>
          <SettingsListGroup radioGroup>
            {settings.definition.options.map((option) => (
              <SettingsListItem
                key={option.value}
                description={option.description}
                enabled={settings.hydrated}
                label={option.label}
                selected={option.value === settings.selectedValue}
                type="radio"
                testID={option.testID}
                onSelect={() => settings.select(option.value)}
              />
            ))}
          </SettingsListGroup>
          {settings.saveError ? (
            <Text
              color={theme.destructive}
              style={{ typography: 'bodyMedium' }}
              modifiers={[
                padding(24, 16, 24, 0),
                testIDModifier(`settings-${selection}-error`),
              ]}>
              {settings.definition.errorMessage}
            </Text>
          ) : null}
          {settings.previewError ? (
            <Text
              color={theme.destructive}
              style={{ typography: 'bodyMedium' }}
              modifiers={[
                padding(24, 16, 24, 0),
                testIDModifier('settings-voice-preview-error'),
              ]}>
              {settings.previewError}
            </Text>
          ) : null}
        </LazyColumn>
      </Surface>
    </Host>
  );
}
