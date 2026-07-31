import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Constants from 'expo-constants';
import { Redirect, useRouter } from 'expo-router';
import {
  Alert,
  Button,
  Card,
  Item,
  RadioGroup,
  Spinner,
  Typography,
} from 'panelui-native';
import { Platform, ScrollView, Share, View } from 'react-native';

import { ScreenHeader } from '@/components/navigation/screen-header';
import { useWaveConnection } from '@/features/connection/connection-provider';
import { useReturnToActiveConversation } from '@/features/navigation/use-return-to-active-conversation';
import {
  realtimeVoiceCatalogQueryKey,
  realtimeVoicePreferenceQueryKey,
  realtimeVoicePreferenceStore,
} from '@/features/realtime/realtime-voice-preference';
import { REALTIME_DEFAULT_VOICE_PREFERENCE } from '@/services/realtime/realtime-voice-preference-record';

export function SettingsScreen() {
  const connection = useWaveConnection();
  const router = useRouter();

  if (connection.state.phase !== 'connected') {
    return <Redirect href="/" />;
  }

  if (!connection.client) {
    return <Redirect href="/" />;
  }

  return (
    <ConnectedSettingsScreen
      baseUrl={connection.state.summary.baseUrl}
      client={connection.client}
      connectionId={connection.state.summary.device.id}
      deviceName={connection.state.summary.device.name}
      onOpenDevelopment={() => router.push('/development')}
    />
  );
}

