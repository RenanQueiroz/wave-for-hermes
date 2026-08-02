import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { WaveTurnEvent, WaveTurnInput } from '@wave/contracts';

import { initialWaveChatState, waveChatReducer } from './chat-state';
import { calculateBoundedRetryDelay } from '@/services/query/retry-policy';
import { WaveBackendError } from '@/services/wave/wave-backend-error';
import type { WaveChatClient } from '@/services/wave/wave-chat-client';

const DELTA_FLUSH_MS = 50;
// Reattaching is a read of the same execution (never a re-dispatch of the
// turn), so it follows the finite-retryable-read policy: at most two
// attempts with the shared bounded exponential-jitter delay.
const MAX_REATTACH_ATTEMPTS = 2;

interface UseWaveChatOptions {
  client: WaveChatClient;
  reconcileTimeline(): Promise<unknown>;
  sessionId: string;
}

export function useWaveChat({
  client,
  reconcileTimeline,
  sessionId,
}: UseWaveChatOptions) {
  const [state, dispatch] = useReducer(waveChatReducer, initialWaveChatState);
  const controllerRef = useRef<AbortController | undefined>(undefined);
  const turnIdRef = useRef<string | undefined>(undefined);
  const busyRef = useRef(false);
  const cancellingRef = useRef(false);
  const idRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cancellingRef.current = true;
      controllerRef.current?.abort();
    };
  }, []);

  const consumeTurn = useCallback(
    async (
      controller: AbortController,
      initialStream: AsyncGenerator<WaveTurnEvent>,
      tracking: { lastSequence: number; resuming: boolean },
    ) => {
      let pendingDelta = '';
      let flushTimer: ReturnType<typeof setTimeout> | undefined;
      const flush = () => {
        if (flushTimer) clearTimeout(flushTimer);
        flushTimer = undefined;
        if (!pendingDelta) return;
        const delta = pendingDelta;
        pendingDelta = '';
        dispatch({ delta, type: 'assistant.delta' });
      };
      const scheduleFlush = () => {
        flushTimer ??= setTimeout(flush, DELTA_FLUSH_MS);
      };

      try {
        let stream = initialStream;
        let reattachAttempts = 0;
        streaming: while (true) {
          try {
            for await (const event of stream) {
              if (!mountedRef.current) return;
              reattachAttempts = 0;
              tracking.lastSequence = event.sequence;
              if (event.type === 'turn.started') {
                turnIdRef.current = event.turnId;
              }
              if (event.type === 'assistant.delta') {
                pendingDelta += event.delta;
                scheduleFlush();
                continue;
              }
              flush();
              dispatch({ event, type: 'event' });
            }
            break streaming;
          } catch (error) {
            const turnId = turnIdRef.current;
            const disconnected =
              error instanceof WaveBackendError &&
              (error.kind === 'network' || error.kind === 'timeout');
            if (
              turnId &&
              disconnected &&
              !cancellingRef.current &&
              mountedRef.current &&
              reattachAttempts < MAX_REATTACH_ATTEMPTS
            ) {
              reattachAttempts += 1;
              await abortableDelay(
                calculateBoundedRetryDelay(reattachAttempts - 1),
                controller.signal,
              );
              if (
                cancellingRef.current ||
                !mountedRef.current ||
                controller.signal.aborted
              ) {
                throw error;
              }
              tracking.resuming = true;
              stream = client.resumeTurnStream(
                sessionId,
                turnId,
                tracking.lastSequence,
                controller.signal,
              );
              continue streaming;
            }
            if (
              turnId &&
              tracking.resuming &&
              error instanceof WaveBackendError &&
              error.kind === 'not_found'
            ) {
              // The turn concluded while this device was away and its replay
              // window has passed; the refreshed timeline is the truth.
              break streaming;
            }
            throw error;
          }
        }
        flush();
        if (!mountedRef.current) return;
        const reconciled = await reconcileTimeline().then(
          () => true,
          () => false,
        );
        if (!mountedRef.current) return;
        if (reconciled) {
          dispatch({ type: 'timeline.reconciled' });
        }
      } catch (error) {
        flush();
        if (!mountedRef.current) return;
        if (
          cancellingRef.current &&
          error instanceof WaveBackendError &&
          error.kind === 'cancelled'
        ) {
          dispatch({ type: 'cancelled' });
        } else {
          const failure = toChatFailure(error);
          dispatch({
            message: failure.message,
            retryable: failure.retryable,
            type: 'transport.error',
          });
        }
        const reconciled = await reconcileTimeline().then(
          () => true,
          () => false,
        );
        if (reconciled && mountedRef.current) {
          dispatch({ type: 'timeline.reconciled' });
        }
      } finally {
        if (flushTimer) clearTimeout(flushTimer);
        if (controllerRef.current === controller) {
          controllerRef.current = undefined;
        }
        turnIdRef.current = undefined;
        cancellingRef.current = false;
        busyRef.current = false;
        if (mountedRef.current) {
          dispatch({ type: 'settled' });
        }
      }
    },
    [client, reconcileTimeline, sessionId],
  );

  const send = useCallback(
    async (input: WaveTurnInput, optimisticText?: string) => {
      const displayText =
        optimisticText?.trim() ??
        (typeof input === 'string' ? input.trim() : '');
      if (!displayText || busyRef.current || !mountedRef.current) {
        return;
      }
      busyRef.current = true;
      cancellingRef.current = false;
      const controller = new AbortController();
      controllerRef.current = controller;
      idRef.current += 1;
      const localId = `${Date.now()}-${idRef.current}`;
      dispatch({
        assistantId: `assistant-${localId}`,
        input: displayText,
        type: 'send',
        userId: `user-${localId}`,
      });
      await consumeTurn(
        controller,
        client.streamTurn(sessionId, input, controller.signal),
        { lastSequence: -1, resuming: false },
      );
    },
    [client, consumeTurn, sessionId],
  );

  const resume = useCallback(
    async (turnId: string) => {
      if (busyRef.current || !mountedRef.current) {
        return;
      }
      busyRef.current = true;
      cancellingRef.current = false;
      const controller = new AbortController();
      controllerRef.current = controller;
      idRef.current += 1;
      turnIdRef.current = turnId;
      dispatch({
        assistantId: `assistant-resume-${Date.now()}-${idRef.current}`,
        turnId,
        type: 'resume',
      });
      await consumeTurn(
        controller,
        client.resumeTurnStream(sessionId, turnId, -1, controller.signal),
        { lastSequence: -1, resuming: true },
      );
    },
    [client, consumeTurn, sessionId],
  );

  const stop = useCallback(async () => {
    const controller = controllerRef.current;
    if (!controller || cancellingRef.current) return;
    cancellingRef.current = true;
    dispatch({ type: 'cancel.requested' });
    const turnId = turnIdRef.current;
    let cancellationAccepted = false;
    try {
      if (turnId) {
        await client.cancelTurn(sessionId, turnId);
        cancellationAccepted = true;
      }
    } catch {
      // The local abort below still closes the streaming request when the
      // authenticated cancellation endpoint cannot accept the request.
    } finally {
      if (!cancellationAccepted) {
        controller.abort();
      }
    }
  }, [client, sessionId]);

  return {
    resume,
    send,
    state,
    stop,
  };
}

function toChatFailure(error: unknown) {
  if (error instanceof WaveBackendError) {
    return {
      message: error.message,
      retryable: error.retryable,
    };
  }
  return {
    message: 'Wave could not complete this turn.',
    retryable: true,
  };
}

function abortableDelay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const settle = () => {
      signal.removeEventListener('abort', settle);
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(settle, ms);
    signal.addEventListener('abort', settle, { once: true });
  });
}
