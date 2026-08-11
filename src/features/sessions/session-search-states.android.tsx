import { Box, Host, LoadingIndicator, Text } from '@expo/ui/jetpack-compose';
import {
  fillMaxWidth,
  padding,
  testID as testIDModifier,
} from '@expo/ui/jetpack-compose/modifiers';

import { useTheme } from '@/hooks/use-theme';

export function SearchListEmpty({
  message,
  pending,
}: {
  message: string;
  pending: boolean;
}) {
  const theme = useTheme();
  return (
    <Host
      colorScheme={theme.mode}
      matchContents={{ vertical: true }}
      style={{ width: '100%' }}>
      {pending ? (
        <Box
          contentAlignment="center"
          modifiers={[fillMaxWidth(), padding(0, 40, 0, 40)]}>
          <LoadingIndicator color={theme.primary} />
        </Box>
      ) : (
        <Text
          color={theme.textSecondary}
          style={{ textAlign: 'center', typography: 'bodyMedium' }}
          modifiers={[fillMaxWidth(), padding(16, 32, 16, 32)]}>
          {message}
        </Text>
      )}
    </Host>
  );
}

export function SearchLoadError({ message }: { message: string }) {
  const theme = useTheme();
  return (
    <Host
      colorScheme={theme.mode}
      matchContents={{ vertical: true }}
      style={{ width: '100%' }}>
      <Text
        color={theme.text}
        style={{ typography: 'bodySmall' }}
        modifiers={[
          fillMaxWidth(),
          padding(4, 8, 4, 8),
          testIDModifier('session-search-error'),
        ]}>
        {message}
      </Text>
    </Host>
  );
}
