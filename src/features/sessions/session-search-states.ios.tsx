import {
  ContentUnavailableView,
  Host,
  ProgressView,
  Text,
  VStack,
} from '@expo/ui/swift-ui';
import {
  accessibilityIdentifier,
  font,
  foregroundStyle,
  frame,
  padding,
} from '@expo/ui/swift-ui/modifiers';

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
      seedColor={theme.primary}
      style={{ width: '100%' }}>
      {pending ? (
        <VStack modifiers={[padding({ vertical: 40 })]}>
          <ProgressView />
        </VStack>
      ) : (
        <ContentUnavailableView
          description={message}
          systemImage="magnifyingglass"
          modifiers={[padding({ vertical: 24 })]}
        />
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
      seedColor={theme.primary}
      style={{ width: '100%' }}>
      <VStack
        alignment="leading"
        modifiers={[frame({ alignment: 'leading', maxWidth: Infinity })]}>
        <Text
          modifiers={[
            font({ size: 13 }),
            foregroundStyle(theme.text),
            padding({ horizontal: 4, vertical: 8 }),
            accessibilityIdentifier('session-search-error'),
          ]}>
          {message}
        </Text>
      </VStack>
    </Host>
  );
}
