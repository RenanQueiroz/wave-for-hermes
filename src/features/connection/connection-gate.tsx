import { Redirect } from 'expo-router';
import { Spinner } from 'panelui-native';
import { View } from 'react-native';

import { useWaveConnection } from './connection-provider';

export function ConnectionGate() {
  const { state } = useWaveConnection();

  if (state.phase === 'loading' || state.phase === 'pairing') {
    return (
      <View
        className="flex-1 items-center justify-center bg-background"
        accessibilityLabel="Loading Wave connection"
        testID="connection-loading">
        <Spinner size="lg" />
      </View>
    );
  }
  return (
    <Redirect
      href={
        state.phase === 'connected'
          ? '/sessions'
          : '/connect'
      }
    />
  );
}
