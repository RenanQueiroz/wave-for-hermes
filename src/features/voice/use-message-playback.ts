/**
 * Read a message aloud through the gateway's configured TTS provider.
 *
 * One player at a time: starting playback of another message replaces the
 * current one, so two messages can never talk over each other.
 */
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { GatewayClient } from '@/services/gateway/gateway-client';

type Player = ReturnType<typeof createAudioPlayer>;

export interface MessagePlaybackState {
  error?: string;
  /** The message currently loading or playing, if any. */
  messageId?: string;
  status: 'idle' | 'loading' | 'playing' | 'error';
}

export function useMessagePlayback({ client }: { client?: GatewayClient }) {
  const [state, setState] = useState<MessagePlaybackState>({ status: 'idle' });
  const playerRef = useRef<Player | undefined>(undefined);
  const requestRef = useRef(0);

  const release = useCallback(() => {
    const player = playerRef.current;
    playerRef.current = undefined;
    if (!player) return;
    try {
      player.remove();
    } catch {
      // Already released.
    }
  }, []);

  useEffect(() => release, [release]);

  const stop = useCallback(() => {
    requestRef.current += 1;
    release();
    setState({ status: 'idle' });
  }, [release]);

  const play = useCallback(
    async (messageId: string, text: string) => {
      if (!client) return;
      // Tapping the message that is already speaking stops it.
      if (state.messageId === messageId && state.status !== 'idle') {
        stop();
        return;
      }
      const request = ++requestRef.current;
      release();
      setState({ messageId, status: 'loading' });
      try {
        const speech = await client.speakText(text);
        if (request !== requestRef.current) return;
        await setAudioModeAsync({ playsInSilentMode: true }).catch(
          () => undefined,
        );
        const player = createAudioPlayer({ uri: speech.dataUrl });
        playerRef.current = player;
        player.addListener('playbackStatusUpdate', (status) => {
          if (request !== requestRef.current) return;
          if (status.didJustFinish) {
            release();
            setState({ status: 'idle' });
          }
        });
        player.play();
        setState({ messageId, status: 'playing' });
      } catch {
        if (request !== requestRef.current) return;
        setState({
          error: 'Wave could not read that message aloud.',
          status: 'error',
        });
      }
    },
    [client, release, state.messageId, state.status, stop],
  );

  return { play, state, stop };
}
