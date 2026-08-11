import { Host } from '@expo/ui/jetpack-compose';
import type { ReactNode } from 'react';
import type { ColorValue } from 'react-native';

export function ChatComposerHost({
  children,
  seedColor,
}: {
  children: ReactNode;
  seedColor: ColorValue;
}) {
  return (
    <Host
      ignoreSafeAreaKeyboardInsets
      matchContents={{ vertical: true }}
      seedColor={seedColor}
      style={{ width: '100%' }}>
      {children}
    </Host>
  );
}
