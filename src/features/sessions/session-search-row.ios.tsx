import { Button, Host, Spacer, Text, VStack, HStack } from '@expo/ui/swift-ui';
import {
  accessibilityIdentifier,
  accessibilityLabel,
  buttonStyle,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  padding,
} from '@expo/ui/swift-ui/modifiers';
import { memo } from 'react';

import { useTheme } from '@/hooks/use-theme';

/**
 * Fixed Host height for a two-line result row (title + snippet). Hosted rows
 * inside recycled Legend List cells keep the RN Host and the native row at
 * the same explicit height without `matchContents`.
 */
export const SEARCH_ROW_HEIGHT = 56;

export const SessionSearchRow = memo(function SessionSearchRow({
  description,
  foregroundColor,
  mutedColor,
  onPress,
  testID,
  title,
}: {
  description: string;
  foregroundColor: string;
  mutedColor: string;
  onPress(): void;
  testID: string;
  title: string;
}) {
  const theme = useTheme();
  return (
    <Host
      colorScheme={theme.mode}
      seedColor={theme.primary}
      style={{ height: SEARCH_ROW_HEIGHT, width: '100%' }}>
      <Button
        onPress={onPress}
        modifiers={[
          buttonStyle('plain'),
          frame({ height: SEARCH_ROW_HEIGHT, maxWidth: Infinity }),
          accessibilityIdentifier(testID),
          accessibilityLabel(`Open conversation ${title}`),
        ]}>
        <HStack
          alignment="center"
          modifiers={[
            frame({
              alignment: 'leading',
              height: SEARCH_ROW_HEIGHT,
              maxWidth: Infinity,
            }),
            padding({ horizontal: 4 }),
          ]}>
          <VStack alignment="leading" spacing={3}>
            <Text
              modifiers={[
                font({ size: 15 }),
                foregroundStyle(foregroundColor),
                lineLimit(1),
              ]}>
              {title}
            </Text>
            <Text
              modifiers={[
                font({ size: 13 }),
                foregroundStyle(mutedColor),
                lineLimit(1),
              ]}>
              {description}
            </Text>
          </VStack>
          <Spacer />
        </HStack>
      </Button>
    </Host>
  );
});
