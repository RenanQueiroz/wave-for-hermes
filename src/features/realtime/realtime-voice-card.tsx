/**
 * Voice selection for user-keyed Realtime. The list is the client-side
 * contract enum — no server catalog, no round trip. Previews are
 * deliberately absent: minting a sample clip would cost a Realtime call per
 * listen on the user's key. The saved preference is a per-device store.
 */
import {
  WAVE_REALTIME_VOICE_IDS,
  type WaveRealtimeVoiceId,
} from '@wave/contracts';
import { Alert, Card, RadioGroup, Spinner } from 'panelui-native';
import { useState } from 'react';
import { View } from 'react-native';

import { REALTIME_DEFAULT_VOICE_PREFERENCE } from '@/services/realtime/realtime-voice-preference-record';
import { realtimeVoicePreference } from '@/state/device-preferences';
import { useDevicePreference } from '@/state/use-device-state';

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
  const preference = useDevicePreference(realtimeVoicePreference);
  const [saveError, setSaveError] = useState(false);
  const select = (value: string) => {
    const selected =
      value === REALTIME_DEFAULT_VOICE_PREFERENCE
        ? value
        : WAVE_REALTIME_VOICE_IDS.find((id) => id === value);
    if (!selected) return;
    setSaveError(false);
    void realtimeVoicePreference.set(selected).catch(() => setSaveError(true));
  };
  const selectedVoice = preference.value;

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
        {!preference.hydrated ? (
          <View className="items-center py-6">
            <Spinner />
          </View>
        ) : (
          <RadioGroup
            onValueChange={(value) => select(value)}
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
        {saveError ? (
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
