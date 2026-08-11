import { Button, Host, HStack, Spacer, Text } from '@expo/ui/swift-ui';
import {
  accessibilityIdentifier,
  buttonStyle,
  font,
  foregroundStyle,
  frame,
  padding,
} from '@expo/ui/swift-ui/modifiers';

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
      <HStack
        alignment="center"
        spacing={TURN_ACTION_BUTTON_GAP}
        modifiers={[
          frame({
            alignment: 'leading',
            height: NATIVE_ICON_BUTTON_SIZE,
            maxWidth: Infinity,
          }),
        ]}>
        <Button
          onPress={onTimestampPress}
          modifiers={[
            buttonStyle('plain'),
            frame({ height: NATIVE_ICON_BUTTON_SIZE }),
            accessibilityIdentifier(`turn-time-${messageId}`),
          ]}>
          <Text
            modifiers={[
              font({ size: 12 }),
              foregroundStyle(foregroundColor),
              padding({ horizontal: 8 }),
            ]}>
            {timestamp}
          </Text>
        </Button>
        <Text modifiers={[foregroundStyle(foregroundColor)]}>•</Text>
        <HStack alignment="center" spacing={TURN_ACTION_BUTTON_GAP}>
          <NativeTurnActionButtons {...props} />
        </HStack>
        <Spacer />
      </HStack>
    </Host>
  );
}
