/**
 * Voice selection for user-keyed Realtime (stage 4). The list is the
 * client-side contract enum — no companion catalog, no server round trip.
 * Previews are deliberately dropped: the companion minted sample clips
 * server-side, and re-creating that would cost a Realtime call per listen
 * on the user's key. The saved preference reuses the existing per-device
 * store, so nothing companion-side changes until stage 5 removes it.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  WAVE_REALTIME_VOICE_IDS,
  type WaveRealtimeVoiceId,
} from '@wave/contracts';
import { Alert, Card, RadioGroup, Spinner } from 'panelui-native';
import { View } from 'react-native';

import {
  realtimeVoicePreferenceQueryKey,
  realtimeVoicePreferenceStore,
} from '@/features/realtime/realtime-voice-preference';
import { REALTIME_DEFAULT_VOICE_PREFERENCE } from '@/services/realtime/realtime-voice-preference-record';

const VOICE_DESCRIPTIONS: Record<WaveRealtimeVoiceId, string> = {
  alloy: 'Balanced and clear.',
  ash: 'Warm and steady.',
  ballad: 'Soft and expressive.',
  cedar: 'Grounded and natural.',
  coral: 'Bright and friendly.',
  echo: 'Calm and direct.',
  marin: 'Crisp and articulate.',
  sage: 'Gentle and thoughtful.',
  shimmer: 'Light and upbeat.',
  verse: 'Animated and quick.',
};

export function RealtimeVoiceCard() {
  const queryClient = useQueryClient();
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
          : WAVE_REALTIME_VOICE_IDS.find((id) => id === value);
      if (!selected) throw new Error('Choose an available Wave voice.');
      await realtimeVoicePreferenceStore.save(selected);
      return selected;
    },
    onSuccess: (value) => {
      queryClient.setQueryData(realtimeVoicePreferenceQueryKey, value);
    },
  });
  const selectedVoice = preference.data ?? REALTIME_DEFAULT_VOICE_PREFERENCE;

  return (
    <Card testID="realtime-voice-card">
      <Card.Header>
        <Card.Title>Live voice sound</Card.Title>
        <Card.Description>
          How Wave sounds on Realtime calls. A new selection applies to your
          next call.
        </Card.Description>
      </Card.Header>
      <Card.Content>
        {preference.isPending ? (
          <View className="items-center py-6">
            <Spinner />
          </View>
        ) : (
          <RadioGroup
            disabled={savePreference.isPending}
            onValueChange={(value) => savePreference.mutate(value)}
            testID="realtime-voice-picker"
            value={selectedVoice}
            variant="card">
            <RadioGroup.Item
              description="Let Wave pick."
              label="Default"
              value={REALTIME_DEFAULT_VOICE_PREFERENCE}
            />
            {WAVE_REALTIME_VOICE_IDS.map((voice) => (
              <RadioGroup.Item
                key={voice}
                description={VOICE_DESCRIPTIONS[voice]}
                label={voice.charAt(0).toUpperCase() + voice.slice(1)}
                value={voice}
              />
            ))}
          </RadioGroup>
        )}
        {savePreference.error ? (
          <Alert
            className="mt-3"
            variant="destructive"
            testID="realtime-voice-error">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Description>
                Wave could not save the voice preference.
              </Alert.Description>
            </Alert.Content>
          </Alert>
        ) : null}
      </Card.Content>
    </Card>
  );
}
