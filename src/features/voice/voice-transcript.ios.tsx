/** One speaker-labeled plain-text transcript block, rendered in SwiftUI. */
import { Host } from '@expo/ui';
import { Text, VStack } from '@expo/ui/swift-ui';
import {
  accessibilityIdentifier,
  font,
  foregroundStyle,
  frame,
  textSelection,
} from '@expo/ui/swift-ui/modifiers';

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
      <VStack alignment="leading" spacing={4}>
        <Text
          modifiers={[
            frame({ alignment: 'leading', maxWidth: Infinity }),
            font({ size: 13, weight: 'semibold' }),
            foregroundStyle(theme.text),
          ]}>
          {speaker}
        </Text>
        <Text
          modifiers={[
            frame({ alignment: 'leading', maxWidth: Infinity }),
            font({ size: 16 }),
            foregroundStyle(muted ? theme.textSecondary : theme.text),
            textSelection(true),
            accessibilityIdentifier(testID),
          ]}>
          {text}
        </Text>
      </VStack>
    </Host>
  );
}
