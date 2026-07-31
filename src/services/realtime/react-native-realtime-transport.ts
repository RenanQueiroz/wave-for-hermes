import {
  mediaDevices,
  type MediaStream,
  RTCPeerConnection,
} from 'react-native-webrtc';
import { PermissionsAndroid, Platform } from 'react-native';

import {
  parseRealtimeServerEvent,
  RealtimeTransportError,
  type PrepareRealtimeTransportOptions,
  type PreparedRealtimeTransport,
  type RealtimeConnectionState,
  type RealtimeTransport,
  type RealtimeTransportEvent,
} from './realtime-transport';

const ICE_GATHERING_TIMEOUT_MS = 12_000;
const CONNECTION_TIMEOUT_MS = 30_000;
const RECONNECT_TIMEOUT_MS = 15_000;
const CONDITION_POLL_MS = 50;

type DataChannel = ReturnType<RTCPeerConnection['createDataChannel']>;

export class ReactNativeRealtimeTransport implements RealtimeTransport {
  async prepare({
    onEvent,
    signal,
  }: PrepareRealtimeTransportOptions): Promise<PreparedRealtimeTransport> {
    throwIfAborted(signal);

    let localStream: MediaStream | undefined;
    let session: ReactNativePreparedRealtimeTransport | undefined;
    try {
      localStream = await acquireMicrophone(signal);
      const audioTracks = localStream.getAudioTracks();
      if (audioTracks.length === 0) {
        throw new RealtimeTransportError(
          'Wave could not find a microphone audio track.',
          {
            kind: 'media_unavailable',
          },
        );
      }
      throwIfAborted(signal);

      const peer = new RTCPeerConnection({ iceServers: [] });
      const dataChannel = peer.createDataChannel('oai-events');
      session = new ReactNativePreparedRealtimeTransport({
        dataChannel,
        localStream,
        onEvent,
        peer,
      });
      for (const track of audioTracks) {
        peer.addTrack(track, localStream);
      }

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      await waitForIceGathering(peer, signal);
      const sdpOffer = peer.localDescription?.sdp;
      if (
        typeof sdpOffer !== 'string' ||
        (!sdpOffer.startsWith('v=0\r\n') && !sdpOffer.startsWith('v=0\n'))
      ) {
        throw new RealtimeTransportError(
          'Wave could not create a valid WebRTC offer.',
          {
            kind: 'protocol',
          },
        );
      }
      session.setSdpOffer(sdpOffer);
      return session;
    } catch (error) {
      session?.close();
      if (!session && localStream) {
        releaseStream(localStream);
      }
      throw normalizeTransportError(error);
    }
  }
}

interface ReactNativePreparedRealtimeTransportOptions {
  dataChannel: DataChannel;
  localStream: MediaStream;
  onEvent(event: RealtimeTransportEvent): void;
  peer: RTCPeerConnection;
}

class ReactNativePreparedRealtimeTransport implements PreparedRealtimeTransport {
  private closed = false;
  private readonly dataChannel: DataChannel;
  private readonly localStream: MediaStream;
  private readonly onEvent: (event: RealtimeTransportEvent) => void;
  private readonly peer: RTCPeerConnection;
  private readonly remoteStreams = new Set<MediaStream>();
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private remoteAudioTrackCount = 0;
  private _sdpOffer = '';

  constructor({
    dataChannel,
    localStream,
    onEvent,
    peer,
  }: ReactNativePreparedRealtimeTransportOptions) {
    this.dataChannel = dataChannel;
    this.localStream = localStream;
    this.onEvent = onEvent;
    this.peer = peer;
    this.bindEvents();
  }

  get sdpOffer() {
    if (!this._sdpOffer) {
      throw new RealtimeTransportError(
        'Wave requested the WebRTC offer before it was ready.',
        {
          kind: 'protocol',
        },
      );
    }
    return this._sdpOffer;
  }

  setSdpOffer(sdpOffer: string) {
    this._sdpOffer = sdpOffer;
  }

