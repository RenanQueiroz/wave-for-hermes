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
import { isVoiceStopCommand } from '../voice/voice-stop-command.ts';
import { calculateBoundedRetryDelay } from '../../services/query/retry-policy.ts';

const MAX_TRANSCRIPT_LENGTH = 24_000;
const CALL_EXPIRY_LEEWAY_MS = 2_000;
/**
 * Connection-loss recovery is a full re-offer (the provider's calls API has
 * no ICE restart), bounded by the shared jitter policy before the call fails
 * explicitly.
 */
const MAX_RECONNECT_ATTEMPTS = 3;
/**
 * ICE frequently recovers a transient drop on its own; the re-offer only
 * starts when the peer has stayed disconnected this long. A hard failure
 * skips the grace.
 */
const RECONNECT_GRACE_MS = 3_000;

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
  assistantAudioLevel?: number;
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
  userAudioLevel?: number;
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
  private lastStart?: { sessionId: string; voiceId?: WaveRealtimeVoiceId };
  private readonly listeners = new Set<(state: WaveRealtimeState) => void>();
  private operation = 0;
  private reconnecting = false;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
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
    this.lastStart = { sessionId, ...(voiceId ? { voiceId } : {}) };
    this.replaceState({
      ...INITIAL_STATE,
      phase: 'requesting_permission',
    });

    try {
      await this.establish(operation, sessionId, voiceId);
    } catch (error) {
      if (!this.isCurrent(operation)) return;
      await this.failAndCleanup(operation, error);
    }
  }

  /** One full call setup: transport, SDP exchange, connect, listening. */
  private async establish(
    operation: number,
    sessionId: string,
    voiceId?: WaveRealtimeVoiceId,
  ) {
    const controller = new AbortController();
    this.abortController = controller;
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
    await transportSession.connect(response.call.sdpAnswer, controller.signal);
    if (!this.isCurrent(operation)) return;
    this.patchState({ phase: 'listening' });
  }

  /**
   * A lost connection re-offers with bounded, jittered attempts before the
   * call fails explicitly. Recovery is a full re-establish: new transport,
   * new call, same session and voice; transcripts survive.
   */
  private async reconnect(operation: number) {
    if (this.reconnecting) return;
    this.reconnecting = true;
    try {
      const last = this.lastStart;
      if (!last) {
        await this.failAndCleanup(operation, {
          kind: 'connection',
          message: 'The Realtime connection failed.',
          retryable: true,
        });
        return;
      }
      for (let attempt = 0; attempt < MAX_RECONNECT_ATTEMPTS; attempt += 1) {
        // Only the operation counter gates the loop: the abort below kills
        // the previous attempt's controller, which isCurrent would misread
        // as this operation being cancelled.
        if (operation !== this.operation) return;
        this.patchState({ phase: 'reconnecting' });
        this.abortController?.abort();
        this.transportSession?.close();
        this.transportSession = undefined;
        const staleCallId = this.callId;
        this.callId = undefined;
        if (staleCallId) void this.finishCall(staleCallId);
        await delay(calculateBoundedRetryDelay(attempt));
        if (operation !== this.operation) return;
        try {
          await this.establish(operation, last.sessionId, last.voiceId);
          return;
        } catch {
          // Next bounded attempt.
        }
      }
      if (operation !== this.operation) return;
      await this.failAndCleanup(operation, {
        kind: 'connection',
        message:
          'Wave could not re-establish the live call. Start it again when the connection is back.',
        retryable: true,
      });
    } finally {
      this.reconnecting = false;
    }
  }

  setMicrophoneEnabled(enabled: boolean) {
    if (this.state.phase === 'idle' || this.state.phase === 'stopping') {
      return;
    }
    this.transportSession?.setMicrophoneEnabled(enabled);
    this.patchState({
      microphoneEnabled: enabled,
      ...(enabled ? {} : { userAudioLevel: 0 }),
    });
  }

  async stop() {
    if (this.state.phase === 'idle' && !this.callId) return;
    const operation = ++this.operation;
    this.failingOperation = undefined;
    this.abortController?.abort();
    this.abortController = undefined;
    this.clearExpiryTimer();
    this.clearReconnectTimer();
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

  private clearReconnectTimer() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
  }

  private async failAndCleanup(operation: number, error: unknown) {
    if (this.failingOperation === operation) return;
    this.failingOperation = operation;
    this.abortController?.abort();
    this.abortController = undefined;
    this.clearExpiryTimer();
    this.clearReconnectTimer();
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
          // The peer recovered on its own inside the grace window.
          this.clearReconnectTimer();
          this.patchState({ phase: 'listening' });
        } else if (event.state === 'disconnected') {
          this.patchState({ phase: 'reconnecting' });
          if (!this.reconnectTimer && !this.reconnecting) {
            this.reconnectTimer = setTimeout(() => {
              this.reconnectTimer = undefined;
              if (
                this.isCurrent(operation) &&
                this.state.phase === 'reconnecting'
              ) {
                void this.reconnect(operation);
              }
            }, RECONNECT_GRACE_MS);
          }
        } else if (event.state === 'failed') {
          this.clearReconnectTimer();
          // An established call gets bounded re-offer attempts; a failure
          // during initial setup stays an explicit error.
          if (this.state.phase === 'connecting') {
            void this.failAndCleanup(operation, {
              kind: 'connection',
              message: 'The Realtime connection failed.',
              retryable: true,
            });
          } else {
            void this.reconnect(operation);
          }
        }
        return;
      case 'remote_audio_tracks':
        this.patchState({ remoteAudioTracks: event.count });
        return;
      case 'audio_levels':
        this.patchState({
          assistantAudioLevel: event.assistant ?? undefined,
          userAudioLevel: this.state.microphoneEnabled
            ? (event.user ?? undefined)
            : 0,
        });
        return;
      case 'transcript':
        if (
          event.final &&
          event.role === 'user' &&
          isVoiceStopCommand(event.text)
        ) {
          // This final transcript is a local control, never conversation
          // state. Stop closes WebRTC and the provider call without storing or
          // delegating the phrase.
          void this.stop();
          return;
        }
        this.applyTranscript(event);
        return;
      case 'error':
        void this.failAndCleanup(operation, event.error);
    }
  }

  private applyTranscript(
    event: Extract<RealtimeTransportEvent, { type: 'transcript' }>,
  ) {
    const role = event.role === 'assistant' ? 'assistant' : 'user';
    const key = role === 'assistant' ? 'assistantTranscript' : 'userTranscript';
    // A delta after a final belongs to a NEW turn: start fresh instead of
    // gluing the new turn's first word onto the previous turn's period.
    const previous = this.transcriptSealed[role] ? '' : this.state[key];
    const text = event.final ? event.text : `${previous}${event.text}`;
    this.transcriptSealed[role] = event.final;
    this.patchState({
      [key]: text.slice(0, MAX_TRANSCRIPT_LENGTH),
    });
  }

  private isCurrent(operation: number) {
    return (
      operation === this.operation && !this.abortController?.signal.aborted
    );
  }

  /** Whether each role's transcript currently holds a completed turn. */
  private transcriptSealed = { assistant: false, user: false };

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

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
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
