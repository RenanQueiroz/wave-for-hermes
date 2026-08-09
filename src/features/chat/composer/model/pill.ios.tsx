import { Button } from '@expo/ui/swift-ui';

import {
  accessibilityIdentifier,
  accessibilityLabel,
  buttonBorderShape,
  buttonStyle,
  contentShape,
  controlSize,
  disabled,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  opacity,
  shapes,
  tint,
} from '@expo/ui/swift-ui/modifiers';

import type { NativeModelPillProps } from '@/features/chat/composer/model/pill.types';

/** Native SwiftUI capsule with the same 40-point frame as the icon buttons. */
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
      label={value}
      testID={testID}
      onPress={inactive ? undefined : onPress}
      modifiers={[
        buttonStyle('borderedProminent'),
        buttonBorderShape('capsule'),
        controlSize('regular'),
        frame({ height: 40 }),
        contentShape(shapes.capsule()),
        tint(backgroundColor),
        lineLimit(1),
        font({ size: 13, weight: 'medium' }),
        foregroundStyle(foregroundColor),
        accessibilityLabel(label),
        accessibilityIdentifier(testID),
        disabled(inactive),
        opacity(inactive ? 0.45 : 1),
      ]}
    />
  );
}
