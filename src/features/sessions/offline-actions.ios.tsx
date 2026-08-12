/** Native iOS actions for the offline landing, rendered in SwiftUI. */
import { Host } from '@expo/ui';
import { Button, Text, VStack } from '@expo/ui/swift-ui';
import {
  accessibilityIdentifier,
  buttonStyle,
  controlSize,
  disabled,
  foregroundStyle,
  frame,
} from '@expo/ui/swift-ui/modifiers';

import { useTheme } from '@/hooks/use-theme';

import type { OfflineActionsProps } from './offline-actions.types';

export function OfflineActions({
  colorScheme,
  onBrowseCached,
  onRetry,
  retrying,
  seedColor,
}: OfflineActionsProps) {
  const theme = useTheme();

  return (
    <Host
      colorScheme={colorScheme}
      matchContents={{ vertical: true }}
      seedColor={seedColor}
      style={{ width: '100%' }}>
      <VStack spacing={10}>
        <Button
          modifiers={[
            buttonStyle('borderedProminent'),
            controlSize('large'),
            accessibilityIdentifier('offline-browse-cached-button'),
          ]}
          onPress={onBrowseCached}>
          <Text
            modifiers={[
              frame({ maxWidth: Infinity }),
              foregroundStyle(theme.primaryForeground),
            ]}>
            Browse cached conversations
          </Text>
        </Button>
        <Button
          modifiers={[
            buttonStyle('bordered'),
            controlSize('large'),
            disabled(retrying),
            accessibilityIdentifier('offline-retry-connection-button'),
          ]}
          onPress={onRetry}>
          <Text modifiers={[frame({ maxWidth: Infinity })]}>
            {retrying ? 'Trying again…' : 'Try again'}
          </Text>
        </Button>
      </VStack>
    </Host>
  );
}
