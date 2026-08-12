import { Host } from '@expo/ui/jetpack-compose';
import type { ReactNode } from 'react';
import type { ColorValue } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

export function ChatComposerHost({
  children,
  seedColor,
}: {
  children: ReactNode;
  seedColor: ColorValue;
}) {
  const theme = useTheme();
  return (
    <Host
      colorScheme={theme.mode}
      ignoreSafeAreaKeyboardInsets
      matchContents={{ vertical: true }}
      seedColor={seedColor}
      style={{ width: '100%' }}>
      {children}
    </Host>
  );
}
