import { useStore } from 'zustand';

import {
  connectionSnapshot,
  type ConnectedWave,
} from '@/state/connection-state';

export type { ConnectedWave };

/**
 * The usable gateway connection, or null while there is none (loading,
 * signing in, disconnected, or a hard connection error). Screens that need
 * the full connection state machine — sign-in, retry, disconnect, error
 * copy — keep using `useWaveConnection()`.
 */
export function useConnectedWave(): ConnectedWave | null {
  return useStore(connectionSnapshot.api).connected;
}
