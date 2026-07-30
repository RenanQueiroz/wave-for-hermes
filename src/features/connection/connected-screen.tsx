import { Redirect, useRouter } from 'expo-router';
import {
  Alert,
  Button,
  Card,
  Typography,
} from 'panelui-native';
import { ScrollView, View } from 'react-native';

import { useWaveConnection } from './connection-provider';

export function ConnectedScreen() {
  const router = useRouter();
  const { disconnect, state } = useWaveConnection();

  if (state.phase !== 'connected') {
    return <Redirect href="/" />;
  }

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentInsetAdjustmentBehavior="automatic"
      contentContainerClassName="mx-auto w-full max-w-xl gap-5 px-5 py-6">
      <Alert variant="success" testID="connection-success">
        <Alert.Indicator />
        <Alert.Content>
          <Alert.Title>Connected to Hermes</Alert.Title>
          <Alert.Description>
            This device passed the companion&apos;s live compatibility check.
          </Alert.Description>
        </Alert.Content>
      </Alert>

      <Card>
        <Card.Header>
          <Card.Title>{state.summary.device.name}</Card.Title>
          <Card.Description selectable>
            {state.summary.baseUrl}
          </Card.Description>
        </Card.Header>
        <Card.Content className="gap-3">
          <View className="gap-1">
            <Typography.Paragraph weight="semibold">
              Text chat is the next slice
            </Typography.Paragraph>
            <Typography.Paragraph muted>
              Pairing, authorization, and Hermes compatibility are ready. The
              session list and conversation UI will build on this connection.
            </Typography.Paragraph>
          </View>
        </Card.Content>
      </Card>

      {__DEV__ ? (
        <Button
          fullWidth
          variant="outline"
          accessibilityLabel="Open Wave development tools"
          testID="development-tools-button"
          onPress={() => router.push('/development')}>
          Development tools
        </Button>
      ) : null}

      <Button
        fullWidth
        variant="ghost"
        accessibilityLabel="Disconnect this Wave device"
        testID="disconnect-device-button"
        onPress={() => void disconnect()}>
        Disconnect this device
      </Button>
    </ScrollView>
  );
}
