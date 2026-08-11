import { Host, Row, Text, TextButton } from '@expo/ui/jetpack-compose';
import {
  fillMaxWidth,
  height,
  testID as testIDModifier,
} from '@expo/ui/jetpack-compose/modifiers';

import { NATIVE_ICON_BUTTON_SIZE } from '@/components/native-icon-button';
import {
  NativeTurnActionButtons,
  TURN_ACTION_BUTTON_GAP,
} from '@/features/chat/turn-actions/buttons';
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
        horizontalArrangement={{ spacedBy: TURN_ACTION_BUTTON_GAP }}
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
        <Text color={foregroundColor}>•</Text>
        <Row
          verticalAlignment="center"
          horizontalArrangement={{ spacedBy: TURN_ACTION_BUTTON_GAP }}>
          <NativeTurnActionButtons {...props} />
        </Row>
      </Row>
    </Host>
  );
}
