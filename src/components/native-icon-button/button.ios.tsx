import { Button, Image, ProgressView } from '@expo/ui/swift-ui';
import type { SFSymbol } from 'sf-symbols-typescript';
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

import {
  NATIVE_ICON_BUTTON_SIZE,
  type NativeIconButtonProps,
} from '@/components/native-icon-button/button.types';

export function NativeIconButton({
  accessibilityLabel: label,
  backgroundColor,
  buttonSize = NATIVE_ICON_BUTTON_SIZE,
  disabled,
  foregroundColor,
  icon,
  iconSize = 19,
  loading,
  onPress,
  testID,
  variant = 'plain',
}: NativeIconButtonProps) {
  const inactive = Boolean(disabled || loading);
  const progressSize = Math.min(iconSize, 18);

  return (
    <Button
      testID={testID}
      onPress={inactive ? undefined : onPress}
      modifiers={[
        buttonStyle(variant === 'plain' ? 'plain' : 'borderedProminent'),
        buttonBorderShape('circle'),
        controlSize(buttonSize <= 32 ? 'small' : 'regular'),
        frame({ height: buttonSize, width: buttonSize }),
        contentShape(shapes.circle()),
        ...(backgroundColor ? [tint(backgroundColor)] : []),
        accessibilityLabel(label),
        accessibilityIdentifier(testID),
        disabledModifier(inactive),
        opacity(inactive ? 0.45 : 1),
      ]}>
      {loading ? (
        <ProgressView
          modifiers={[frame({ height: progressSize, width: progressSize })]}
        />
      ) : (
        <Image
          color={foregroundColor}
          size={iconSize}
          systemName={icon as SFSymbol}
        />
      )}
    </Button>
  );
}
