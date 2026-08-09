import { Host, type UniversalHostProps } from '@expo/ui';
import type { ComponentType, ReactNode } from 'react';
import type { ColorValue } from 'react-native';

type AndroidComposerHostProps = UniversalHostProps & {
  ignoreSafeAreaKeyboardInsets?: boolean;
};

// The universal root resolves to the Compose Host at runtime. Its common type
// does not expose this Android-only prop yet, so keep the narrow cast here.
const AndroidHost = Host as ComponentType<AndroidComposerHostProps>;

export function ChatComposerHost({
  children,
  seedColor,
}: {
  children: ReactNode;
  seedColor: ColorValue;
}) {
  return (
    <AndroidHost
      ignoreSafeAreaKeyboardInsets
      matchContents={{ vertical: true }}
      seedColor={seedColor}
      style={{ width: '100%' }}>
      {children}
    </AndroidHost>
  );
}
