import type { WaveRealtimeVoiceId } from '@wave/contracts';
import {
  setAudioModeAsync,
  useAudioPlayer,
  type AudioPlayer,
} from 'expo-audio';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { VoiceSampleCache } from '@/services/realtime/voice-sample-cache';
import {
  WaveBackendError,
  type WaveBackendClient,
} from '@/services/wave/wave-backend-client';

export interface VoicePreviewState {
  // The voice whose preview is loading or audible right now, if any.
  activeVoiceId?: WaveRealtimeVoiceId;
  error?: string;
  isLoading: boolean;
  toggle(voiceId: WaveRealtimeVoiceId): void;
}

export function useVoicePreview({
  client,
  samplesVersion,
}: {
  client: WaveBackendClient;
  samplesVersion: string | undefined;
}): VoicePreviewState {
  const player = useAudioPlayer(null);
  const cache = useMemo(() => new VoiceSampleCache(), []);
  const requestRef = useRef(0);
  const [loadingVoiceId, setLoadingVoiceId] = useState<WaveRealtimeVoiceId>();
  const [playingVoiceId, setPlayingVoiceId] = useState<WaveRealtimeVoiceId>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    const subscription = player.addListener(
      'playbackStatusUpdate',
      (playbackStatus) => {
        if (playbackStatus.didJustFinish) {
          setPlayingVoiceId(undefined);
        }
      },
    );
    return () => {
      subscription.remove();
    };
  }, [player]);

  const stop = useCallback(() => {
    requestRef.current += 1;
    setLoadingVoiceId(undefined);
    setPlayingVoiceId(undefined);
    player.pause();
  }, [player]);

  const start = useCallback(
    async (voiceId: WaveRealtimeVoiceId) => {
      if (!samplesVersion) {
        return;
      }
      const requestId = ++requestRef.current;
      setError(undefined);
      setPlayingVoiceId(undefined);
      setLoadingVoiceId(voiceId);
      player.pause();
      try {
        let uri = cache.getCachedSampleUri(samplesVersion, voiceId);
        if (!uri) {
          const sample = await client.getRealtimeVoiceSample(voiceId);
          if (requestRef.current !== requestId) return;
          uri = cache.saveSample(samplesVersion, voiceId, sample);
        }
        // Previews should be audible with the ringer switch on silent.
        await setAudioModeAsync({ playsInSilentMode: true });
        if (requestRef.current !== requestId) return;
        player.replace(uri);
        // A play() issued while the replaced item is still loading is dropped
        // by the native player, which happens reliably when the same sample
        // file is loaded a second time. Wait for readiness before playing.
        await waitUntilLoaded(player, 3_000);
        if (requestRef.current !== requestId) return;
        player.play();
        setPlayingVoiceId(voiceId);
      } catch (previewError) {
        if (requestRef.current === requestId) {
          setError(
            previewError instanceof WaveBackendError
              ? previewError.message
              : 'Wave could not play this voice preview.',
          );
        }
      } finally {
        if (requestRef.current === requestId) {
          setLoadingVoiceId(undefined);
        }
      }
    },
    [cache, client, player, samplesVersion],
  );

  const toggle = useCallback(
    (voiceId: WaveRealtimeVoiceId) => {
      if (loadingVoiceId === voiceId || playingVoiceId === voiceId) {
        stop();
        return;
      }
      void start(voiceId);
    },
    [loadingVoiceId, playingVoiceId, start, stop],
  );

  return {
    activeVoiceId: loadingVoiceId ?? playingVoiceId,
    error,
    isLoading: loadingVoiceId !== undefined,
    toggle,
  };
}

function waitUntilLoaded(player: AudioPlayer, timeoutMs: number) {
  if (player.isLoaded) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      subscription.remove();
      resolve();
    };
    const subscription = player.addListener(
      'playbackStatusUpdate',
      (playbackStatus) => {
        if (playbackStatus.isLoaded) {
          finish();
        }
      },
    );
    // Resolving on timeout keeps a stuck load on the error path of play()
    // instead of stranding the preview in its loading state.
    const timer = setTimeout(finish, timeoutMs);
  });
}
