import { Host } from '@expo/ui';
import type { ReactNode } from 'react';
import type { ColorValue } from 'react-native';

// SwiftUI host for the iOS composer island.

export function ChatComposerHost({
  children,
  seedColor,
}: {
  children: ReactNode;
  seedColor: ColorValue;
}) {
  return (
    <Host
      ignoreSafeArea="keyboard"
      matchContents={{ vertical: true }}
      seedColor={seedColor}
      style={{ width: '100%' }}>
      {children}
    </Host>
  );
}
