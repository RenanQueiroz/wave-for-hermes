import { Button, Text } from '@expo/ui/swift-ui';

import {
  accessibilityIdentifier,
  accessibilityLabel,
  background,
  buttonStyle,
  contentShape,
  disabled,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  opacity,
  padding,
  shapes,
} from '@expo/ui/swift-ui/modifiers';

import type { NativeModelPillProps } from '@/features/chat/composer/model/pill.types';

/** Exact-height SwiftUI capsule; the universal text button adds outer padding. */
export function NativeModelPill({
  accessibilityLabel: label,
  backgroundColor,
  disabled: inactive,
  foregroundColor,
  label: value,
  onPress,
  testID,
}: NativeModelPillProps) {
  return (
    <Button
      testID={testID}
      onPress={inactive ? undefined : onPress}
      modifiers={[
        buttonStyle('plain'),
        padding({ bottom: 8, leading: 12, top: 8, trailing: 12 }),
        background(backgroundColor, shapes.capsule()),
        frame({ height: 40 }),
        contentShape(shapes.capsule()),
        accessibilityLabel(label),
        accessibilityIdentifier(testID),
        disabled(inactive),
        opacity(inactive ? 0.45 : 1),
      ]}>
      <Text
        modifiers={[
          lineLimit(1),
          font({ size: 13, weight: 'medium' }),
          foregroundStyle(foregroundColor),
        ]}>
        {value}
      </Text>
    </Button>
  );
}
