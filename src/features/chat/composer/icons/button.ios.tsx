import { Icon } from '@expo/ui';
import { Button, ProgressView } from '@expo/ui/swift-ui';

import {
  accessibilityIdentifier,
  accessibilityLabel,
  buttonBorderShape,
  buttonStyle,
  contentShape,
  controlSize,
  disabled as disabledModifier,
  frame,
  opacity,
  shapes,
  tint,
} from '@expo/ui/swift-ui/modifiers';

import type { NativeComposerIconButtonProps } from '@/features/chat/composer/icons/button.types';

export function NativeComposerIconButton({
  accessibilityLabel: label,
  backgroundColor,
  disabled,
  foregroundColor,
  icon,
  iconSize = 19,
  loading,
  onPress,
  testID,
  variant = 'plain',
}: NativeComposerIconButtonProps) {
  const inactive = Boolean(disabled || loading);
  return (
    <Button
      testID={testID}
      onPress={inactive ? undefined : onPress}
      modifiers={[
        buttonStyle(variant === 'plain' ? 'plain' : 'borderedProminent'),
        buttonBorderShape('circle'),
        controlSize('regular'),
        frame({ height: 40, width: 40 }),
        contentShape(shapes.circle()),
        ...(backgroundColor ? [tint(backgroundColor)] : []),
        accessibilityLabel(label),
        accessibilityIdentifier(testID),
        disabledModifier(inactive),
        opacity(inactive ? 0.45 : 1),
      ]}>
      {loading ? (
        <ProgressView modifiers={[frame({ height: 18, width: 18 })]} />
      ) : (
        <Icon
          accessibilityLabel={label}
          color={foregroundColor}
          name={icon}
          size={iconSize}
        />
      )}
    </Button>
  );
}
