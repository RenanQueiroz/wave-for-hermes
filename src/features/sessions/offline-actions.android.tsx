/** Native Android actions for the offline landing, rendered in Jetpack Compose. */
import { Host } from '@expo/ui';
import { Button, Column, OutlinedButton, Text } from '@expo/ui/jetpack-compose';
import {
  fillMaxWidth,
  testID as testIDModifier,
} from '@expo/ui/jetpack-compose/modifiers';

import type { OfflineActionsProps } from './offline-actions.types';
import {
  useWaveMaterialColors,
  wavePrimaryButtonColors,
  waveTextButtonColors,
} from '@/hooks/use-wave-material-colors';

export function OfflineActions({
  colorScheme,
  onBrowseCached,
  onRetry,
  retrying,
  seedColor,
}: OfflineActionsProps) {
  const colors = useWaveMaterialColors({ colorScheme });

  return (
    <Host
      colorScheme={colorScheme}
      matchContents={{ vertical: true }}
      seedColor={seedColor}
      style={{ width: '100%' }}>
      <Column
        verticalArrangement={{ spacedBy: 8 }}
        modifiers={[fillMaxWidth()]}>
        <Button
          colors={wavePrimaryButtonColors(colors)}
          modifiers={[
            fillMaxWidth(),
            testIDModifier('offline-browse-cached-button'),
          ]}
          onClick={onBrowseCached}>
          <Text>Browse cached conversations</Text>
        </Button>
        <OutlinedButton
          colors={waveTextButtonColors(colors)}
          enabled={!retrying}
          modifiers={[
            fillMaxWidth(),
            testIDModifier('offline-retry-connection-button'),
          ]}
          onClick={onRetry}>
          <Text>{retrying ? 'Trying again…' : 'Try again'}</Text>
        </OutlinedButton>
      </Column>
    </Host>
  );
}
