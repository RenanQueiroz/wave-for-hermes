import { Host } from '@expo/ui/jetpack-compose';

import { NativeIconButton } from '@/components/native-icon-button';
import { useTheme } from '@/hooks/use-theme';
import { compositeOverlay } from '@/utils/colors';

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
        icon={require('@expo/material-symbols/keyboard_arrow_down.xml')}
        testID="conversation-jump-to-newest"
        variant="tonal"
        onPress={onPress}
      />
    </Host>
  );
}
