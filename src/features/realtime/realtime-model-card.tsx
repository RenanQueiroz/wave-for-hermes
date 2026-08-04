import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Card, Spinner, Typography } from 'panelui-native';
import { View } from 'react-native';

import {
  realtimeModelPreferenceQueryKey,
  realtimeModelPreferenceStore,
} from '@/features/realtime/realtime-model-preference';
import {
  isWaveRealtimeModelId,
  WAVE_REALTIME_DEFAULT_MODEL,
  WAVE_REALTIME_MODEL_OPTIONS,
} from '@/services/realtime/realtime-model-preference-record';

export function RealtimeModelCard() {
  const queryClient = useQueryClient();
  const preference = useQuery({
    queryFn: () => realtimeModelPreferenceStore.load(),
    queryKey: realtimeModelPreferenceQueryKey,
    retry: false,
    staleTime: Infinity,
  });
  const savePreference = useMutation({
    mutationFn: async (value: string) => {
      if (!isWaveRealtimeModelId(value)) {
        throw new Error('Choose a supported Realtime model.');
      }
      await realtimeModelPreferenceStore.save(value);
      return value;
    },
    onSuccess: (value) => {
      queryClient.setQueryData(realtimeModelPreferenceQueryKey, value);
    },
    retry: false,
  });
  const selectedModel = preference.data ?? WAVE_REALTIME_DEFAULT_MODEL;

  return (
    <Card testID="realtime-model-card">
      <Card.Header>
        <Card.Title>Live voice model</Card.Title>
        <Card.Description>
          Choose the OpenAI model for your next Realtime call.
        </Card.Description>
      </Card.Header>
      <Card.Content>
        {preference.isPending ? (
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
              <View
                className={savePreference.isPending ? 'opacity-50' : undefined}
                key={option.id}>
                <Button
                  fullWidth
                  accessibilityLabel={option.id}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: selectedModel === option.id }}
                  className="h-auto justify-start px-4 py-3"
                  disabled={savePreference.isPending}
                  testID={option.testID}
                  variant={
                    selectedModel === option.id ? 'secondary' : 'outline'
                  }
                  onPress={() => savePreference.mutate(option.id)}>
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
        {savePreference.error ? (
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
