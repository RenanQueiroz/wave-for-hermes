import { Alert, Button, Card, Spinner, Typography } from 'panelui-native';
import { useState } from 'react';
import { View } from 'react-native';

import {
  isWaveRealtimeModelId,
  WAVE_REALTIME_MODEL_OPTIONS,
} from '@/services/realtime/realtime-model-preference-record';
import { realtimeModelPreference } from '@/state/device-preferences';
import { useDevicePreference } from '@/state/use-device-state';

export function RealtimeModelCard() {
  const preference = useDevicePreference(realtimeModelPreference);
  const [saveError, setSaveError] = useState(false);
  const select = (value: string) => {
    if (!isWaveRealtimeModelId(value)) return;
    setSaveError(false);
    void realtimeModelPreference.set(value).catch(() => setSaveError(true));
  };
  const selectedModel = preference.value;

  return (
    <Card testID="realtime-model-card">
      <Card.Header>
        <Card.Title>Live voice model</Card.Title>
        <Card.Description>
          Choose the OpenAI model for your next Realtime call.
        </Card.Description>
      </Card.Header>
      <Card.Content>
        {!preference.hydrated ? (
          <View className="items-center py-6">
            <Spinner />
          </View>
        ) : (
          <View
            accessibilityLabel="Realtime model choices"
            accessibilityRole="radiogroup"
            className="gap-3"
            testID="realtime-model-picker">
            {WAVE_REALTIME_MODEL_OPTIONS.map((option) => (
              <View key={option.id}>
                <Button
                  fullWidth
                  accessibilityLabel={option.id}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: selectedModel === option.id }}
                  className="h-auto justify-start px-4 py-3"
                  testID={option.testID}
                  variant={
                    selectedModel === option.id ? 'secondary' : 'outline'
                  }
                  onPress={() => select(option.id)}>
                  <View className="flex-1 items-start gap-1">
                    <Typography.Paragraph weight="medium">
                      {option.id}
                    </Typography.Paragraph>
                    <Typography.Paragraph muted type="body-sm">
                      {option.description}
                    </Typography.Paragraph>
                  </View>
                </Button>
              </View>
            ))}
          </View>
        )}
        {saveError ? (
          <Alert
            className="mt-3"
            variant="destructive"
            testID="realtime-model-error">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Description>
                Wave could not save the Realtime model preference.
              </Alert.Description>
            </Alert.Content>
          </Alert>
        ) : null}
      </Card.Content>
    </Card>
  );
}