function ConnectedSettingsScreen({
  baseUrl,
  client,
  connectionId,
  deviceName,
  onOpenDevelopment,
}: {
  baseUrl: string;
  client: NonNullable<ReturnType<typeof useWaveConnection>['client']>;
  connectionId: string;
  deviceName: string;
  onOpenDevelopment: () => void;
}) {
  const returnToActiveConversation =
    useReturnToActiveConversation(connectionId);
  const queryClient = useQueryClient();
  const diagnostics = useQuery({
    queryFn: ({ signal }) => client.getDiagnostics(signal),
    queryKey: ['wave', connectionId, baseUrl, 'diagnostics'],
  });
  const catalog = useQuery({
    queryFn: ({ signal }) => client.getRealtimeVoices(signal),
    queryKey: realtimeVoiceCatalogQueryKey(connectionId, baseUrl),
  });
  const preference = useQuery({
    queryFn: () => realtimeVoicePreferenceStore.load(),
    queryKey: realtimeVoicePreferenceQueryKey,
    retry: false,
    staleTime: Infinity,
  });
  const savePreference = useMutation({
    mutationFn: async (value: string) => {
      const selected =
        value === REALTIME_DEFAULT_VOICE_PREFERENCE
          ? value
          : catalog.data?.voices.find((voice) => voice.id === value)?.id;
      if (!selected) {
        throw new Error('Choose an available Wave voice.');
      }
      await realtimeVoicePreferenceStore.save(selected);
      return selected;
    },
    onSuccess: (value) => {
      queryClient.setQueryData(realtimeVoicePreferenceQueryKey, value);
    },
  });
  const selectedVoice = preference.data ?? REALTIME_DEFAULT_VOICE_PREFERENCE;
  const defaultVoice = catalog.data?.voices.find(
    (voice) => voice.id === catalog.data?.defaultVoiceId,
  );
  const shareDiagnostics = async () => {
    if (!diagnostics.data) return;
    await Share.share({
      message: JSON.stringify(
        {
          app: {
            build: __DEV__ ? 'development' : 'production',
            platform: Platform.OS,
            platformVersion: String(Platform.Version),
            version: Constants.expoConfig?.version ?? 'unknown',
          },
          companion: diagnostics.data.companion,
          features: diagnostics.data.features,
          generatedAt: diagnostics.data.generatedAt,
          hermes: diagnostics.data.hermes,
          waveApiVersion: diagnostics.data.apiVersion,
        },
        null,
        2,
      ),
      title: 'Wave diagnostics',
    });
  };

  return (
    <View className="flex-1 bg-background">
      <ScreenHeader title="Settings" onBack={returnToActiveConversation} />
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
                <Item.Title>{deviceName}</Item.Title>
                <Item.Description numberOfLines={2}>{baseUrl}</Item.Description>
              </Item.Content>
            </Item>
          </Card.Content>
        </Card>

        <Card testID="support-diagnostics-card">
          <Card.Header>
            <Card.Title>Support diagnostics</Card.Title>
            <Card.Description>
              A redacted status report without credentials, server addresses, or
              conversation content.
            </Card.Description>
          </Card.Header>
          <Card.Content>
            {diagnostics.isPending ? (
              <View className="items-center py-6">
                <Spinner />
              </View>
            ) : diagnostics.error ? (
              <Alert variant="destructive" testID="diagnostics-error">
                <Alert.Indicator />
                <Alert.Content>
                  <Alert.Title>Diagnostics unavailable</Alert.Title>
                  <Alert.Description>
                    Wave could not load Gateway diagnostics.
                  </Alert.Description>
                </Alert.Content>
              </Alert>
            ) : diagnostics.data ? (
              <View className="gap-3">
                <Item>
                  <Item.Content>
                    <Item.Title>Wave Gateway</Item.Title>
                    <Item.Description>
                      Version {diagnostics.data.companion.serviceVersion}
                    </Item.Description>
                  </Item.Content>
                </Item>
                <Item>
                  <Item.Content>
                    <Item.Title>Hermes</Item.Title>
                    <Item.Description>
                      {hermesDiagnosticDescription(
                        diagnostics.data.hermes.status,
                      )}
                    </Item.Description>
                  </Item.Content>
                </Item>
              </View>
            ) : null}
          </Card.Content>
          <Card.Footer className="gap-2">
            <Button
              disabled={diagnostics.isFetching}
              variant="outline"
              testID="refresh-diagnostics"
              onPress={() => void diagnostics.refetch()}>
              Refresh
            </Button>
            <Button
              disabled={!diagnostics.data}
              testID="share-diagnostics"
              onPress={() => void shareDiagnostics()}>
              Share report
            </Button>
          </Card.Footer>
        </Card>

        <Card testID="voice-settings-card">
          <Card.Header>
            <Card.Title>Live voice</Card.Title>
            <Card.Description>
              Choose how Wave sounds. A new selection applies to your next live
              call.
            </Card.Description>
          </Card.Header>
          <Card.Content>
            {catalog.isPending || preference.isPending ? (
              <View className="items-center py-6">
                <Spinner />
              </View>
            ) : catalog.error ? (
              <Alert variant="destructive" testID="voice-catalog-error">
                <Alert.Indicator />
                <Alert.Content>
                  <Alert.Title>Voices unavailable</Alert.Title>
                  <Alert.Description>
                    Wave could not load the voices authorized by this Gateway.
                  </Alert.Description>
                </Alert.Content>
              </Alert>
            ) : catalog.data ? (
              <RadioGroup
                disabled={savePreference.isPending}
                onValueChange={(value) => savePreference.mutate(value)}
                testID="voice-picker"
                value={selectedVoice}
                variant="card">
                <RadioGroup.Item
                  description={`Follow the Gateway setting${
                    defaultVoice ? ` (${defaultVoice.label})` : ''
                  }.`}
                  label="Gateway default"
                  value={REALTIME_DEFAULT_VOICE_PREFERENCE}
                />
                {catalog.data.voices.map((voice) => (
                  <RadioGroup.Item
                    key={voice.id}
                    description={voice.description}
                    label={voice.label}
                    value={voice.id}
                  />
                ))}
              </RadioGroup>
            ) : null}
            {preference.error || savePreference.error ? (
              <Alert
                className="mt-3"
                variant="destructive"
                testID="voice-preference-error">
                <Alert.Indicator />
                <Alert.Content>
                  <Alert.Title>Preference not saved</Alert.Title>
                  <Alert.Description>
                    Wave will use the Gateway default until this device can
                    access secure storage.
                  </Alert.Description>
                </Alert.Content>
              </Alert>
            ) : null}
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
                onPress={onOpenDevelopment}>
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

function hermesDiagnosticDescription(
  status: 'compatible' | 'incompatible' | 'unreachable',
) {
  switch (status) {
    case 'compatible':
      return 'Compatible';
    case 'incompatible':
      return 'Needs a compatible Hermes version';
    case 'unreachable':
      return 'Currently unreachable';
  }
}
