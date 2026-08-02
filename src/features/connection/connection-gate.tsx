import { Redirect } from 'expo-router';
import { Spinner } from 'panelui-native';
import { View } from 'react-native';

import { useWaveConnection } from './connection-provider';

export function ConnectionGate() {
  const { state } = useWaveConnection();

  if (state.phase === 'loading' || state.phase === 'signing-in') {
    return (
      <View
        className="flex-1 items-center justify-center bg-background"
        accessibilityLabel="Loading Wave connection"
        testID="connection-loading">
        <Spinner size="lg" />
      </View>
    );
  }
  // Offline still enters the app: a saved sign-in with cached conversations
  // must stay readable when only the network is missing.
  return (
    <Redirect
      href={
        state.phase === 'connected' || state.phase === 'offline'
          ? '/new'
          : '/connect'
      }
    />
  );
}
