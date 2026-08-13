/**
 * Platform-neutral core of the Android in-app updater: the update-flow state
 * machine, sheet copy, and the props contract the platform sheet implements.
 * Side effects (feed fetch, download task, installer intent) live in the
 * Android provider; this module stays pure so node tests cover every
 * transition.
 */

import type {
  WaveAppUpdate,
  WaveUpdateCheckOutcome,
} from '@/services/updates/github-release-feed';

export type AppUpdateTrigger = 'auto' | 'manual';

export type AppUpdateState =
  | { phase: 'idle' }
  | { phase: 'checking'; trigger: AppUpdateTrigger }
  | { phase: 'up-to-date' }
  | { phase: 'available'; update: WaveAppUpdate }
  | { phase: 'downloading'; progress?: number; update: WaveAppUpdate }
  | { phase: 'verifying'; update: WaveAppUpdate }
  | { phase: 'ready'; update: WaveAppUpdate }
  | { phase: 'error'; message: string };

export type AppUpdateEvent =
  | { type: 'check-started'; trigger: AppUpdateTrigger }
  | { type: 'check-completed'; outcome: WaveUpdateCheckOutcome }
  | { type: 'check-failed'; message: string }
  | { type: 'download-started' }
  | { type: 'download-progress'; progress?: number }
  | { type: 'download-completed' }
  | { type: 'verified' }
  | { type: 'failed'; message: string }
  | { type: 'dismissed' };

export const APP_UPDATE_IDLE: AppUpdateState = { phase: 'idle' };

/**
 * Deterministic transition function. Events that do not apply to the current
 * phase leave the state unchanged, so a stale async completion can never
 * corrupt the flow.
 */
export function appUpdateReducer(
  state: AppUpdateState,
  event: AppUpdateEvent,
): AppUpdateState {
  switch (event.type) {
    case 'check-started':
      return state.phase === 'idle' ||
        state.phase === 'up-to-date' ||
        state.phase === 'available' ||
        state.phase === 'error'
        ? { phase: 'checking', trigger: event.trigger }
        : state;
    case 'check-completed':
      if (state.phase !== 'checking') return state;
      if (event.outcome.kind === 'update') {
        return { phase: 'available', update: event.outcome.update };
      }
      return state.trigger === 'manual'
        ? { phase: 'up-to-date' }
        : APP_UPDATE_IDLE;
    case 'check-failed':
      if (state.phase !== 'checking') return state;
      // Auto checks fail silently; the user did not ask for anything.
      return state.trigger === 'manual'
        ? { phase: 'error', message: event.message }
        : APP_UPDATE_IDLE;
    case 'download-started':
      return state.phase === 'available'
        ? { phase: 'downloading', update: state.update }
        : state;
    case 'download-progress':
      return state.phase === 'downloading'
        ? {
            phase: 'downloading',
            ...(event.progress === undefined
              ? {}
              : { progress: event.progress }),
            update: state.update,
          }
        : state;
    case 'download-completed':
      return state.phase === 'downloading'
        ? { phase: 'verifying', update: state.update }
        : state;
    case 'verified':
      return state.phase === 'verifying'
        ? { phase: 'ready', update: state.update }
        : state;
    case 'failed':
      return state.phase === 'downloading' ||
        state.phase === 'verifying' ||
        state.phase === 'ready' ||
        state.phase === 'available'
        ? { phase: 'error', message: event.message }
        : state;
    case 'dismissed':
      return APP_UPDATE_IDLE;
  }
}

/** Auto checks stay invisible until they find an update. */
export function isUpdateSheetPresented(state: AppUpdateState): boolean {
  if (state.phase === 'idle') return false;
  if (state.phase === 'checking') return state.trigger === 'manual';
  return true;
}

export function formatUpdateVersion(update: WaveAppUpdate): string {
  return `${update.versionName} (${update.versionCode})`;
}

export function formatUpdateSize(bytes: number): string {
  const mib = bytes / (1024 * 1024);
  return `${mib >= 100 ? Math.round(mib) : mib.toFixed(1)} MB`;
}

/** 0-1 fraction, or undefined while the total is unknown. */
export function downloadFraction(
  bytesWritten: number,
  totalBytes: number,
  expectedBytes: number,
): number | undefined {
  const total = totalBytes > 0 ? totalBytes : expectedBytes;
  if (!(total > 0) || !(bytesWritten >= 0)) return undefined;
  return Math.min(1, bytesWritten / total);
}

export const APP_UPDATE_COPY = {
  availableTitle: 'Update available',
  checkFailed: 'Wave could not check for updates. Try again later.',
  checkingTitle: 'Checking for updates…',
  close: 'Close',
  downloadFailed: 'Wave could not download the update. Try again later.',
  downloadInstall: 'Download and install',
  downloadingLabel: 'Downloading update…',
  errorTitle: 'Update failed',
  install: 'Install',
  installFailed: 'Wave could not open the Android installer.',
  notNow: 'Not now',
  readyBody:
    'Wave will close while Android installs the update. Reopen it from the installer when it finishes.',
  readyTitle: 'Ready to install',
  unknownSourcesHint:
    'If Android blocks the install, allow Wave to install unknown apps in the system settings, then tap Install again.',
  upToDateTitle: "You're up to date",
  verifyFailed: 'The downloaded update failed verification and was discarded.',
  verifyingLabel: 'Verifying download…',
} as const;

/** Implemented by the Android sheet; iOS renders nothing. */
export interface AppUpdateSheetProps {
  installedVersion: string;
  onDismiss: () => void;
  onDownload: () => void;
  onInstall: () => void;
  state: AppUpdateState;
}

/** What screens may do with the updater; both platform providers expose it. */
export interface AppUpdateHandle {
  checkNow: () => void;
  supported: boolean;
}
