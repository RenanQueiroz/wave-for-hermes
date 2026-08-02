/**
 * Sideband channel of an OpenAI Realtime call: the JSON event socket that
 * runs beside the WebRTC media connection. Ported from the retired companion for the
 * user-owned-key path (stage 4); the delivery rule it owns is response-safe
 * timing — a Hermes result is sent only when no model response and no user
 * speech is in progress, queued otherwise, exactly like the retired companion did.
 *
 * There is no interaction ledger: Realtime transcripts
 * are ephemeral, so no handoff metadata rides on responses.
 */
import {
  WaveAskHermesToolResultSchema,
  type WaveAskHermesToolResult,
} from '@wave/contracts';

import { WAVE_MAX_REALTIME_EVENT_BYTES } from './realtime-transport.ts';

export interface SidebandFunctionCall {
  arguments: string;
  callId: string;
  name: string;
  userItemId?: string;
}

export class RealtimeSidebandError extends Error {
  readonly retryable: boolean;
  constructor(message: string, retryable = false) {
    super(message);
    this.name = 'RealtimeSidebandError';
    this.retryable = retryable;
  }
}

const MAX_STRING_FIELD = 100_000;

export class OpenAiRealtimeSideband {
  private closed = false;
  private readonly closeListeners = new Set<() => void>();
  private readonly errorListeners = new Set<
    (error: RealtimeSidebandError) => void
  >();
  private readonly functionCallListeners = new Set<
    (call: SidebandFunctionCall) => void
  >();
  private latestUserItemId?: string;
  private readonly pendingResults: { callId: string; output: string }[] = [];
  private responseInProgress = false;
  private readonly responseUserItems = new Map<string, string>();
  private readonly socket: WebSocket;
  private userSpeaking = false;

  constructor(socket: WebSocket) {
    this.socket = socket;
    socket.addEventListener('message', (event) => {
      this.handleMessage((event as { data?: unknown }).data);
    });
    socket.addEventListener('close', () => this.markClosed());
    socket.addEventListener('error', () => {
      this.emitError(
        new RealtimeSidebandError(
          'Could not maintain the Realtime sideband connection.',
          true,
        ),
      );
    });
  }

  close() {
    if (this.closed) return;
    try {
      this.socket.close(1000, 'Wave call ended');
    } catch {
      // Already closing.
    }
    this.markClosed();
  }

  onClose(listener: () => void) {
    this.closeListeners.add(listener);
    if (this.closed) queueMicrotask(listener);
  }

  onError(listener: (error: RealtimeSidebandError) => void) {
    this.errorListeners.add(listener);
  }

  onFunctionCall(listener: (call: SidebandFunctionCall) => void) {
    this.functionCallListeners.add(listener);
  }

  /**
   * Queue a Hermes result. It reaches the model only when no response and no
   * user speech is in progress; a completed response flushes the queue.
   */
  sendFunctionResult(callId: string, result: WaveAskHermesToolResult) {
    if (this.closed) return false;
    this.pendingResults.push({
      callId,
      output: JSON.stringify(WaveAskHermesToolResultSchema.parse(result)),
    });
    return this.flushResults();
  }

