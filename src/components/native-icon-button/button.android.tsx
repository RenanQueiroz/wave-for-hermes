import {
  CircularProgressIndicator,
  FilledIconButton,
  FilledTonalIconButton,
  Icon,
  IconButton,
} from '@expo/ui/jetpack-compose';
import type { ImageSourcePropType } from 'react-native';
import {
  size,
  testID as testIDModifier,
} from '@expo/ui/jetpack-compose/modifiers';

import {
  NATIVE_ICON_BUTTON_SIZE,
  type NativeIconButtonProps,
} from '@/components/native-icon-button/button.types';

export function NativeIconButton({
  accessibilityLabel,
  backgroundColor,
  buttonSize = NATIVE_ICON_BUTTON_SIZE,
  disabled,
  foregroundColor,
  icon,
  iconSize = 20,
  loading,
  onPress,
  testID,
  variant = 'plain',
}: NativeIconButtonProps) {
  const inactive = Boolean(disabled || loading);
  const Component =
    variant === 'filled'
      ? FilledIconButton
      : variant === 'tonal'
        ? FilledTonalIconButton
        : IconButton;
  const progressSize = Math.min(iconSize, 18);

  return (
    <Component
      colors={{
        ...(backgroundColor ? { containerColor: backgroundColor } : {}),
        contentColor: foregroundColor,
        disabledContentColor: foregroundColor,
      }}
      enabled={!inactive}
      modifiers={[size(buttonSize, buttonSize), testIDModifier(testID)]}
      onClick={inactive ? undefined : onPress}>
      {loading ? (
        <CircularProgressIndicator
          color={foregroundColor}
          modifiers={[size(progressSize, progressSize)]}
          strokeWidth={2}
        />
      ) : (
        <Icon
          contentDescription={accessibilityLabel}
          source={icon as ImageSourcePropType}
          size={iconSize}
          tint={foregroundColor}
        />
      )}
    </Component>
  );
}