  async connect(sdpAnswer: string, signal: AbortSignal) {
    if (this.closed) {
      throw new RealtimeTransportError(
        'The Realtime connection was already closed.',
        {
          kind: 'cancelled',
        },
      );
    }
    throwIfAborted(signal);
    this.emitConnection('connecting');
    try {
      await this.peer.setRemoteDescription({
        sdp: sdpAnswer,
        type: 'answer',
      });
      await waitForConnected(this.peer, this.dataChannel, signal);
      this.emitConnection('connected');
    } catch (error) {
      throw normalizeTransportError(error);
    }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.dataChannel.onclose = null;
    this.dataChannel.onerror = null;
    this.dataChannel.onmessage = null;
    this.dataChannel.onopen = null;
    this.peer.onconnectionstatechange = null;
    this.peer.ontrack = null;
    this.clearReconnectTimer();
    this.dataChannel.close();
    this.peer.close();
    releaseStream(this.localStream);
    for (const stream of this.remoteStreams) {
      stream.release();
    }
    this.remoteStreams.clear();
  }

  setMicrophoneEnabled(enabled: boolean) {
    if (this.closed) return;
    for (const track of this.localStream.getAudioTracks()) {
      track.enabled = enabled;
    }
  }

  private bindEvents() {
    this.peer.onconnectionstatechange = () => {
      if (this.closed) return;
      const state = normalizeConnectionState(this.peer.connectionState);
      if (!state) return;
      if (state === 'connected') {
        this.clearReconnectTimer();
      } else if (state === 'disconnected') {
        this.scheduleReconnectTimeout();
      } else if (state === 'failed') {
        this.clearReconnectTimer();
      }
      this.emitConnection(state);
    };
    this.peer.ontrack = (event: unknown) => {
      const track = getEventProperty<{ kind: string } | null>(event, 'track');
      if (this.closed || track?.kind !== 'audio') return;
      const streams =
        getEventProperty<MediaStream[] | undefined>(event, 'streams') ?? [];
      for (const stream of streams) {
        this.remoteStreams.add(stream);
      }
      this.remoteAudioTrackCount += 1;
      this.onEvent({
        count: this.remoteAudioTrackCount,
        type: 'remote_audio_tracks',
      });
    };
    this.dataChannel.onmessage = (event: unknown) => {
      if (this.closed) return;
      const parsed = parseRealtimeServerEvent(
        getEventProperty<unknown>(event, 'data'),
      );
      if (parsed) this.onEvent(parsed);
    };
    this.dataChannel.onerror = () => {
      if (this.closed) return;
      this.onEvent({
        error: new RealtimeTransportError(
          'The Realtime event channel failed.',
          {
            kind: 'connection',
            retryable: true,
          },
        ),
        type: 'error',
      });
    };
    this.dataChannel.onclose = () => {
      if (this.closed || this.peer.connectionState === 'closed') return;
      this.onEvent({
        error: new RealtimeTransportError(
          'The Realtime event channel closed unexpectedly.',
          {
            kind: 'connection',
            retryable: true,
          },
        ),
        type: 'error',
      });
    };
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
  }

  private emitConnection(state: RealtimeConnectionState) {
    this.onEvent({ state, type: 'connection' });
  }

  private scheduleReconnectTimeout() {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      if (this.closed || this.peer.connectionState === 'connected') {
        return;
      }
      this.onEvent({
        error: new RealtimeTransportError(
          'The Realtime connection did not recover in time.',
          {
            kind: 'timeout',
            retryable: true,
          },
        ),
        type: 'error',
      });
    }, RECONNECT_TIMEOUT_MS);
  }
}

