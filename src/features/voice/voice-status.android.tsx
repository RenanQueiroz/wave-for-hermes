/** Native status header for the voice screens, rendered in Jetpack Compose. */
import { Host } from '@expo/ui';
import { Column, Text } from '@expo/ui/jetpack-compose';
import {
  fillMaxWidth,
  testID as testIDModifier,
} from '@expo/ui/jetpack-compose/modifiers';

import type { VoiceStatusProps } from '@/features/voice/voice-screen-ui.types';
import { useTheme } from '@/hooks/use-theme';

export function VoiceStatus({
  description,
  note,
  noteTestID,
  title,
}: VoiceStatusProps) {
  const theme = useTheme();

  return (
    <Host
      colorScheme={theme.mode}
      matchContents={{ vertical: true }}
      seedColor={theme.primary}
      style={{ width: '100%' }}>
      <Column
        horizontalAlignment="center"
        verticalArrangement={{ spacedBy: 10 }}
        modifiers={[fillMaxWidth()]}>
        <Text
          color={theme.text}
          style={{ textAlign: 'center', typography: 'headlineMedium' }}>
          {title}
        </Text>
        <Text
          color={theme.textSecondary}
          style={{ textAlign: 'center', typography: 'bodyLarge' }}>
          {description}
        </Text>
        {note ? (
          <Text
            color={theme.textSecondary}
            modifiers={noteTestID ? [testIDModifier(noteTestID)] : undefined}
            style={{ textAlign: 'center', typography: 'bodySmall' }}>
            {note}
          </Text>
        ) : null}
      </Column>
    </Host>
  );
}
