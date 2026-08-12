/** Native iOS actions for the offline landing, rendered in SwiftUI. */
import { Host } from '@expo/ui';
import { Button, Text, VStack } from '@expo/ui/swift-ui';
import {
  accessibilityIdentifier,
  buttonStyle,
  controlSize,
  disabled,
  frame,
} from '@expo/ui/swift-ui/modifiers';

import type { OfflineActionsProps } from './offline-actions.types';

// No seedColor here: PanelUI's dark-theme primary is near-white, and seeding
// SwiftUI's accent with it leaves `borderedProminent` white-on-white. The
// system accent keeps its automatic label contrast (Settings/Connect do the
// same); Android's Material seed derives readable on-primary colors instead.
export function OfflineActions({
  colorScheme,
  onBrowseCached,
  onRetry,
  retrying,
}: OfflineActionsProps) {
  return (
    <Host
      colorScheme={colorScheme}
      matchContents={{ vertical: true }}
      style={{ width: '100%' }}>
      <VStack spacing={10}>
        <Button
          modifiers={[
            buttonStyle('borderedProminent'),
            controlSize('large'),
            accessibilityIdentifier('offline-browse-cached-button'),
          ]}
          onPress={onBrowseCached}>
          <Text modifiers={[frame({ maxWidth: Infinity })]}>
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
