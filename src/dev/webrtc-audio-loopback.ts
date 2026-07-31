import {
  mediaDevices,
  type MediaStream,
  type RTCIceCandidate,
  RTCPeerConnection,
} from 'react-native-webrtc';

const DATA_MESSAGE = 'wave-webrtc-proof';
const ECHO_MESSAGE = `echo:${DATA_MESSAGE}`;
const PROOF_TIMEOUT_MS = 15_000;

type DataChannel = ReturnType<RTCPeerConnection['createDataChannel']>;
type PeerConnectionState = RTCPeerConnection['connectionState'];

export type WebRtcProofPhase =
  | 'failed'
  | 'idle'
  | 'negotiating'
  | 'passed'
  | 'requesting-permission'
  | 'stopping'
  | 'verifying';

export interface WebRtcProofState {
  callerConnectionState: PeerConnectionState;
  dataChannelState: string;
  dataEchoReceived: boolean;
  error?: string;
  localAudioTracks: number;
  phase: WebRtcProofPhase;
  receiverConnectionState: PeerConnectionState;
  remoteAudioTracks: number;
}

interface ProofResources {
  caller: RTCPeerConnection;
  callerChannel: DataChannel;
  localStream: MediaStream;
  receiver: RTCPeerConnection;
  receiverChannel?: DataChannel;
}

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
}

const INITIAL_STATE: WebRtcProofState = {
  callerConnectionState: 'new',
  dataChannelState: 'closed',
  dataEchoReceived: false,
  localAudioTracks: 0,
  phase: 'idle',
  receiverConnectionState: 'new',
  remoteAudioTracks: 0,
};

export class WebRtcAudioLoopbackProof {
  private attempt = 0;
  private listeners = new Set<(state: WebRtcProofState) => void>();
  private resources: ProofResources | undefined;
  private state: WebRtcProofState = INITIAL_STATE;

  getState = () => this.state;

