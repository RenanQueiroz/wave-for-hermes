import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { WaveTurnInput } from '@wave/contracts';

import { initialWaveChatState, waveChatReducer } from './chat-state';
import {
  WaveBackendClient,
  WaveBackendError,
} from '@/services/wave/wave-backend-client';

const DELTA_FLUSH_MS = 50;

interface UseWaveChatOptions {
  client: WaveBackendClient;
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
        for await (const event of client.streamTurn(
          sessionId,
          input,
          controller.signal,
        )) {
          if (!mountedRef.current) return;
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
