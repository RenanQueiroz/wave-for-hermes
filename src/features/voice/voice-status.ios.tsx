/** Native status header for the voice screens, rendered in SwiftUI. */
import { Host } from '@expo/ui';
import { Text, VStack } from '@expo/ui/swift-ui';
import {
  accessibilityIdentifier,
  font,
  foregroundStyle,
  frame,
  multilineTextAlignment,
} from '@expo/ui/swift-ui/modifiers';

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
      <VStack spacing={10}>
        <Text
          modifiers={[
            frame({ maxWidth: Infinity }),
            multilineTextAlignment('center'),
            font({ size: 28, weight: 'bold' }),
            foregroundStyle(theme.text),
          ]}>
          {title}
        </Text>
        <Text
          modifiers={[
            frame({ maxWidth: Infinity }),
            multilineTextAlignment('center'),
            font({ size: 15 }),
            foregroundStyle(theme.textSecondary),
          ]}>
          {description}
        </Text>
        {note ? (
          <Text
            modifiers={[
              frame({ maxWidth: Infinity }),
              multilineTextAlignment('center'),
              font({ size: 12 }),
              foregroundStyle(theme.textSecondary),
              ...(noteTestID ? [accessibilityIdentifier(noteTestID)] : []),
            ]}>
            {note}
          </Text>
        ) : null}
      </VStack>
    </Host>
  );
}
