/**
 * Executes a validated ask_hermes instruction as an ordinary turn on the
 * user's gateway connection — the stage-4 replacement for the retired
 * companion's server-side execution. The turn lands in the bound Hermes session like any
 * other, so its side effects are visible in chat history afterward; only the
 * Realtime speech around it stays ephemeral.
 */
import {
  WAVE_MAX_ASK_HERMES_ANSWER_LENGTH,
  type WaveAskHermesToolResult,
} from '@wave/contracts';

import type { HermesExecutionLifecycle } from './ask-hermes-orchestrator.ts';
import type { GatewayClient } from '../../services/gateway/gateway-client.ts';
import { WaveBackendError } from '../../services/wave/wave-backend-error.ts';

export function createGatewayAskHermesExecutor({
  client,
  sessionId,
}: {
  client: GatewayClient;
  sessionId: string;
}) {
  return async (
    instruction: string,
    signal: AbortSignal,
    lifecycle: HermesExecutionLifecycle,
  ): Promise<WaveAskHermesToolResult> => {
    let active = false;
    let answer = '';
    let truncated = false;
    try {
      for await (const event of client.streamTurn(
        sessionId,
        instruction,
        signal,
      )) {
        // streamTurn yields only after it has registered the live gateway RPC
        // lane. Before this point a correction must fail closed.
        if (!active) {
          active = true;
          lifecycle.activate();
        }
        if (event.type === 'assistant.completed') {
          if (answer.length >= WAVE_MAX_ASK_HERMES_ANSWER_LENGTH) {
            truncated = true;
            continue;
          }
          const next = answer ? `${answer}\n\n${event.content}` : event.content;
          if (next.length > WAVE_MAX_ASK_HERMES_ANSWER_LENGTH) {
            answer = next.slice(0, WAVE_MAX_ASK_HERMES_ANSWER_LENGTH);
            truncated = true;
          } else {
            answer = next;
          }
        } else if (event.type === 'turn.error') {
          return {
            error: {
              code: 'upstream_unavailable',
              message: 'Hermes could not complete the request.',
              retryable: event.error.retryable,
            },
            ok: false,
          };
        }
      }
    } catch (error) {
      return {
        error: {
          code: 'upstream_unavailable',
          message: 'Hermes could not complete the request.',
          retryable: error instanceof WaveBackendError ? error.retryable : true,
        },
        ok: false,
      };
    } finally {
      if (active) lifecycle.deactivate();
    }
    const trimmed = answer.trim();
    return {
      answer: trimmed || 'Hermes completed the request without a text reply.',
      ok: true,
      truncated,
    };
  };
}