  async waitUntilOpen(timeoutMs: number, signal?: AbortSignal) {
    if (this.socket.readyState === 1) return;
    if (this.closed || this.socket.readyState === 3) {
      throw new RealtimeSidebandError(
        'Realtime closed before the sideband connected.',
        true,
      );
    }
    await new Promise<void>((resolve, reject) => {
      const settle = (error?: RealtimeSidebandError) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        this.socket.removeEventListener('open', onOpen);
        this.socket.removeEventListener('close', onClose);
        this.socket.removeEventListener('error', onSocketError);
        if (error) reject(error);
        else resolve();
      };
      const onAbort = () =>
        settle(new RealtimeSidebandError('Realtime setup was cancelled.'));
      const onClose = () =>
        settle(
          new RealtimeSidebandError(
            'Realtime closed before the sideband connected.',
            true,
          ),
        );
      const onSocketError = () =>
        settle(
          new RealtimeSidebandError(
            'Could not connect the Realtime sideband.',
            true,
          ),
        );
      const onOpen = () => settle();
      const timer = setTimeout(
        () =>
          settle(new RealtimeSidebandError('Realtime setup timed out.', true)),
        timeoutMs,
      );
      if (signal?.aborted) {
        onAbort();
        return;
      }
      signal?.addEventListener('abort', onAbort, { once: true });
      this.socket.addEventListener('open', onOpen);
      this.socket.addEventListener('close', onClose);
      this.socket.addEventListener('error', onSocketError);
    });
  }

  private emitError(error: RealtimeSidebandError) {
    for (const listener of this.errorListeners) listener(error);
  }

  private flushResults() {
    if (this.closed || this.responseInProgress || this.userSpeaking) {
      return !this.closed;
    }
    if (this.pendingResults.length === 0) return true;
    try {
      for (const result of this.pendingResults) {
        this.socket.send(
          JSON.stringify({
            item: {
              call_id: result.callId,
              output: result.output,
              type: 'function_call_output',
            },
            type: 'conversation.item.create',
          }),
        );
      }
      this.pendingResults.length = 0;
      this.socket.send(
        JSON.stringify({ response: {}, type: 'response.create' }),
      );
      // Active immediately, so two fast completions cannot race ahead of the
      // response.created event.
      this.responseInProgress = true;
      return true;
    } catch {
      this.emitError(
        new RealtimeSidebandError(
          'Could not send the Hermes result to Realtime.',
          true,
        ),
      );
      this.close();
      return false;
    }
  }

  private handleMessage(data: unknown) {
    if (
      typeof data !== 'string' ||
      data.length > WAVE_MAX_REALTIME_EVENT_BYTES
    ) {
      return;
    }
    let event: unknown;
    try {
      event = JSON.parse(data);
    } catch {
      return;
    }
    if (!isRecord(event) || typeof event.type !== 'string') return;

    switch (event.type) {
      case 'input_audio_buffer.speech_started':
        this.userSpeaking = true;
        return;
      case 'input_audio_buffer.speech_stopped':
        this.userSpeaking = false;
        this.flushResults();
        return;
      case 'conversation.item.added':
      case 'conversation.item.done': {
        const item = isRecord(event.item) ? event.item : undefined;
        if (
          item &&
          item.role === 'user' &&
          typeof item.id === 'string' &&
          item.id.length <= 200
        ) {
          this.latestUserItemId = item.id;
        }
        return;
      }
      case 'response.created':
        this.responseInProgress = true;
        if (isRecord(event.response) && typeof event.response.id === 'string') {
          if (this.latestUserItemId) {
            this.responseUserItems.set(
              event.response.id,
              this.latestUserItemId,
            );
          }
        }
        return;
      case 'response.done': {
        if (!isRecord(event.response)) return;
        this.responseInProgress = false;
        const responseId =
          typeof event.response.id === 'string' ? event.response.id : undefined;
        const userItemId = responseId
          ? this.responseUserItems.get(responseId)
          : undefined;
        if (responseId) this.responseUserItems.delete(responseId);
        const outputs = Array.isArray(event.response.output)
          ? event.response.output
          : [];
        for (const output of outputs) {
          if (!isRecord(output) || output.type !== 'function_call') continue;
          if (
            typeof output.call_id !== 'string' ||
            output.call_id.length > 200 ||
            typeof output.name !== 'string' ||
            output.name.length > 100 ||
            typeof output.arguments !== 'string' ||
            output.arguments.length > MAX_STRING_FIELD
          ) {
            continue;
          }
          for (const listener of this.functionCallListeners) {
            listener({
              arguments: output.arguments,
              callId: output.call_id,
              name: output.name,
              ...(userItemId ? { userItemId } : {}),
            });
          }
        }
        this.flushResults();
        return;
      }
      default:
        return;
    }
  }

  private markClosed() {
    if (this.closed) return;
    this.closed = true;
    for (const listener of this.closeListeners) listener();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
