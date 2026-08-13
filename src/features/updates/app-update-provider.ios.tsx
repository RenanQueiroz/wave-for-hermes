/**
 * iOS passthrough: sideloaded self-update does not exist on iOS, so the
 * provider renders children untouched and the hook reports the feature
 * unsupported. Nothing iOS-side ever references the updater beyond this.
 */
import type { PropsWithChildren } from 'react';

import type { AppUpdateHandle } from '@/features/updates/app-update.shared';

export function AppUpdateProvider({ children }: PropsWithChildren) {
  return children;
}

export function useAppUpdate(): AppUpdateHandle {
  return { checkNow: () => undefined, supported: false };
}
