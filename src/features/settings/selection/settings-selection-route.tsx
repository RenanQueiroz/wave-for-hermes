import { Redirect, Stack, useLocalSearchParams } from 'expo-router';

import { SettingsSelectionScreen } from '@/features/settings/selection/settings-selection-screen';
import {
  getSettingsSelection,
  SETTINGS_SELECTION_DEFINITIONS,
} from '@/features/settings/selection/settings-selection.shared';

export function SettingsSelectionRoute() {
  const params = useLocalSearchParams<{
    selection?: string | string[];
  }>();
  const selection = getSettingsSelection(params.selection);

  if (!selection) return <Redirect href="/settings" />;

  return (
    <>
      <Stack.Screen
        options={{ title: SETTINGS_SELECTION_DEFINITIONS[selection].title }}
      />
      <SettingsSelectionScreen selection={selection} />
    </>
  );
}
