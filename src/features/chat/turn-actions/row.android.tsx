import { Host, Row, Text, TextButton } from '@expo/ui/jetpack-compose';
import {
  fillMaxWidth,
  height,
  padding,
  testID as testIDModifier,
} from '@expo/ui/jetpack-compose/modifiers';

import { NATIVE_ICON_BUTTON_SIZE } from '@/components/native-icon-button';
import { NativeTurnActionButtons } from '@/features/chat/turn-actions/buttons';
import type { NativeTurnActionRowProps } from '@/features/chat/turn-actions/row.types';

export function NativeTurnActionRow(props: NativeTurnActionRowProps) {
  const { foregroundColor, messageId, onTimestampPress, seedColor, timestamp } =
    props;

  return (
    <Host
      seedColor={seedColor}
      style={{ height: NATIVE_ICON_BUTTON_SIZE, width: '100%' }}>
      <Row
        verticalAlignment="center"
        modifiers={[
          fillMaxWidth(),
          height(NATIVE_ICON_BUTTON_SIZE),
          testIDModifier(`turn-actions-row-${messageId}`),
        ]}>
        <TextButton
          colors={{ contentColor: foregroundColor }}
          contentPadding={{ bottom: 0, end: 8, start: 8, top: 0 }}
          modifiers={[
            height(NATIVE_ICON_BUTTON_SIZE),
            testIDModifier(`turn-time-${messageId}`),
          ]}
          onClick={onTimestampPress}>
          <Text color={foregroundColor} style={{ fontSize: 12 }}>
            {timestamp}
          </Text>
        </TextButton>
        <Text color={foregroundColor} modifiers={[padding(4, 0, 4, 0)]}>
          •
        </Text>
        <NativeTurnActionButtons {...props} />
      </Row>
    </Host>
  );
}
