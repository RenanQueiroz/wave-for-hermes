import { FilledTonalButton, Shape, Text } from '@expo/ui/jetpack-compose';
import {
  height,
  testID as testIDModifier,
} from '@expo/ui/jetpack-compose/modifiers';

import type { NativeModelPillProps } from '@/features/chat/composer/model/pill.types';

export function NativeModelPill({
  accessibilityLabel: _accessibilityLabel,
  backgroundColor,
  disabled,
  foregroundColor,
  label,
  onPress,
  testID,
}: NativeModelPillProps) {
  return (
    <FilledTonalButton
      colors={{
        containerColor: backgroundColor,
        contentColor: foregroundColor,
      }}
      contentPadding={{ bottom: 0, end: 12, start: 12, top: 0 }}
      enabled={!disabled}
      shape={Shape.Pill({})}
      modifiers={[height(40), testIDModifier(testID)]}
      onClick={disabled ? undefined : onPress}>
      <Text
        color={foregroundColor}
        maxLines={1}
        overflow="ellipsis"
        style={{ fontSize: 13, fontWeight: '500' }}>
        {label}
      </Text>
    </FilledTonalButton>
  );
}
