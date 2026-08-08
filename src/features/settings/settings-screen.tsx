import { Redirect, useRouter } from 'expo-router';
import { Button, Card, Item, Typography } from 'panelui-native';
import { ScrollView, View } from 'react-native';
import { ReactNativeLegal } from 'react-native-legal';

import { useConnectedWave } from '@/state/use-connected-wave';
import { OpenAiKeyCard } from '@/features/realtime/openai-key-card';
import { RealtimeModelCard } from '@/features/realtime/realtime-model-card';
import { RealtimeVoiceCard } from '@/features/realtime/realtime-voice-card';
import { AppearanceCard } from '@/features/settings/appearance-card';
import { openAiKeyState } from '@/state/openai-key-state';
import { useHydratedStore } from '@/state/use-device-state';

export function SettingsScreen() {
  const connected = useConnectedWave();
  const router = useRouter();
  // The voice picker only matters once Realtime is possible on this device.
  const keyState = useHydratedStore(openAiKeyState);

  if (!connected) {
    return <Redirect href="/" />;
  }

  const { baseUrl, label } = connected;

  return (
    <View className="flex-1 bg-background">
      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-5 px-4 py-5">
        <Card testID="gateway-connection-card">
          <Card.Header>
            <Card.Title>Connection</Card.Title>
            <Card.Description>
              This phone&apos;s sign-in to your Hermes gateway.
            </Card.Description>
          </Card.Header>
          <Card.Content>
            <Item>
              <Item.Content>
                <Item.Title>{label}</Item.Title>
                <Item.Description numberOfLines={2}>{baseUrl}</Item.Description>
              </Item.Content>
            </Item>
          </Card.Content>
        </Card>

        <OpenAiKeyCard />

        {keyState.hasKey ? (
          <>
            <RealtimeModelCard />
            <RealtimeVoiceCard />
          </>
        ) : null}

        <AppearanceCard />

        <LegalCard />

        <DevelopmentCard
          onOpenDevelopment={() => router.push('/development')}
        />

        <Typography.Paragraph muted className="text-center text-xs">
          Wave stores only this device&apos;s rotating sign-in tokens — and your
          OpenAI key, if you add one — in the platform secure store.
        </Typography.Paragraph>
      </ScrollView>
    </View>
  );
}

function LegalCard() {
  return (
    <Card testID="legal-card">
      <Card.Header>
        <Card.Title>Legal</Card.Title>
        <Card.Description>
          Review the open-source software and licenses included in this build.
        </Card.Description>
      </Card.Header>
      <Card.Footer>
        <Button
          accessibilityLabel="View open-source licenses"
          variant="outline"
          testID="open-source-licenses"
          onPress={() =>
            ReactNativeLegal.launchLicenseListScreen('Open-source licenses')
          }>
          Open-source licenses
        </Button>
      </Card.Footer>
    </Card>
  );
}

function DevelopmentCard({
  onOpenDevelopment,
}: {
  onOpenDevelopment: () => void;
}) {
  if (!__DEV__) return null;
  return (
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
          onPress={onOpenDevelopment}>
          Open development tools
        </Button>
      </Card.Footer>
    </Card>
  );
}
