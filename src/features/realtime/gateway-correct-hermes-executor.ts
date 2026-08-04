/**
 * Redirects only the active gateway turn already registered for the trusted
 * conversation. GatewayClient owns the live sid and maps completion races;
 * this adapter emits only bounded Realtime correction results and never
 * retries the mutation.
 */
import {
  WaveCorrectHermesToolResultSchema,
  type WaveCorrectHermesToolResult,
} from '@wave/contracts';

import type { GatewayClient } from '../../services/gateway/gateway-client.ts';
import { WaveBackendError } from '../../services/wave/wave-backend-error.ts';

export function createGatewayCorrectHermesExecutor({
  client,
  sessionId,
}: {
  client: GatewayClient;
  sessionId: string;
}) {
  return async (
    instruction: string,
    signal: AbortSignal,
  ): Promise<WaveCorrectHermesToolResult> => {
    if (signal.aborted) return nothingActive();
    try {
      const response = await client.redirectTurn(sessionId, instruction);
      if (signal.aborted) return nothingActive();
      if (response.status === 'queued' || response.status === 'redirected') {
        return WaveCorrectHermesToolResultSchema.parse({
          ok: true,
          status: response.status,
        });
      }
      return rejected('Hermes rejected that correction.');
    } catch (error) {
      if (error instanceof WaveBackendError && error.kind === 'conflict') {
        return nothingActive();
      }
      return rejected('Hermes could not apply that correction.');
    }
  };
}

function nothingActive(): WaveCorrectHermesToolResult {
  return WaveCorrectHermesToolResultSchema.parse({
    message: 'There is no active Hermes work to correct.',
    ok: false,
    retryable: false,
    status: 'nothing_active',
  });
}

function rejected(message: string): WaveCorrectHermesToolResult {
  return WaveCorrectHermesToolResultSchema.parse({
    message,
    ok: false,
    retryable: false,
    status: 'rejected',
  });
}
