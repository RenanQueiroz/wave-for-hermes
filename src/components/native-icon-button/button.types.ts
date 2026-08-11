import type { SFSymbol } from 'sf-symbols-typescript';
import type { ImageSourcePropType } from 'react-native';

export const NATIVE_ICON_BUTTON_SIZE = 40;

export type NativeIconSource = ImageSourcePropType | SFSymbol;

export interface NativeIconButtonProps {
  accessibilityLabel: string;
  backgroundColor?: string;
  buttonSize?: number;
  disabled?: boolean;
  foregroundColor: string;
  icon: NativeIconSource;
  iconSize?: number;
  loading?: boolean;
  onPress?: () => void;
  testID: string;
  variant?: 'plain' | 'filled' | 'tonal';
}
