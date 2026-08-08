/**
 * Presence-only projection of the user's OpenAI key plus the live-voice
 * switch. The key value itself never leaves `openAiKeyStore` (platform
 * secure storage); this store carries booleans so screens can gate Realtime
 * without touching the secret. Mutations (save/remove/toggle) go through the
 * key store and then `refresh()` here.
 */
import { createStore } from 'zustand/vanilla';

// Relative import with extension: node tests resolve neither `@/` nor
// extensionless paths.
import { openAiKeyStore } from '../services/realtime/openai-key-store.ts';

export interface OpenAiKeyState {
  hasKey: boolean;
  /** False until the first read of secure storage settles. */
  hydrated: boolean;
  realtimeEnabled: boolean;
}

const api = createStore<OpenAiKeyState>(() => ({
  hasKey: false,
  hydrated: false,
  realtimeEnabled: true,
}));

let hydration: Promise<void> | undefined;

async function readState() {
  try {
    const [key, realtimeEnabled] = await Promise.all([
      openAiKeyStore.load(),
      openAiKeyStore.loadRealtimeEnabled(),
    ]);
    api.setState({ hasKey: Boolean(key), hydrated: true, realtimeEnabled });
  } catch {
    // An unreadable secure store reads as "no key": Realtime stays gated off
    // and the gateway voice default applies.
    api.setState({ hasKey: false, hydrated: true, realtimeEnabled: true });
  }
}

export const openAiKeyState = {
  api,
  /** First read of secure storage; later calls await the same read. */
  hydrate(): Promise<void> {
    hydration ??= readState();
    return hydration;
  },
  /** Re-read after a key save/remove or live-voice toggle. */
  refresh(): Promise<void> {
    hydration = readState();
    return hydration;
  },
};
