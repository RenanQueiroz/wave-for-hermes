import { Host, Icon } from '@expo/ui';

import { NativeIconButton } from '@/components/native-icon-button';
import { useTheme } from '@/hooks/use-theme';
import { compositeOverlay } from '@/utils/colors';

const JUMP_ICON = Icon.select({
  android: import('@expo/material-symbols/keyboard_arrow_down.xml'),
  ios: 'chevron.down',
});

export function ConversationJumpButton({ onPress }: { onPress(): void }) {
  const theme = useTheme();
  const backgroundColor = compositeOverlay(
    theme.background,
    theme.backgroundElement,
  );

  return (
    <Host matchContents seedColor={theme.primary}>
      <NativeIconButton
        accessibilityLabel="Jump to the newest message"
        backgroundColor={backgroundColor}
        foregroundColor={theme.text}
        icon={JUMP_ICON}
        testID="conversation-jump-to-newest"
        variant="tonal"
        onPress={onPress}
      />
    </Host>
  );
}
