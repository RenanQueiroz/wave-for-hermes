/** One speaker-labeled plain-text transcript block, rendered in Jetpack Compose. */
import { Host } from '@expo/ui';
import { Column, Text } from '@expo/ui/jetpack-compose';
import {
  fillMaxWidth,
  testID as testIDModifier,
} from '@expo/ui/jetpack-compose/modifiers';

import type { VoiceTranscriptProps } from '@/features/voice/voice-screen-ui.types';
import { useTheme } from '@/hooks/use-theme';

export function VoiceTranscript({
  muted,
  speaker,
  testID,
  text,
}: VoiceTranscriptProps) {
  const theme = useTheme();

  return (
    <Host
      colorScheme={theme.mode}
      matchContents={{ vertical: true }}
      seedColor={theme.primary}
      style={{ width: '100%' }}>
      <Column
        verticalArrangement={{ spacedBy: 4 }}
        modifiers={[fillMaxWidth()]}>
        <Text color={theme.text} style={{ typography: 'titleSmall' }}>
          {speaker}
        </Text>
        <Text
          color={muted ? theme.textSecondary : theme.text}
          modifiers={[testIDModifier(testID)]}
          style={{ typography: 'bodyLarge' }}>
          {text}
        </Text>
      </Column>
    </Host>
  );
}
