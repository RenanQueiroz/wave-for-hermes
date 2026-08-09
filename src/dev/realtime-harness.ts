/**
 * Development-only Realtime harness mode: when a harness URL is configured in
 * the development tools screen, the realtime voice screen swaps
 * `api.openai.com` and WebRTC for the local scripted fake in
 * `tools/voice-harness`.
 *
 * Every entry point is `__DEV__`-gated, mirroring `mobile-agent-state.ts`, so
 * Metro's production transform removes the implementation (and its marker
 * strings) from release bundles; `npm run mobile:smoke:production` asserts
 * that removal.
 */
import type { RealtimeHarnessOverrides } from './realtime-harness-impl.ts';

export type { RealtimeHarnessOverrides };

/** The configured overrides, or `undefined` outside dev / without a URL. */
export async function resolveRealtimeHarnessOverrides(): Promise<
  RealtimeHarnessOverrides | undefined
> {
  if (__DEV__) {
    const impl = await import('./realtime-harness-impl.ts');
    const url = await impl.readStoredRealtimeHarnessUrl();
    if (!url) return undefined;
    return impl.createRealtimeHarnessOverrides(url);
  }
  return undefined;
}

export async function readRealtimeHarnessUrl(): Promise<string> {
  if (__DEV__) {
    const impl = await import('./realtime-harness-impl.ts');
    return impl.readStoredRealtimeHarnessUrl();
  }
  return '';
}

/** Persist a harness origin; '' clears harness mode. Throws on invalid URLs. */
export async function setRealtimeHarnessUrl(url: string): Promise<void> {
  if (__DEV__) {
    const impl = await import('./realtime-harness-impl.ts');
    await impl.storeRealtimeHarnessUrl(url);
  }
}
