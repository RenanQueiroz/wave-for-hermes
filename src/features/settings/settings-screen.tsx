import { Redirect, useRouter } from 'expo-router';
import { Button, Card, Item, Typography } from 'panelui-native';
import { ScrollView, View } from 'react-native';

import { ScreenHeader } from '@/components/navigation/screen-header';
import { useWaveConnection } from '@/features/connection/connection-provider';

export function SettingsScreen() {
  const connection = useWaveConnection();
  const router = useRouter();

  if (connection.state.phase !== 'connected') {
    return <Redirect href="/" />;
  }

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Settings" />
      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-5 px-4 py-5">
        <Card>
          <Card.Header>
            <Card.Title>Connection</Card.Title>
            <Card.Description>
              Device-scoped access to your Wave Gateway.
            </Card.Description>
          </Card.Header>
          <Card.Content>
            <Item>
              <Item.Content>
                <Item.Title>{connection.state.summary.device.name}</Item.Title>
                <Item.Description numberOfLines={2}>
                  {connection.state.summary.baseUrl}
                </Item.Description>
              </Item.Content>
            </Item>
          </Card.Content>
        </Card>

        {__DEV__ ? (
          <Card>
            <Card.Header>
              <Card.Title>Development</Card.Title>
              <Card.Description>
                Local diagnostics are only available in development builds.
              </Card.Description>
            </Card.Header>
            <Card.Footer>
              <Button
                variant="outline"
                testID="open-development-tools"
                onPress={() => router.push('/development')}>
                Open development tools
              </Button>
            </Card.Footer>
          </Card>
        ) : null}

        <Typography.Paragraph muted className="text-center text-xs">
          Wave keeps long-lived Hermes and OpenAI credentials on the Gateway,
          not in this app.
        </Typography.Paragraph>
      </ScrollView>
    </View>
  );
}
