import { Button, Row, Text } from '@expo/ui';

import { nativeAccessibilityModifiers } from '@/features/chat/composer/modifiers';
import type { NativeModelPillProps } from '@/features/chat/composer/model/pill.types';

export function NativeModelPill({
  accessibilityLabel,
  backgroundColor,
  disabled,
  foregroundColor,
  label,
  onPress,
  testID,
}: NativeModelPillProps) {
  return (
    <Button
      disabled={disabled}
      testID={testID}
      variant="text"
      style={{
        backgroundColor,
        borderRadius: 20,
        height: 40,
        paddingHorizontal: 12,
      }}
      modifiers={nativeAccessibilityModifiers(accessibilityLabel, testID)}
      onPress={onPress}>
      <Row alignment="center">
        <Text
          numberOfLines={1}
          textStyle={{
            color: foregroundColor,
            fontSize: 13,
            fontWeight: '500',
          }}>
          {label}
        </Text>
      </Row>
    </Button>
  );
}