  subscribe(listener: (state: WebRtcProofState) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async start() {
    const attempt = ++this.attempt;
    this.cleanupResources();
    this.replaceState({
      ...INITIAL_STATE,
      phase: 'requesting-permission',
    });

    try {
      const localStream = await mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
      if (attempt !== this.attempt) {
        releaseStream(localStream);
        return;
      }

      const localAudioTracks = localStream.getAudioTracks();
      if (localAudioTracks.length === 0) {
        releaseStream(localStream);
        throw new Error(
          'The native media device returned no microphone audio track.',
        );
      }

      this.patchState({
        localAudioTracks: localAudioTracks.length,
        phase: 'negotiating',
      });

      const caller = new RTCPeerConnection({ iceServers: [] });
      const receiver = new RTCPeerConnection({ iceServers: [] });
      const callerChannel = caller.createDataChannel('wave-proof');
      this.resources = {
        caller,
        callerChannel,
        localStream,
        receiver,
      };

      const remoteAudioReady = createDeferred();
      const dataEchoReady = createDeferred();
      const candidatesForCaller: RTCIceCandidate[] = [];
      const candidatesForReceiver: RTCIceCandidate[] = [];

      caller.onconnectionstatechange = () => {
        if (attempt !== this.attempt) return;
        this.patchState({ callerConnectionState: caller.connectionState });
        if (caller.connectionState === 'failed') {
          this.failAttempt(
            attempt,
            new Error('The caller peer connection failed.'),
          );
        }
      };
      receiver.onconnectionstatechange = () => {
        if (attempt !== this.attempt) return;
        this.patchState({ receiverConnectionState: receiver.connectionState });
        if (receiver.connectionState === 'failed') {
          this.failAttempt(
            attempt,
            new Error('The receiver peer connection failed.'),
          );
        }
      };

      caller.onicecandidate = (event: unknown) => {
        const candidate = getEventProperty<RTCIceCandidate | null>(
          event,
          'candidate',
        );
        if (!candidate || attempt !== this.attempt) return;
        this.addOrQueueCandidate(
          attempt,
          receiver,
          candidatesForReceiver,
          candidate,
        );
      };
      receiver.onicecandidate = (event: unknown) => {
        const candidate = getEventProperty<RTCIceCandidate | null>(
          event,
          'candidate',
        );
        if (!candidate || attempt !== this.attempt) return;
        this.addOrQueueCandidate(
          attempt,
          caller,
          candidatesForCaller,
          candidate,
        );
      };

      receiver.ontrack = (event: unknown) => {
        const track = getEventProperty<{ kind: string } | null>(event, 'track');
        if (attempt !== this.attempt || track?.kind !== 'audio') return;
        const remoteAudioTracks = receiver
          .getReceivers()
          .filter((item) => item.track?.kind === 'audio').length;
        this.patchState({ remoteAudioTracks });
        remoteAudioReady.resolve();
      };

      receiver.ondatachannel = (event: unknown) => {
        if (attempt !== this.attempt) return;
        const receiverChannel = getEventProperty<DataChannel>(event, 'channel');
        this.resources = this.resources
          ? { ...this.resources, receiverChannel }
          : this.resources;
        receiverChannel.onmessage = (messageEvent: unknown) => {
          const data = getEventProperty<unknown>(messageEvent, 'data');
          if (attempt !== this.attempt || data !== DATA_MESSAGE) return;
          receiverChannel.send(ECHO_MESSAGE);
        };
      };

      callerChannel.onopen = () => {
        if (attempt !== this.attempt) return;
        this.patchState({ dataChannelState: callerChannel.readyState });
        callerChannel.send(DATA_MESSAGE);
      };
      callerChannel.onclose = () => {
        if (attempt !== this.attempt) return;
        this.patchState({ dataChannelState: callerChannel.readyState });
      };
      callerChannel.onerror = () => {
        this.failAttempt(attempt, new Error('The WebRTC data channel failed.'));
      };
      callerChannel.onmessage = (event: unknown) => {
        const data = getEventProperty<unknown>(event, 'data');
        if (attempt !== this.attempt || data !== ECHO_MESSAGE) return;
        this.patchState({
          dataChannelState: callerChannel.readyState,
          dataEchoReceived: true,
        });
        dataEchoReady.resolve();
      };

      for (const track of localAudioTracks) {
        caller.addTrack(track, localStream);
      }

      const offer = await caller.createOffer();
      await caller.setLocalDescription(offer);
      await receiver.setRemoteDescription(offer);
      await this.flushCandidates(receiver, candidatesForReceiver);

      const answer = await receiver.createAnswer();
      await receiver.setLocalDescription(answer);
      await caller.setRemoteDescription(answer);
      await this.flushCandidates(caller, candidatesForCaller);

      if (attempt !== this.attempt) return;
      this.patchState({ phase: 'verifying' });

      await withTimeout(
        Promise.all([remoteAudioReady.promise, dataEchoReady.promise]).then(
          () => undefined,
        ),
        PROOF_TIMEOUT_MS,
      );

      if (attempt !== this.attempt) return;
      this.patchState({
        callerConnectionState: caller.connectionState,
        dataChannelState: callerChannel.readyState,
        phase: 'passed',
        receiverConnectionState: receiver.connectionState,
      });
    } catch (error) {
      this.failAttempt(attempt, error);
    }
  }

  stop() {
    ++this.attempt;
    if (this.state.phase !== 'idle') {
      this.patchState({ phase: 'stopping' });
    }
    this.cleanupResources();
    this.replaceState(INITIAL_STATE);
  }

  private addOrQueueCandidate(
    attempt: number,
    target: RTCPeerConnection,
    queue: RTCIceCandidate[],
    candidate: RTCIceCandidate,
  ) {
    if (!target.remoteDescription) {
      queue.push(candidate);
      return;
    }

    void target.addIceCandidate(candidate).catch((error: unknown) => {
      this.failAttempt(attempt, error);
    });
  }

  private cleanupResources() {
    const resources = this.resources;
    this.resources = undefined;
    if (!resources) return;

    resources.callerChannel.close();
    resources.receiverChannel?.close();
    resources.caller.close();
    resources.receiver.close();
    releaseStream(resources.localStream);
  }

  private failAttempt(attempt: number, error: unknown) {
    if (attempt !== this.attempt) return;
    ++this.attempt;
    this.cleanupResources();
    this.patchState({
      dataChannelState: 'closed',
      error: normalizeError(error),
      phase: 'failed',
    });
  }

  private async flushCandidates(
    target: RTCPeerConnection,
    candidates: RTCIceCandidate[],
  ) {
    for (const candidate of candidates.splice(0)) {
      await target.addIceCandidate(candidate);
    }
  }

  private patchState(patch: Partial<WebRtcProofState>) {
    this.replaceState({ ...this.state, ...patch });
  }

  private replaceState(state: WebRtcProofState) {
    this.state = state;
    for (const listener of this.listeners) {
      listener(state);
    }
  }
}

function createDeferred(): Deferred {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function getEventProperty<T>(event: unknown, property: string) {
  return (event as Record<string, unknown>)[property] as T;
}

function normalizeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message
      .replace(/[\r\n\t]+/g, ' ')
      .trim()
      .slice(0, 300) || 'WebRTC proof failed.'
  );
}

function releaseStream(stream: MediaStream) {
  for (const track of stream.getTracks()) {
    track.stop();
  }
  stream.release();
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(
      () =>
        reject(
          new Error(
            `WebRTC proof timed out after ${timeoutMs / 1000} seconds.`,
          ),
        ),
      timeoutMs,
    );
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
