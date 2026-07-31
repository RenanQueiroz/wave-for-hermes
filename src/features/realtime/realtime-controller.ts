import type {
  WaveEndRealtimeCallResponse,
  WaveRealtimeVoiceId,
  WaveStartRealtimeCallResponse,
} from '@wave/contracts';

import type {
  PreparedRealtimeTransport,
  RealtimeActivity,
  RealtimeTransport,
  RealtimeTransportError,
  RealtimeTransportEvent,
} from '@/services/realtime/realtime-transport';

const MAX_TRANSCRIPT_LENGTH = 24_000;
const CALL_EXPIRY_LEEWAY_MS = 2_000;

export type WaveRealtimePhase =
  | 'assistant_speaking'
  | 'connecting'
  | 'error'
  | 'idle'
  | 'listening'
  | 'reconnecting'
  | 'requesting_permission'
  | 'stopping'
  | 'user_speaking';

export interface WaveRealtimeState {
  assistantTranscript: string;
  cleanupPending: boolean;
  error?: {
    kind: string;
    message: string;
    retryable: boolean;
  };
  expiresAt?: string;
  microphoneEnabled: boolean;
  phase: WaveRealtimePhase;
  remoteAudioTracks: number;
  userTranscript: string;
}

export interface RealtimeBackend {
  endRealtimeCall(
    callId: string,
    signal?: AbortSignal,
  ): Promise<WaveEndRealtimeCallResponse>;
  startRealtimeCall(
    sessionId: string,
    sdpOffer: string,
    voiceId?: WaveRealtimeVoiceId,
    signal?: AbortSignal,
  ): Promise<WaveStartRealtimeCallResponse>;
}

export interface WaveRealtimeControllerOptions {
  backend: RealtimeBackend;
  transport: RealtimeTransport;
}

const INITIAL_STATE: WaveRealtimeState = {
  assistantTranscript: '',
  cleanupPending: false,
  microphoneEnabled: true,
  phase: 'idle',
  remoteAudioTracks: 0,
  userTranscript: '',
};

export class WaveRealtimeController {
  private abortController?: AbortController;
  private readonly backend: RealtimeBackend;
  private callId?: string;
  private expiryTimer?: ReturnType<typeof setTimeout>;
  private failingOperation?: number;
  private readonly listeners = new Set<(state: WaveRealtimeState) => void>();
  private operation = 0;
  private state: WaveRealtimeState = INITIAL_STATE;
  private transportSession?: PreparedRealtimeTransport;
  private readonly transport: RealtimeTransport;

  constructor({ backend, transport }: WaveRealtimeControllerOptions) {
    this.backend = backend;
    this.transport = transport;
  }

  getState = () => this.state;

