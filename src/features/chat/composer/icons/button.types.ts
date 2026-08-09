import type { IconName } from '@expo/ui';

export interface NativeComposerIconButtonProps {
  accessibilityLabel: string;
  backgroundColor?: string;
  disabled?: boolean;
  foregroundColor: string;
  icon: IconName;
  iconSize?: number;
  loading?: boolean;
  onPress?: () => void;
  testID: string;
  variant?: 'plain' | 'filled' | 'tonal';
}
