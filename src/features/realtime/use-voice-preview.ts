import type { WaveRealtimeVoiceId } from '@wave/contracts';
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  OpenAiRealtimeVoiceSampler,
  OpenAiRealtimeVoiceSampleError,
} from '@/services/realtime/openai-realtime-voice-sampler';
import {
  openAiKeyStore,
  OpenAiKeyStoreError,
} from '@/services/realtime/openai-key-store';
import type { WaveRealtimeModelId } from '@/services/realtime/realtime-model-preference-record';
import { VoiceSampleCache } from '@/services/realtime/voice-sample-cache';

type Player = ReturnType<typeof createAudioPlayer>;

export interface VoicePreviewState {
  activeVoiceId?: WaveRealtimeVoiceId;
  error?: string;
  status: 'idle' | 'loading' | 'playing' | 'error';
}

/** One preview at a time. Every play request stops and restarts from zero. */
export function useVoicePreview({ model }: { model: WaveRealtimeModelId }) {
  const cache = useMemo(() => new VoiceSampleCache(), []);
  const abortRef = useRef<AbortController | undefined>(undefined);
  const playerRef = useRef<Player | undefined>(undefined);
  const requestRef = useRef(0);
  const [state, setState] = useState<VoicePreviewState>({ status: 'idle' });

  const releasePlayer = useCallback(() => {
    const player = playerRef.current;
    playerRef.current = undefined;
    if (!player) return;
    // `remove()` releases the native object, but a source that is already
    // playing (or has a pending play) can remain audible briefly unless it is
    // explicitly paused first.
    try {
      player.pause();
    } catch {
      // The player may already have stopped.
    }
    try {
      player.remove();
    } catch {
      // The native player may already have released itself.
    }
  }, []);

  const teardown = useCallback(() => {
    requestRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = undefined;
    releasePlayer();
  }, [releasePlayer]);

  const stop = useCallback(() => {
    teardown();
    setState({ status: 'idle' });
  }, [teardown]);

  useEffect(() => teardown, [teardown]);

  const play = useCallback(
    async (voiceId: WaveRealtimeVoiceId) => {
      const request = ++requestRef.current;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      releasePlayer();
      setState({ activeVoiceId: voiceId, status: 'loading' });

      try {
        let uri = cache.getCachedSampleUri(model, voiceId);
        if (!uri) {
          const apiKey = await openAiKeyStore.load();
          if (request !== requestRef.current) return;
          if (!apiKey) {
            throw new VoicePreviewError(
              'Add an OpenAI API key in Settings to preview Realtime voices.',
            );
          }
          const sample = await new OpenAiRealtimeVoiceSampler({
            apiKey,
            model,
          }).getSample(voiceId, controller.signal);
          if (request !== requestRef.current) return;
          uri = cache.saveSample(model, voiceId, sample);
        }

        await setAudioModeAsync({ playsInSilentMode: true });
        if (request !== requestRef.current) return;
        const player = createAudioPlayer({ uri });
        playerRef.current = player;
        player.addListener('playbackStatusUpdate', (status) => {
          if (
            request !== requestRef.current ||
            playerRef.current !== player ||
            !status.didJustFinish
          ) {
            return;
          }
          releasePlayer();
          setState({ status: 'idle' });
        });
        player.play();
        abortRef.current = undefined;
        setState({ activeVoiceId: voiceId, status: 'playing' });
      } catch (error) {
        if (request !== requestRef.current) return;
        abortRef.current = undefined;
        releasePlayer();
        if (
          error instanceof OpenAiRealtimeVoiceSampleError &&
          error.cancelled
        ) {
          setState({ status: 'idle' });
          return;
        }
        setState({
          activeVoiceId: voiceId,
          error:
            error instanceof VoicePreviewError ||
            error instanceof OpenAiKeyStoreError
              ? error.message
              : 'Wave could not play this voice preview.',
          status: 'error',
        });
      }
    },
    [cache, model, releasePlayer],
  );

  return { play, state, stop };
}

class VoicePreviewError extends Error {}
