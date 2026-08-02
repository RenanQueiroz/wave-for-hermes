/**
 * Gateway voice mode: listen → transcribe → run a turn → speak, on repeat.
 *
 * Everything runs through the user's own Hermes gateway, so no provider key
 * exists on the device. Unlike Realtime this is deliberately half-duplex: the
 * microphone is closed before playback starts, because `expo-audio` exposes no
 * speaker-routing override and an open recorder forces iOS playback out of the
 * earpiece. The interrupt is therefore an explicit control, not acoustic
 * barge-in.
 *
 * `expo-audio` owning the microphone is safe here: gateway voice and a WebRTC
 * Realtime call are mutually exclusive modes (see AGENTS.md).
 */
import {
  AudioModule,
  createAudioPlayer,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  type RecordingOptions,
} from 'expo-audio';
import { File } from 'expo-file-system';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  initialUtteranceTracker,
  isVoiceStopCommand,
  mimeTypeForRecording,
  observeUtterance,
  type GatewayVoicePhase,
} from '@/features/voice/gateway-voice-machine';
import type { GatewayClient } from '@/services/gateway/gateway-client';

/** How often the recorder's metering is folded into the utterance tracker. */
const SAMPLE_INTERVAL_MS = 250;

/**
 * Playback backstop for a player that reports neither completion nor failure.
 * MAX_SPEAK_CHARS of synthesized speech tops out well under this.
 */
const MAX_PLAYBACK_WAIT_MS = 6 * 60_000;

/**
 * Speech, not music: mono at 16 kHz is what transcription providers want, and
 * it keeps a minute of audio small enough to upload as a data URL.
 */
const VOICE_RECORDING_OPTIONS: RecordingOptions = {
  ...RecordingPresets.HIGH_QUALITY,
  bitRate: 32_000,
  isMeteringEnabled: true,
  numberOfChannels: 1,
  sampleRate: 16_000,
};

export interface GatewayVoiceState {
  /** Wave's reply for the turn in flight, accumulated from the stream. */
  assistantText: string;
  error?: string;
  /** Live input level in dBFS while listening, when the platform reports it. */
  level?: number;
  phase: GatewayVoicePhase;
  /** What the last utterance transcribed to. */
  userTranscript: string;
}

type Player = ReturnType<typeof createAudioPlayer>;

const IDLE_STATE: GatewayVoiceState = {
  assistantText: '',
  phase: 'idle',
  userTranscript: '',
};