  subscribe = (listener: (state: WaveRealtimeState) => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  async start(sessionId: string, voiceId?: WaveRealtimeVoiceId) {
    if (this.state.phase !== 'idle' && this.state.phase !== 'error') {
      return;
    }
    if (this.callId) {
      this.replaceState({
        ...this.state,
        error: {
          kind: 'cleanup_required',
          message:
            'Wave must finish closing the previous live call before starting another.',
          retryable: true,
        },
        cleanupPending: true,
        phase: 'error',
      });
      return;
    }

    const operation = ++this.operation;
    const controller = new AbortController();
    this.abortController = controller;
    this.replaceState({
      ...INITIAL_STATE,
      phase: 'requesting_permission',
    });

    try {
      const transportSession = await this.transport.prepare({
        onEvent: (event) => this.handleTransportEvent(operation, event),
        signal: controller.signal,
      });
      if (!this.isCurrent(operation)) {
        transportSession.close();
        return;
      }
      this.transportSession = transportSession;
      this.patchState({ phase: 'connecting' });

      const response = await this.backend.startRealtimeCall(
        sessionId,
        transportSession.sdpOffer,
        voiceId,
        controller.signal,
      );
      this.callId = response.call.id;
      if (!this.isCurrent(operation)) {
        await this.finishCall(response.call.id);
        return;
      }
      this.scheduleExpiry(response.call.expiresAt, operation);
      this.patchState({ expiresAt: response.call.expiresAt });
      await transportSession.connect(
        response.call.sdpAnswer,
        controller.signal,
      );
      if (!this.isCurrent(operation)) return;
      this.patchState({ phase: 'listening' });
    } catch (error) {
      if (!this.isCurrent(operation)) return;
      await this.failAndCleanup(operation, error);
    }
  }

  setMicrophoneEnabled(enabled: boolean) {
    if (this.state.phase === 'idle' || this.state.phase === 'stopping') {
      return;
    }
    this.transportSession?.setMicrophoneEnabled(enabled);
    this.patchState({ microphoneEnabled: enabled });
  }

  async stop() {
    if (this.state.phase === 'idle' && !this.callId) return;
    const operation = ++this.operation;
    this.failingOperation = undefined;
    this.abortController?.abort();
    this.abortController = undefined;
    this.clearExpiryTimer();
    this.transportSession?.close();
    this.transportSession = undefined;
    this.patchState({ phase: 'stopping' });

    const callId = this.callId;
    if (!callId) {
      this.replaceState(INITIAL_STATE);
      return;
    }
    try {
      await this.backend.endRealtimeCall(callId);
      if (operation !== this.operation) return;
      this.callId = undefined;
      this.replaceState(INITIAL_STATE);
    } catch (error) {
      if (operation !== this.operation) return;
      this.replaceState({
        ...INITIAL_STATE,
        cleanupPending: true,
        error: toControllerError(
          error,
          'Wave stopped audio locally but could not confirm that the live call ended.',
        ),
        phase: 'error',
      });
    }
  }

  private clearExpiryTimer() {
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    this.expiryTimer = undefined;
  }

  private async failAndCleanup(operation: number, error: unknown) {
    if (this.failingOperation === operation) return;
    this.failingOperation = operation;
    this.abortController?.abort();
    this.abortController = undefined;
    this.clearExpiryTimer();
    this.transportSession?.close();
    this.transportSession = undefined;

    const callId = this.callId;
    let cleanupError: unknown;
    if (callId) {
      try {
        await this.backend.endRealtimeCall(callId);
        this.callId = undefined;
      } catch (caught) {
        cleanupError = caught;
      }
    }
    if (operation !== this.operation) return;
    this.replaceState({
      ...INITIAL_STATE,
      cleanupPending: cleanupError !== undefined,
      error: cleanupError
        ? toControllerError(
            cleanupError,
            'Wave stopped audio locally but could not confirm that the live call ended.',
          )
        : toControllerError(
            error,
            'Wave could not start the live voice connection.',
          ),
      phase: 'error',
    });
    if (this.failingOperation === operation) {
      this.failingOperation = undefined;
    }
  }

  private async finishCall(callId: string) {
    try {
      await this.backend.endRealtimeCall(callId);
      if (this.callId === callId) this.callId = undefined;
    } catch {
      // A newer operation owns the visible state. Preserve the identifier so a
      // later explicit stop can retry cleanup without silently creating another
      // active call.
    }
  }

  private handleTransportEvent(
    operation: number,
    event: RealtimeTransportEvent,
  ) {
    if (!this.isCurrent(operation)) return;
    switch (event.type) {
      case 'activity':
        this.patchState({
          phase: activityToPhase(event.activity),
        });
        return;
      case 'connection':
        if (event.state === 'connected') {
          this.patchState({ phase: 'listening' });
        } else if (event.state === 'disconnected') {
          this.patchState({ phase: 'reconnecting' });
        } else if (event.state === 'failed') {
          void this.failAndCleanup(operation, {
            kind: 'connection',
            message: 'The Realtime connection failed.',
            retryable: true,
          });
        }
        return;
      case 'remote_audio_tracks':
        this.patchState({ remoteAudioTracks: event.count });
        return;
      case 'transcript':
        this.applyTranscript(event);
        return;
      case 'error':
        void this.failAndCleanup(operation, event.error);
    }
  }

  private applyTranscript(
    event: Extract<RealtimeTransportEvent, { type: 'transcript' }>,
  ) {
    const key =
      event.role === 'assistant' ? 'assistantTranscript' : 'userTranscript';
    const previous = this.state[key];
    const text = event.final ? event.text : `${previous}${event.text}`;
    this.patchState({
      [key]: text.slice(0, MAX_TRANSCRIPT_LENGTH),
    });
  }

  private isCurrent(operation: number) {
    return (
      operation === this.operation && !this.abortController?.signal.aborted
    );
  }

  private patchState(patch: Partial<WaveRealtimeState>) {
    this.replaceState({ ...this.state, ...patch });
  }

  private replaceState(state: WaveRealtimeState) {
    this.state = state;
    for (const listener of this.listeners) {
      listener(state);
    }
  }

  private scheduleExpiry(expiresAt: string, operation: number) {
    this.clearExpiryTimer();
    const expiry = Date.parse(expiresAt);
    if (!Number.isFinite(expiry)) return;
    const delay = Math.max(
      0,
      Math.min(expiry - Date.now() - CALL_EXPIRY_LEEWAY_MS, 2_147_000_000),
    );
    this.expiryTimer = setTimeout(() => {
      if (operation === this.operation) void this.stop();
    }, delay);
  }
}

function activityToPhase(activity: RealtimeActivity): WaveRealtimePhase {
  return activity;
}

function toControllerError(error: unknown, fallbackMessage: string) {
  if (isSafeControllerError(error)) {
    return {
      kind: error.kind,
      message:
        typeof error.message === 'string' && error.message.trim()
          ? sanitizeMessage(error.message)
          : fallbackMessage,
      retryable: error.retryable,
    };
  }
  return {
    kind: 'unknown',
    message: fallbackMessage,
    retryable: true,
  };
}

function isSafeControllerError(
  error: unknown,
): error is RealtimeTransportError & {
  kind: string;
  retryable: boolean;
} {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as Record<string, unknown>;
  return (
    typeof candidate.kind === 'string' &&
    candidate.kind.length <= 100 &&
    typeof candidate.retryable === 'boolean'
  );
}

function sanitizeMessage(message: string) {
  return (
    message
      .replace(/[\r\n\t]+/g, ' ')
      .trim()
      .slice(0, 300) || 'Wave could not complete the live voice operation.'
  );
}
