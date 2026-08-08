/**
 * Read-side snapshot of the signed-in gateway connection.
 *
 * `WaveConnectionProvider` remains the owner of the sign-in/verify state
 * machine and of every transition; it publishes the usable snapshot here so
 * screens that only *consume* a connected gateway stop re-deriving the same
 * phase narrowing and re-threading `client`/`connectionId`/`baseUrl` props.
 * Memory-only — nothing here persists; the provider's secure stores stay the
 * source of truth. The client handle is the same object the context exposes.
 */
import { createStore } from 'zustand/vanilla';

import type { GatewayClient } from '@/services/gateway/gateway-client';
import type { WaveChatClient } from '@/services/wave/wave-chat-client';

export interface ConnectedWave {
  baseUrl: string;
  /** Conversation surfaces consume the backend-neutral chat client. */
  client: WaveChatClient;
  /** Stable key for connection-scoped caches and stores. */
  connectionId: string;
  /** Gateway-specific capabilities (speech, prompts, Realtime execution). */
  gatewayClient: GatewayClient;
  label: string;
  /** Both phases are usable for reads; `offline` renders cached data. */
  phase: 'connected' | 'offline';
}

interface ConnectionSnapshotState {
  connected: ConnectedWave | null;
}

const api = createStore<ConnectionSnapshotState>(() => ({ connected: null }));

export const connectionSnapshot = {
  api,
  /** Published exclusively by `WaveConnectionProvider`. */
  publish(connected: ConnectedWave | null) {
    const current = api.getState().connected;
    if (current === connected) return;
    api.setState({ connected });
  },
};
