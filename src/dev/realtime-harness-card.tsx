import { Button, Card } from 'panelui-native';
import { useEffect, useState } from 'react';
import { TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import {
  readRealtimeHarnessUrl,
  setRealtimeHarnessUrl,
} from '@/dev/realtime-harness';

/**
 * Development-only control for Realtime harness mode. With a URL saved, the
 * live-voice screen talks to the local scripted fake instead of OpenAI (and
 * never sends the saved key anywhere); clearing it restores the real service.
 */
export function RealtimeHarnessCard() {
  const [url, setUrl] = useState('');
  const [feedback, setFeedback] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    void readRealtimeHarnessUrl().then((stored) => {
      if (!cancelled && stored) setUrl(stored);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!__DEV__) return null;

  const apply = async (value: string) => {
    try {
      await setRealtimeHarnessUrl(value);
      setUrl(value ? value : '');
      setFeedback(
        value ? 'Harness mode on for new calls.' : 'Harness mode off.',
      );
    } catch (error) {
      setFeedback(
        error instanceof Error
          ? error.message
          : 'Wave could not save that URL.',
      );
    }
  };

  return (
    <Card testID="realtime-harness-card">
      <Card.Header>
        <Card.Title>Realtime harness</Card.Title>
        <Card.Description>
          Point live voice at a local voice-harness fake (testing only). New
          calls use a scripted transport and never contact OpenAI or send the
          saved key.
        </Card.Description>
      </Card.Header>
      <Card.Content className="gap-3">
        <TextInput
          accessibilityLabel="Realtime harness URL"
          autoCapitalize="none"
          autoCorrect={false}
          className="rounded-md border border-border px-3 py-2 text-foreground"
          keyboardType="url"
          placeholder="http://localhost:8790"
          testID="realtime-harness-url-input"
          value={url}
          onChangeText={setUrl}
        />
        <View className="flex-row gap-3">
          <Button
            className="flex-1"
            accessibilityLabel="Save Realtime harness URL"
            testID="realtime-harness-save"
            onPress={() => void apply(url.trim())}>
            Save
          </Button>
          <Button
            className="flex-1"
            variant="outline"
            accessibilityLabel="Clear Realtime harness URL"
            testID="realtime-harness-clear"
            onPress={() => void apply('')}>
            Clear
          </Button>
        </View>
        {feedback ? (
          <ThemedText testID="realtime-harness-feedback">{feedback}</ThemedText>
        ) : null}
      </Card.Content>
    </Card>
  );
}