function deleteRecording(uri: string | null) {
  if (!uri) return;
  try {
    new File(uri).delete();
  } catch {
    // A leftover temp recording is harmless; the OS reclaims the cache.
  }
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export function useGatewayVoice({
  client,
  sessionId,
}: {
  client?: GatewayClient;
  sessionId: string;
}) {
  const recorder = useAudioRecorder(VOICE_RECORDING_OPTIONS);
  const [state, setState] = useState<GatewayVoiceState>(IDLE_STATE);

  // The loop is long-lived and reads these at await boundaries, so they live
  // in refs rather than closing over a render's values.
  const clientRef = useRef(client);
  clientRef.current = client;
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;

  // Every start bumps the generation; the loop abandons itself as soon as it
  // sees a newer one, which is how stop/unmount unwind a mid-flight cycle.
  const generationRef = useRef(0);
  const playerRef = useRef<Player | undefined>(undefined);
  const turnAbortRef = useRef<AbortController | undefined>(undefined);
  const submitNowRef = useRef(false);
  const skipSpeakingRef = useRef(false);

  const releasePlayer = useCallback(() => {
    const player = playerRef.current;
    playerRef.current = undefined;
    if (!player) return;
    try {
      player.remove();
    } catch {
      // Already released.
    }
  }, []);

  /**
   * Abandon whatever the loop is doing and release every audio resource.
   *
   * On unmount, `useAudioRecorder`'s own cleanup has already released the
   * native shared object, and ANY access to a released object throws — so
   * every recorder touch is guarded and teardown can never reject out of a
   * fire-and-forget call.
   */
  const teardown = useCallback(async () => {
    generationRef.current += 1;
    turnAbortRef.current?.abort();
    turnAbortRef.current = undefined;
    releasePlayer();
    try {
      await recorder.stop();
    } catch {
      // Not recording, or the recorder was already released.
    }
    try {
      deleteRecording(recorder.uri);
    } catch {
      // Released recorder: the OS reclaims the cached file.
    }
    await setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
  }, [recorder, releasePlayer]);

  useEffect(() => {
    return () => {
      void teardown();
    };
  }, [teardown]);

  /**
   * Record until the speaker pauses, the cap is reached, or the user submits,
   * then hand the audio to the gateway. Resolves to the transcript, or
   * `undefined` when this cycle was abandoned.
   */
  const captureUtterance = useCallback(
    async (generation: number): Promise<string | undefined> => {
      submitNowRef.current = false;
      await recorder.prepareToRecordAsync();
      recorder.record();
      setState((current) => ({ ...current, phase: 'listening' }));

      let tracker = initialUtteranceTracker;
      let elapsedMs = 0;
      let sawMetering = false;
      while (generationRef.current === generation && !submitNowRef.current) {
        await delay(SAMPLE_INTERVAL_MS);
        if (generationRef.current !== generation || submitNowRef.current) break;
        const status = recorder.getStatus();
        elapsedMs = status.durationMillis || elapsedMs + SAMPLE_INTERVAL_MS;
        if (status.metering !== undefined) {
          sawMetering = true;
          setState((current) => ({ ...current, level: status.metering }));
        }
        const observed = observeUtterance(
          tracker,
          {
            elapsedMs,
            ...(status.metering === undefined
              ? {}
              : { level: status.metering }),
          },
          SAMPLE_INTERVAL_MS,
        );
        tracker = observed.tracker;
        if (observed.decision.type === 'submit') break;
      }

      const submitted = submitNowRef.current;
      try {
        await recorder.stop();
      } catch {
        // Already stopped.
      }
      const uri = recorder.uri;
      if (generationRef.current !== generation) {
        deleteRecording(uri);
        return undefined;
      }
      // A platform that reports no metering cannot tell speech from silence,
      // so its recordings are always worth sending; a metered recording that
      // never crossed the speech threshold is not.
      if (!uri || (!submitted && sawMetering && !tracker.heardSpeech)) {
        deleteRecording(uri);
        return '';
      }

      setState((current) => ({
        ...current,
        level: undefined,
        phase: 'transcribing',
      }));
      try {
        const base64 = await new File(uri).base64();
        const mimeType = mimeTypeForRecording(uri);
        const gateway = clientRef.current;
        if (!gateway) return undefined;
        const { transcript } = await gateway.transcribeAudio({
          dataUrl: `data:${mimeType};base64,${base64}`,
          mimeType,
        });
        return transcript.trim();
      } finally {
        deleteRecording(uri);
      }
    },
    [recorder],
  );

  /** Run the transcript as a normal turn and return what Wave said. */
  const runTurn = useCallback(
    async (transcript: string, generation: number): Promise<string> => {
      const gateway = clientRef.current;
      if (!gateway) return '';
      const abort = new AbortController();
      turnAbortRef.current = abort;
      let spoken = '';
      try {
        for await (const event of gateway.streamTurn(
          sessionIdRef.current,
          transcript,
          abort.signal,
        )) {
          if (generationRef.current !== generation) break;
          if (event.type === 'assistant.delta') {
            setState((current) => ({
              ...current,
              assistantText: current.assistantText + event.delta,
            }));
          } else if (event.type === 'assistant.completed') {
            spoken = spoken ? `${spoken}\n\n${event.content}` : event.content;
          } else if (event.type === 'turn.error') {
            throw new Error(event.error.message);
          }
        }
      } finally {
        if (turnAbortRef.current === abort) turnAbortRef.current = undefined;
      }
      return spoken.trim();
    },
    [],
  );

  /** Speak a reply, resolving when it finishes, is skipped, or is abandoned. */
  const speak = useCallback(
    async (text: string, generation: number) => {
      const gateway = clientRef.current;
      if (!gateway) return;
      skipSpeakingRef.current = false;
      const speech = await gateway.speakText(text);
      if (generationRef.current !== generation) return;
      // Closing the recording route before playback is what keeps iOS output
      // on the speaker instead of the earpiece.
      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
      }).catch(() => undefined);
      if (generationRef.current !== generation) return;

      setState((current) => ({ ...current, phase: 'speaking' }));
      const player = createAudioPlayer({ uri: speech.dataUrl });
      playerRef.current = player;
      let finished = false;
      player.addListener('playbackStatusUpdate', (status) => {
        if (status.didJustFinish) finished = true;
        // A player that cannot decode or route the audio never reaches
        // didJustFinish; without this the loop would sit in "speaking"
        // until the wait cap.
        if (status.playbackState === 'failed') finished = true;
      });
      player.play();
      const deadline = Date.now() + MAX_PLAYBACK_WAIT_MS;
      while (
        !finished &&
        !skipSpeakingRef.current &&
        generationRef.current === generation &&
        Date.now() < deadline
      ) {
        await delay(100);
      }
      releasePlayer();
    },
    [releasePlayer],
  );

  const stop = useCallback(async () => {
    await teardown();
    setState(IDLE_STATE);
  }, [teardown]);

  const runLoop = useCallback(
    async (generation: number) => {
      try {
        while (generationRef.current === generation) {
          await setAudioModeAsync({
            allowsRecording: true,
            playsInSilentMode: true,
          });
          if (generationRef.current !== generation) return;

          const transcript = await captureUtterance(generation);
          if (transcript === undefined) return;
          if (!transcript) continue;
          if (isVoiceStopCommand(transcript)) {
            await stop();
            return;
          }

          setState((current) => ({
            ...current,
            assistantText: '',
            phase: 'thinking',
            userTranscript: transcript,
          }));
          const reply = await runTurn(transcript, generation);
          if (generationRef.current !== generation) return;
          if (reply) await speak(reply, generation);
        }
      } catch (error) {
        if (generationRef.current !== generation) return;
        await teardown();
        setState((current) => ({
          ...current,
          error:
            error instanceof Error
              ? error.message
              : 'Voice mode stopped unexpectedly.',
          level: undefined,
          phase: 'idle',
        }));
      }
    },
    [captureUtterance, runTurn, speak, stop, teardown],
  );

  const start = useCallback(async () => {
    if (!clientRef.current || !sessionIdRef.current) return;
    const permission = await AudioModule.requestRecordingPermissionsAsync();
    if (!permission.granted) {
      setState({
        ...IDLE_STATE,
        error: 'Wave needs microphone access for voice mode.',
      });
      return;
    }
    generationRef.current += 1;
    const generation = generationRef.current;
    setState({ ...IDLE_STATE, phase: 'listening' });
    void runLoop(generation);
  }, [runLoop]);

  /** Stop listening and send what has been said so far. */
  const submitNow = useCallback(() => {
    submitNowRef.current = true;
  }, []);

  /** Cut playback short and start listening again. */
  const skipSpeaking = useCallback(() => {
    skipSpeakingRef.current = true;
  }, []);

  return { skipSpeaking, start, state, stop, submitNow };
}
