/** Inline informational or destructive notice card, rendered in SwiftUI. */
import { Host } from '@expo/ui';
import { HStack, Image, Text, VStack } from '@expo/ui/swift-ui';
import {
  accessibilityIdentifier,
  background,
  font,
  foregroundStyle,
  frame,
  padding,
  shapes,
} from '@expo/ui/swift-ui/modifiers';

import type { VoiceNoticeProps } from '@/features/voice/voice-screen-ui.types';
import { useTheme } from '@/hooks/use-theme';

export function VoiceNotice({
  description,
  destructive,
  testID,
  title,
}: VoiceNoticeProps) {
  const theme = useTheme();
  const accent = destructive ? theme.destructive : theme.text;

  return (
    <Host
      colorScheme={theme.mode}
      matchContents={{ vertical: true }}
      seedColor={theme.primary}
      style={{ width: '100%' }}>
      <HStack
        alignment="top"
        spacing={10}
        modifiers={[
          frame({ maxWidth: Infinity }),
          padding({ horizontal: 14, vertical: 12 }),
          background(
            theme.muted,
            shapes.roundedRectangle({ cornerRadius: 12 }),
          ),
          accessibilityIdentifier(testID),
        ]}>
        <Image
          color={accent}
          size={16}
          systemName={
            destructive ? 'exclamationmark.triangle.fill' : 'info.circle.fill'
          }
        />
        <VStack alignment="leading" spacing={2}>
          <Text
            modifiers={[
              frame({ alignment: 'leading', maxWidth: Infinity }),
              font({ size: 15, weight: 'semibold' }),
              foregroundStyle(accent),
            ]}>
            {title}
          </Text>
          <Text
            modifiers={[
              frame({ alignment: 'leading', maxWidth: Infinity }),
              font({ size: 14 }),
              foregroundStyle(theme.textSecondary),
            ]}>
            {description}
          </Text>
        </VStack>
      </HStack>
    </Host>
  );
}
