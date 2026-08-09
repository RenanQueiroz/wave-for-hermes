import { Icon } from '@expo/ui';
import {
  CircularProgressIndicator,
  FilledIconButton,
  FilledTonalIconButton,
  IconButton,
} from '@expo/ui/jetpack-compose';
import {
  size,
  testID as testIDModifier,
} from '@expo/ui/jetpack-compose/modifiers';

import type { NativeComposerIconButtonProps } from '@/features/chat/composer/icons/button.types';

export function NativeComposerIconButton({
  accessibilityLabel,
  backgroundColor,
  disabled,
  foregroundColor,
  icon,
  iconSize = 20,
  loading,
  onPress,
  testID,
  variant = 'plain',
}: NativeComposerIconButtonProps) {
  const inactive = Boolean(disabled || loading);
  const Component =
    variant === 'filled'
      ? FilledIconButton
      : variant === 'tonal'
        ? FilledTonalIconButton
        : IconButton;
  return (
    <Component
      colors={{
        ...(backgroundColor ? { containerColor: backgroundColor } : {}),
        contentColor: foregroundColor,
        disabledContentColor: foregroundColor,
      }}
      enabled={!inactive}
      modifiers={[size(40, 40), testIDModifier(testID)]}
      onClick={inactive ? undefined : onPress}>
      {loading ? (
        <CircularProgressIndicator
          color={foregroundColor}
          modifiers={[size(18, 18)]}
          strokeWidth={2}
        />
      ) : (
        <Icon
          accessibilityLabel={accessibilityLabel}
          color={foregroundColor}
          name={icon}
          size={iconSize}
        />
      )}
    </Component>
  );
}
