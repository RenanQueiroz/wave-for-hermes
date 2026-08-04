import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { WaveTurnEvent, WaveTurnInput } from '@wave/contracts';

import {
  initialWaveChatState,
  waveChatReducer,
  type WaveChatLiveStatus,
} from './chat-state';
import { calculateBoundedRetryDelay } from '@/services/query/retry-policy';
import { WaveBackendError } from '@/services/wave/wave-backend-error';
import type { WaveChatClient } from '@/services/wave/wave-chat-client';

const DELTA_FLUSH_MS = 50;
// Reattaching is a read of the same execution (never a re-dispatch of the
// turn), so it follows the finite-retryable-read policy: at most two
// attempts with the shared bounded exponential-jitter delay.
const MAX_REATTACH_ATTEMPTS = 2;

export interface WaveCorrectionResult {
  draft: string;
  status: 'failed' | 'queued' | 'redirected' | 'rejected' | 'unavailable';
}

interface UseWaveChatOptions {
  client: WaveChatClient;
  getCorrectionAnchor(): string | undefined;
  persistCorrection(input: {
    anchorText: string;
    createdAt: string;
    id: string;
    sessionId: string;
    text: string;
  }): void;
  reconcileTimeline(): Promise<unknown>;
  sessionId: string;
}

export function useWaveChat({
  client,
  getCorrectionAnchor,
  persistCorrection,
  reconcileTimeline,
  sessionId,
}: UseWaveChatOptions) {
  const [state, dispatch] = useReducer(waveChatReducer, initialWaveChatState);
  const controllerRef = useRef<AbortController | undefined>(undefined);
  const turnIdRef = useRef<string | undefined>(undefined);
  const busyRef = useRef(false);
  const cancellingRef = useRef(false);
  const correctingRef = useRef(false);
  const correctionAnchorRef = useRef<string | undefined>(undefined);
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

  useEffect(() => {
    correctionAnchorRef.current = undefined;
  }, [sessionId]);

  const consumeTurn = useCallback(
    async (
      controller: AbortController,
      initialStream: AsyncGenerator<WaveTurnEvent>,
      tracking: { lastSequence: number; resuming: boolean },
    ) => {
      let pendingDelta = '';
      let pendingDeltaTimestamp = new Date().toISOString();
      let flushTimer: ReturnType<typeof setTimeout> | undefined;
      const flush = () => {
        if (flushTimer) clearTimeout(flushTimer);
        flushTimer = undefined;
        if (!pendingDelta) return;
        const delta = pendingDelta;
        pendingDelta = '';
        dispatch({
          delta,
          timestamp: pendingDeltaTimestamp,
          type: 'assistant.delta',
        });
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
                pendingDeltaTimestamp = event.timestamp;
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
      if (
        !displayText ||
        busyRef.current ||
        correctingRef.current ||
        !mountedRef.current
      ) {
        return;
      }
      busyRef.current = true;
      cancellingRef.current = false;
      correctionAnchorRef.current = turnInputText(input) ?? displayText;
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
    async (
      turnId: string,
      liveState?: {
        lastActivityAt?: string;
        liveStatus?: WaveChatLiveStatus;
      },
    ) => {
      if (busyRef.current || correctingRef.current || !mountedRef.current) {
        return;
      }
      busyRef.current = true;
      cancellingRef.current = false;
      correctionAnchorRef.current = getCorrectionAnchor();
      const controller = new AbortController();
      controllerRef.current = controller;
      idRef.current += 1;
      turnIdRef.current = turnId;
      dispatch({
        assistantId: `assistant-resume-${Date.now()}-${idRef.current}`,
        ...(liveState?.lastActivityAt
          ? { lastActivityAt: liveState.lastActivityAt }
          : {}),
        liveStatus: liveState?.liveStatus ?? 'working',
        turnId,
        type: 'resume',
      });
      await consumeTurn(
        controller,
        client.resumeTurnStream(sessionId, turnId, -1, controller.signal),
        { lastSequence: -1, resuming: true },
      );
    },
    [client, consumeTurn, getCorrectionAnchor, sessionId],
  );

  const stop = useCallback(async () => {
    const controller = controllerRef.current;
    if (!controller || cancellingRef.current || correctingRef.current) return;
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

  const reconcileCorrectionRace = useCallback(async () => {
    const active = await client.getActiveTurn(sessionId).then(
      (result) => Boolean(result.activeTurn),
      () => true,
    );
    if (active || !mountedRef.current) return;
    const reconciled = await reconcileTimeline().then(
      () => true,
      () => false,
    );
    if (reconciled && mountedRef.current) {
      dispatch({ type: 'timeline.reconciled' });
    }
  }, [client, reconcileTimeline, sessionId]);

  const correct = useCallback(
    async (text: string): Promise<WaveCorrectionResult> => {
      const draft = text.trim();
      if (
        !draft ||
        !busyRef.current ||
        cancellingRef.current ||
        correctingRef.current ||
        !mountedRef.current
      ) {
        return { draft, status: 'unavailable' };
      }
      correctingRef.current = true;
      idRef.current += 1;
      const messageId = `correction-${Date.now()}-${idRef.current}`;
      const createdAt = new Date().toISOString();
      const anchorText = correctionAnchorRef.current ?? getCorrectionAnchor();
      dispatch({ messageId, text: draft, type: 'correction.requested' });
      try {
        const result = await client.redirectTurn(sessionId, text);
        if (
          (result.status === 'queued' || result.status === 'redirected') &&
          anchorText
        ) {
          try {
            persistCorrection({
              anchorText,
              createdAt,
              id: messageId,
              sessionId: result.sessionId,
              text: draft,
            });
          } catch {
            // The gateway already accepted the correction. A local cache
            // failure must not turn that successful mutation into a retryable
            // action or risk dispatching it twice.
          }
        }
        if (result.status === 'queued' || result.status === 'redirected') {
          correctionAnchorRef.current = draft;
        }
        if (!mountedRef.current) {
          return { draft, status: 'unavailable' };
        }
        dispatch({
          messageId,
          status: result.status,
          type: 'correction.resolved',
        });
        if (result.status === 'rejected') {
          void reconcileCorrectionRace();
        }
        return { draft, status: result.status };
      } catch (error) {
        const failure = toCorrectionFailure(error);
        if (mountedRef.current) {
          dispatch({
            message: failure.message,
            messageId,
            retryable: failure.retryable,
            type: 'correction.failed',
          });
          void reconcileCorrectionRace();
        }
        return { draft, status: 'failed' };
      } finally {
        correctingRef.current = false;
      }
    },
    [
      client,
      getCorrectionAnchor,
      persistCorrection,
      reconcileCorrectionRace,
      sessionId,
    ],
  );

  return {
    correct,
    resume,
    send,
    state,
    stop,
  };
}

function toCorrectionFailure(error: unknown) {
  if (error instanceof WaveBackendError) {
    return {
      message: error.message,
      retryable: error.retryable,
    };
  }
  return {
    message: 'Wave could not deliver that correction.',
    retryable: false,
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

function turnInputText(input: WaveTurnInput) {
  if (typeof input === 'string') return input.trim() || undefined;
  const textPart = input.find((part) => part.type === 'text');
  return textPart?.type === 'text'
    ? textPart.text.trim() || undefined
    : undefined;
}
