/** Inline informational or destructive notice card, rendered in Jetpack Compose. */
import { Host } from '@expo/ui';
import { Column, Icon, Row, Text } from '@expo/ui/jetpack-compose';
import {
  Shapes,
  background,
  clip,
  fillMaxWidth,
  padding,
  testID as testIDModifier,
  weight,
} from '@expo/ui/jetpack-compose/modifiers';

import type { VoiceNoticeProps } from '@/features/voice/voice-screen-ui.types';
import { useTheme } from '@/hooks/use-theme';

const NOTICE_ICONS = {
  destructive: require('@expo/material-symbols/error.xml'),
  info: require('@expo/material-symbols/info.xml'),
} as const;

export function VoiceNotice({
  description,
  destructive,
  testID,
  title,
}: VoiceNoticeProps) {
  const theme = useTheme();
  const accent = destructive ? theme.destructive : theme.text;

  return (
    <Host
      colorScheme={theme.mode}
      matchContents={{ vertical: true }}
      seedColor={theme.primary}
      style={{ width: '100%' }}>
      <Row
        horizontalArrangement={{ spacedBy: 10 }}
        verticalAlignment="top"
        modifiers={[
          fillMaxWidth(),
          clip(Shapes.RoundedCorner(16)),
          background(theme.muted),
          padding(14, 12, 14, 12),
          testIDModifier(testID),
        ]}>
        <Icon
          size={18}
          source={destructive ? NOTICE_ICONS.destructive : NOTICE_ICONS.info}
          tint={accent}
        />
        <Column verticalArrangement={{ spacedBy: 2 }} modifiers={[weight(1)]}>
          <Text color={accent} style={{ typography: 'titleSmall' }}>
            {title}
          </Text>
          <Text
            color={theme.textSecondary}
            style={{ typography: 'bodyMedium' }}>
            {description}
          </Text>
        </Column>
      </Row>
    </Host>
  );
}