async function acquireMicrophone(signal: AbortSignal) {
  try {
    await requestAndroidMicrophonePermission(signal);
    const stream = await mediaDevices.getUserMedia({
      audio: true,
      video: false,
    });
    if (signal.aborted) {
      releaseStream(stream);
      throw abortError();
    }
    return stream;
  } catch (error) {
    if (signal.aborted) throw abortError();
    if (error instanceof RealtimeTransportError) throw error;
    const message = normalizeErrorMessage(error).toLowerCase();
    if (
      Platform.OS === 'ios' ||
      message.includes('denied') ||
      message.includes('notallowed') ||
      message.includes('permission')
    ) {
      throw new RealtimeTransportError(
        'Allow microphone access in system settings, then try live voice again.',
        {
          kind: 'media_permission',
          retryable: true,
        },
      );
    }
    throw new RealtimeTransportError('Wave could not access the microphone.', {
      kind: 'media_unavailable',
      retryable: true,
    });
  }
}

async function requestAndroidMicrophonePermission(signal: AbortSignal) {
  if (Platform.OS !== 'android') return;
  throwIfAborted(signal);
  const result = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
    {
      buttonNegative: 'Not now',
      buttonPositive: 'Continue',
      message:
        'Wave uses your microphone only while a live voice conversation is active.',
      title: 'Microphone access',
    },
  );
  throwIfAborted(signal);
  if (result !== PermissionsAndroid.RESULTS.GRANTED) {
    throw new RealtimeTransportError(
      'Allow microphone access in system settings, then try live voice again.',
      {
        kind: 'media_permission',
        retryable: true,
      },
    );
  }
}

function releaseStream(stream: MediaStream) {
  for (const track of stream.getTracks()) {
    track.stop();
  }
  stream.release();
}

function normalizeConnectionState(
  state: RTCPeerConnection['connectionState'],
): RealtimeConnectionState | undefined {
  switch (state) {
    case 'connected':
    case 'connecting':
    case 'disconnected':
    case 'failed':
      return state;
    case 'closed':
      return 'disconnected';
    default:
      return undefined;
  }
}

function waitForConnected(
  peer: RTCPeerConnection,
  dataChannel: DataChannel,
  signal: AbortSignal,
) {
  return waitForCondition({
    check: () => {
      if (
        peer.connectionState === 'failed' ||
        peer.connectionState === 'closed'
      ) {
        throw new RealtimeTransportError(
          'The Realtime WebRTC connection failed.',
          {
            kind: 'connection',
            retryable: true,
          },
        );
      }
      return (
        peer.connectionState === 'connected' &&
        dataChannel.readyState === 'open'
      );
    },
    signal,
    timeoutMessage:
      'The Realtime WebRTC connection did not become ready in time.',
    timeoutMs: CONNECTION_TIMEOUT_MS,
  });
}

function waitForIceGathering(peer: RTCPeerConnection, signal: AbortSignal) {
  return waitForCondition({
    check: () => peer.iceGatheringState === 'complete',
    signal,
    timeoutMessage: 'Wave could not finish gathering WebRTC network routes.',
    timeoutMs: ICE_GATHERING_TIMEOUT_MS,
  });
}

function waitForCondition({
  check,
  signal,
  timeoutMessage,
  timeoutMs,
}: {
  check(): boolean;
  signal: AbortSignal;
  timeoutMessage: string;
  timeoutMs: number;
}) {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(interval);
      signal.removeEventListener('abort', onAbort);
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };
    const runCheck = () => {
      try {
        if (check()) finish();
      } catch (error) {
        finish(error);
      }
    };
    const onAbort = () => finish(abortError());
    const timer = setTimeout(
      () =>
        finish(
          new RealtimeTransportError(timeoutMessage, {
            kind: 'timeout',
            retryable: true,
          }),
        ),
      timeoutMs,
    );
    const interval = setInterval(runCheck, CONDITION_POLL_MS);
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
    } else {
      runCheck();
    }
  });
}

function abortError() {
  return new RealtimeTransportError('The Realtime connection was cancelled.', {
    kind: 'cancelled',
  });
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) throw abortError();
}

function normalizeTransportError(error: unknown) {
  if (error instanceof RealtimeTransportError) return error;
  return new RealtimeTransportError(
    'Wave could not establish the Realtime connection.',
    {
      kind: 'connection',
      retryable: true,
    },
  );
}

function normalizeErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function getEventProperty<T>(event: unknown, property: string) {
  return (event as Record<string, unknown>)[property] as T;
}
