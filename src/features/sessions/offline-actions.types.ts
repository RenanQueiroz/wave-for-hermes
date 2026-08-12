import type { ColorValue } from 'react-native';

/** Shared contract for the offline landing's platform-native action stack. */
export interface OfflineActionsProps {
  colorScheme?: 'light' | 'dark';
  onBrowseCached(): void;
  onRetry(): void;
  retrying: boolean;
  seedColor: ColorValue;
}
