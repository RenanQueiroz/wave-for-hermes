/**
 * Dictation: record on device, transcribe through the gateway, hand back text.
 *
 * No provider key touches the client — the recording is uploaded to the
 * gateway's configured STT provider and only the transcript comes back.
 *
 * `expo-audio` owns the microphone here. That is safe because gateway voice
 * and Realtime are mutually exclusive modes: a WebRTC call is never active
 * while dictation runs (see the audio-session rule in AGENTS.md).
 */
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
} from 'expo-audio';
import { File } from 'expo-file-system';
import { useCallback, useRef, useState } from 'react';

import { mimeTypeForRecording } from '@/features/voice/gateway-voice-machine';
import type { GatewayClient } from '@/services/gateway/gateway-client';

export type DictationStatus =
  | 'idle'
  | 'recording'
  | 'transcribing'
  | 'denied'
  | 'error';

export interface DictationState {
  error?: string;
  status: DictationStatus;
}

export function useDictation({ client }: { client?: GatewayClient }) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [state, setState] = useState<DictationState>({ status: 'idle' });
  const activeRef = useRef(false);

  const start = useCallback(async () => {
    if (activeRef.current || !client) return;
    activeRef.current = true;
    try {
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (!permission.granted) {
        activeRef.current = false;
        setState({
          error: 'Wave needs microphone access to dictate.',
          status: 'denied',
        });
        return;
      }
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setState({ status: 'recording' });
    } catch {
      activeRef.current = false;
      setState({
        error: 'Wave could not start recording.',
        status: 'error',
      });
    }
  }, [client, recorder]);

  /** Stop, upload, and resolve the transcript ('' when nothing was heard). */
  const stop = useCallback(async (): Promise<string> => {
    if (!activeRef.current) return '';
    setState({ status: 'transcribing' });
    let uri: string | null = null;
    try {
      await recorder.stop();
      uri = recorder.uri;
      // Release the recording route so playback is not stuck in a
      // record-oriented audio session.
      await setAudioModeAsync({ allowsRecording: false }).catch(
        () => undefined,
      );
      if (!uri || !client) {
        setState({ status: 'idle' });
        return '';
      }
      const file = new File(uri);
      const base64 = await file.base64();
      const mimeType = mimeTypeForRecording(uri);
      const { transcript } = await client.transcribeAudio({
        dataUrl: `data:${mimeType};base64,${base64}`,
        mimeType,
      });
      setState({ status: 'idle' });
      return transcript.trim();
    } catch {
      setState({
        error: 'Wave could not transcribe that recording.',
        status: 'error',
      });
      return '';
    } finally {
      activeRef.current = false;
      if (uri) {
        try {
          new File(uri).delete();
        } catch {
          // A leftover temp recording is harmless; the OS reclaims the cache.
        }
      }
    }
  }, [client, recorder]);

  const cancel = useCallback(async () => {
    if (!activeRef.current) return;
    activeRef.current = false;
    try {
      await recorder.stop();
    } catch {
      // Already stopped.
    }
    await setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
    setState({ status: 'idle' });
  }, [recorder]);

  const dismissError = useCallback(() => {
    setState((current) =>
      current.status === 'error' || current.status === 'denied'
        ? { status: 'idle' }
        : current,
    );
  }, []);

  return { cancel, dismissError, start, state, stop };
}
