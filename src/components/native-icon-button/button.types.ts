import type { IconName } from '@expo/ui';

export const NATIVE_ICON_BUTTON_SIZE = 40;

export interface NativeIconButtonProps {
  accessibilityLabel: string;
  backgroundColor?: string;
  buttonSize?: number;
  disabled?: boolean;
  foregroundColor: string;
  icon: IconName;
  iconSize?: number;
  loading?: boolean;
  onPress?: () => void;
  testID: string;
  variant?: 'plain' | 'filled' | 'tonal';
}
