/**
 * State and mutations for the Settings "Live voice (Realtime)" section: the
 * user-owned OpenAI key that unlocks Realtime.
 *
 * The key is validated with one cheap authenticated call, then lives only in
 * platform secure storage. It is never displayed back, never logged, and
 * never leaves the device except toward api.openai.com. Only its *presence*
 * reaches the query cache. The draft being typed lives in `useNativeState`
 * (native memory shared with the SwiftUI/Compose thread) and is read once at
 * save time; JS only tracks whether a draft exists.
 *
 * This is a hook rather than a section component because Android's
 * `FieldGroup` recognizes only literal `FieldGroup.Section` elements — the
 * screen owns the section JSX.
 */
import { useNativeState, type TextInputRef } from '@expo/ui';
import { useMutation } from '@tanstack/react-query';
import { fetch as expoFetch } from 'expo/fetch';
import { useRef, useState } from 'react';

import {
  openAiKeyStore,
  OPENAI_KEY_PATTERN,
} from '@/services/realtime/openai-key-store';
import { checkOpenAiKey } from '@/services/realtime/openai-key-validation';
import { realtimeCaptionPreference } from '@/state/device-preferences';
import { openAiKeyState } from '@/state/openai-key-state';
import {
  useDevicePreference,
  useHydratedStore,
} from '@/state/use-device-state';

export function useOpenAiKeySettings() {
  const draft = useNativeState('');
  const draftRef = useRef<TextInputRef>(null);
  const [hasDraft, setHasDraft] = useState(false);
  const [error, setError] = useState<string>();

  // Presence and preference only — the key itself never leaves secure storage.
  const state = useHydratedStore(openAiKeyState);

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
      // Blur before the programmatic clear: writing native state into a
      // focused iOS field with an active selection can trap (expo/expo
      // #47434).
      draftRef.current?.blur();
      draftRef.current?.clear();
      setHasDraft(false);
      setError(undefined);
      void openAiKeyState.refresh();
    },
  });

  const removeKey = useMutation({
    mutationFn: () => openAiKeyStore.clear(),
    onError: () => setError('Wave could not remove the key from this device.'),
    onSuccess: () => {
      setError(undefined);
      void openAiKeyState.refresh();
    },
  });

  const setRealtimeEnabled = useMutation({
    mutationFn: (enabled: boolean) =>
      openAiKeyStore.saveRealtimeEnabled(enabled),
    onSettled: () => void openAiKeyState.refresh(),
  });
  const captions = useDevicePreference(realtimeCaptionPreference);

  return {
    captions,
    clearError: () => setError(undefined),
    draft,
    draftRef,
    error,
    hasDraft,
    hasKey: state.hasKey,
    realtimeEnabled: state.realtimeEnabled,
    removeKey,
    saveKey,
    setHasDraft,
    setRealtimeEnabled,
  };
}
