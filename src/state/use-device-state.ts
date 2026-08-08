/**
 * React bindings for the vanilla device-state stores. The stores stay
 * React-free so node tests drive them directly; components subscribe here.
 */
import { useEffect } from 'react';
import { useStore } from 'zustand';
import type { StoreApi } from 'zustand/vanilla';

import type {
  DevicePreferenceStore,
  PreferenceState,
} from '@/state/create-preference-store';

interface HydratableStore<State> {
  api: StoreApi<State>;
  hydrate(): Promise<void>;
}

/** Subscribe to a hydratable vanilla store, kicking hydration on first use. */
export function useHydratedStore<State>(store: HydratableStore<State>): State {
  useEffect(() => {
    void store.hydrate();
  }, [store]);
  return useStore(store.api);
}

/** Subscribe to one device preference: `{hydrated, value}`. */
export function useDevicePreference<T>(
  store: DevicePreferenceStore<T>,
): PreferenceState<T> {
  return useHydratedStore(store);
}
