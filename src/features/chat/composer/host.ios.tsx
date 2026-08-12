import { Host } from '@expo/ui/swift-ui';
import type { ReactNode } from 'react';
import type { ColorValue } from 'react-native';

import { useTheme } from '@/hooks/use-theme';

// SwiftUI host for the iOS composer island.

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
      ignoreSafeArea="keyboard"
      matchContents={{ vertical: true }}
      seedColor={seedColor}
      style={{ width: '100%' }}>
      {children}
    </Host>
  );
}
