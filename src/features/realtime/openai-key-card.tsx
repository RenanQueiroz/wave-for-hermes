/**
 * Settings card for the user-owned OpenAI key that unlocks Realtime live
 * voice.
 *
 * The key is validated with one cheap authenticated call, then lives only in
 * platform secure storage. It is never displayed back, never logged, and
 * never leaves the device except toward api.openai.com. Only its *presence*
 * reaches the query cache.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetch as expoFetch } from 'expo/fetch';
import { Alert, Button, Card, Input, Switch, Typography } from 'panelui-native';
import { useState } from 'react';
import { View } from 'react-native';

import {
  realtimeCaptionPreferenceQueryKey,
  realtimeCaptionPreferenceStore,
} from '@/features/realtime/realtime-caption-preference';
import {
  openAiKeyStore,
  OPENAI_KEY_PATTERN,
} from '@/services/realtime/openai-key-store';
import { checkOpenAiKey } from '@/services/realtime/openai-key-validation';

export const OPENAI_KEY_STATE_QUERY_KEY = ['wave', 'openai-key-state'] as const;

/** Presence and preference only — the key itself never enters the cache. */
export async function loadOpenAiKeyState() {
  const [key, realtimeEnabled] = await Promise.all([
    openAiKeyStore.load(),
    openAiKeyStore.loadRealtimeEnabled(),
  ]);
  return { hasKey: Boolean(key), realtimeEnabled };
}

export function OpenAiKeyCard() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string>();

  const state = useQuery({
    queryFn: loadOpenAiKeyState,
    queryKey: OPENAI_KEY_STATE_QUERY_KEY,
    staleTime: Infinity,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: OPENAI_KEY_STATE_QUERY_KEY });

  const saveKey = useMutation({
    mutationFn: async (value: string) => {
      const key = value.trim();
      if (!OPENAI_KEY_PATTERN.test(key)) {
        throw new Error(
          'That does not look like an OpenAI key (it starts with "sk-").',
        );
      }
      const check = await checkOpenAiKey(
        key,
        expoFetch as unknown as typeof globalThis.fetch,
      );
      if (check === 'invalid') {
        throw new Error('OpenAI rejected this key. Check it and try again.');
      }
      if (check === 'unreachable') {
        throw new Error(
          'Wave could not reach OpenAI to check the key. Try again when online.',
        );
      }
      await openAiKeyStore.save(key);
    },
    onError: (mutationError) => {
      setError(
        mutationError instanceof Error
          ? mutationError.message
          : 'Wave could not save the key.',
      );
    },
    onSuccess: () => {
      setDraft('');
      setError(undefined);
      void invalidate();
    },
  });

  const removeKey = useMutation({
    mutationFn: () => openAiKeyStore.clear(),
    onError: () => setError('Wave could not remove the key from this device.'),
    onSuccess: () => {
      setError(undefined);
      void invalidate();
    },
  });

  const setRealtimeEnabled = useMutation({
    mutationFn: (enabled: boolean) =>
      openAiKeyStore.saveRealtimeEnabled(enabled),
    onSettled: () => void invalidate(),
  });
  const captions = useQuery({
    queryFn: () => realtimeCaptionPreferenceStore.load(),
    queryKey: realtimeCaptionPreferenceQueryKey,
    staleTime: Infinity,
  });
  const setCaptions = useMutation({
    mutationFn: (enabled: boolean) =>
      realtimeCaptionPreferenceStore.save(enabled),
    onSettled: () =>
      void queryClient.invalidateQueries({
        queryKey: realtimeCaptionPreferenceQueryKey,
      }),
  });

  const hasKey = state.data?.hasKey === true;
  const realtimeEnabled = state.data?.realtimeEnabled !== false;
  const busy = saveKey.isPending || removeKey.isPending;

  return (
    <Card testID="openai-key-card">
      <Card.Header>
        <Card.Title>Live voice (Realtime)</Card.Title>
        <Card.Description>
          Full-duplex voice runs directly against OpenAI with your own API key.
          Use a dedicated project-scoped key so you can revoke it independently.
          It is stored only on this phone and sent only to OpenAI.
        </Card.Description>
      </Card.Header>
      <Card.Content className="gap-4">
        {error ? (
          <Alert variant="destructive" testID="openai-key-error">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Description>{error}</Alert.Description>
            </Alert.Content>
          </Alert>
        ) : null}

        {hasKey ? (
          <View className="gap-4">
            <Typography.Paragraph testID="openai-key-present">
              An OpenAI key is saved on this device.
            </Typography.Paragraph>
            <View className="flex-row items-center justify-between gap-3">
              <View className="flex-1 gap-0.5">
                <Typography.Paragraph weight="medium">
                  Prefer live voice
                </Typography.Paragraph>
                <Typography.Paragraph muted type="body-sm">
                  Use Realtime for voice mode. Off means the keyless server-side
                  voice.
                </Typography.Paragraph>
              </View>
              <View testID="realtime-enabled-switch">
                <Switch
                  disabled={setRealtimeEnabled.isPending}
                  value={realtimeEnabled}
                  onValueChange={(value) => setRealtimeEnabled.mutate(value)}
                />
              </View>
            </View>
            <View className="flex-row items-center justify-between gap-3">
              <View className="flex-1 gap-0.5">
                <Typography.Paragraph weight="medium">
                  Live captions
                </Typography.Paragraph>
                <Typography.Paragraph muted type="body-sm">
                  Show what you said during live voice. Adds about half a cent
                  per minute of transcription billed to your key.
                </Typography.Paragraph>
              </View>
              <View testID="realtime-captions-switch">
                <Switch
                  disabled={setCaptions.isPending || captions.isPending}
                  value={captions.data === true}
                  onValueChange={(value) => setCaptions.mutate(value)}
                />
              </View>
            </View>
          </View>
        ) : (
          <Input
            avoidKeyboard
            secureTextEntry
            accessibilityLabel="OpenAI API key"
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect={false}
            editable={!busy}
            label="OpenAI API key"
            placeholder="sk-…"
            testID="openai-key-input"
            value={draft}
            variant="filled"
            onChangeText={(value) => {
              setDraft(value);
              if (error) setError(undefined);
            }}
          />
        )}
      </Card.Content>
      <Card.Footer>
        {hasKey ? (
          <Button
            variant="destructive"
            accessibilityLabel="Remove the OpenAI key from this device"
            loading={removeKey.isPending}
            testID="openai-key-remove"
            onPress={() => removeKey.mutate()}>
            Remove key
          </Button>
        ) : (
          <Button
            accessibilityLabel="Validate and save the OpenAI key"
            disabled={!draft.trim() || busy}
            loading={saveKey.isPending}
            testID="openai-key-save"
            onPress={() => saveKey.mutate(draft)}>
            Validate and save
          </Button>
        )}
      </Card.Footer>
    </Card>
  );
}
