/**
 * Android update-flow owner: one bounded check, one download task, one
 * installer hand-off at a time, reduced through the shared state machine.
 * Active only in the production package — dev and preview clients have
 * different application ids that a release APK could never update.
 *
 * The install path is the system installer via ACTION_VIEW on the downloaded
 * file's content URI (the flow Telegram's non-Play build uses). Android
 * kills this process while installing and blocks background relaunch, so the
 * sheet says the app will close; the installer's own Open button is the way
 * back in.
 */
import * as Application from 'expo-application';
import { Directory, File, Paths } from 'expo-file-system';
import * as IntentLauncher from 'expo-intent-launcher';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type PropsWithChildren,
} from 'react';
import { fetch as expoFetch } from 'expo/fetch';

import {
  APP_UPDATE_COPY,
  APP_UPDATE_IDLE,
  appUpdateReducer,
  downloadFraction,
  type AppUpdateHandle,
  type AppUpdateState,
  type AppUpdateTrigger,
} from '@/features/updates/app-update.shared';
import { AppUpdateSheet } from '@/features/updates/update-sheet';
import type { WaveAppUpdate } from '@/services/updates/github-release-feed';
import { fetchLatestUpdateOutcome } from '@/services/updates/update-feed-client';
import { updateAutoCheckPreference } from '@/state/device-preferences';

const PRODUCTION_APPLICATION_ID = 'com.renanqueiroz.wave';
const UPDATES_CACHE_DIRECTORY = 'wave-updates';
const AUTO_CHECK_DELAY_MS = 3_000;
const PROGRESS_DISPATCH_INTERVAL_MS = 150;
/** Tolerance before an over-long download stream is treated as hostile. */
const DOWNLOAD_SLACK_BYTES = 1024 * 1024;
const MD5_SIDECAR_TIMEOUT_MS = 10_000;
const MD5_SIDECAR_MAX_CHARS = 1_024;
const ANDROID_INSTALL_ACTION = 'android.intent.action.VIEW';
const APK_MIME_TYPE = 'application/vnd.android.package-archive';
/** Intent.FLAG_GRANT_READ_URI_PERMISSION. */
const GRANT_READ_URI_PERMISSION = 1;

// One automatic check per app process, across provider remounts.
let autoCheckDone = false;

const AppUpdateContext = createContext<AppUpdateHandle | undefined>(undefined);

export function useAppUpdate(): AppUpdateHandle {
  return (
    useContext(AppUpdateContext) ?? {
      checkNow: () => undefined,
      supported: false,
    }
  );
}

export function AppUpdateProvider({ children }: PropsWithChildren) {
  const installedVersionCode = Number(Application.nativeBuildVersion);
  const supported =
    Application.applicationId === PRODUCTION_APPLICATION_ID &&
    Number.isSafeInteger(installedVersionCode) &&
    installedVersionCode > 0;
  const installedVersion = `${Application.nativeApplicationVersion ?? '?'} (${
    Application.nativeBuildVersion ?? '?'
  })`;

  const [state, dispatch] = useReducer(appUpdateReducer, APP_UPDATE_IDLE);
  const stateRef = useRef<AppUpdateState>(APP_UPDATE_IDLE);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Monotonic token: bumping it abandons any in-flight download/verify.
  const flowRef = useRef(0);
  const taskRef = useRef<ReturnType<typeof File.createDownloadTask> | null>(
    null,
  );
  const fileRef = useRef<File | null>(null);
  const lastProgressAtRef = useRef(0);

  const abandonTransfer = useCallback(() => {
    flowRef.current += 1;
    try {
      taskRef.current?.cancel();
    } catch {
      // A settled task has nothing to cancel.
    }
    taskRef.current = null;
    const file = fileRef.current;
    fileRef.current = null;
    if (file) {
      try {
        file.delete();
      } catch {
        // Already gone; the mount-time sweep also covers strays.
      }
    }
  }, []);

  const checkNow = useCallback(
    (trigger: AppUpdateTrigger = 'manual') => {
      if (!supported) return;
      const phase = stateRef.current.phase;
      if (
        phase !== 'idle' &&
        phase !== 'up-to-date' &&
        phase !== 'available' &&
        phase !== 'error'
      ) {
        return;
      }
      dispatch({ type: 'check-started', trigger });
      fetchLatestUpdateOutcome(installedVersionCode).then(
        (outcome) => dispatch({ type: 'check-completed', outcome }),
        (error: unknown) =>
          dispatch({
            type: 'check-failed',
            message:
              error instanceof Error && error.message.length > 0
                ? error.message
                : APP_UPDATE_COPY.checkFailed,
          }),
      );
    },
    [installedVersionCode, supported],
  );

  const install = useCallback(() => {
    const file = fileRef.current;
    if (!file) return;
    IntentLauncher.startActivityAsync(ANDROID_INSTALL_ACTION, {
      data: file.contentUri,
      flags: GRANT_READ_URI_PERMISSION,
      type: APK_MIME_TYPE,
    }).catch(() =>
      dispatch({ type: 'failed', message: APP_UPDATE_COPY.installFailed }),
    );
    // If the user cancels the installer, the phase stays `ready` so the
    // sheet's Install button can relaunch it without a second download.
  }, []);

  const download = useCallback(() => {
    if (stateRef.current.phase !== 'available') return;
    const update = stateRef.current.update;
    abandonTransfer();
    const flow = flowRef.current;
    dispatch({ type: 'download-started' });

    void (async () => {
      try {
        const directory = new Directory(Paths.cache, UPDATES_CACHE_DIRECTORY);
        try {
          directory.create({ idempotent: true, intermediates: true });
        } catch {
          // Exists already.
        }
        const destination = new File(
          directory,
          `wave-${update.versionName}.apk`,
        );
        try {
          if (destination.exists) destination.delete();
        } catch {
          // A stale entry that cannot be removed fails the download below.
        }

        const task = File.createDownloadTask(update.apkUrl, destination, {
          onProgress: ({ bytesWritten, totalBytes }) => {
            if (flowRef.current !== flow) return;
            if (bytesWritten > update.apkSizeBytes + DOWNLOAD_SLACK_BYTES) {
              // The stream is longer than the release declared; stop it.
              abandonTransfer();
              dispatch({
                type: 'failed',
                message: APP_UPDATE_COPY.downloadFailed,
              });
              return;
            }
            const now = Date.now();
            if (now - lastProgressAtRef.current < PROGRESS_DISPATCH_INTERVAL_MS)
              return;
            lastProgressAtRef.current = now;
            dispatch({
              type: 'download-progress',
              progress: downloadFraction(
                bytesWritten,
                totalBytes,
                update.apkSizeBytes,
              ),
            });
          },
        });
        taskRef.current = task;
        const downloaded = await task.downloadAsync();
        if (flowRef.current !== flow) return;
        taskRef.current = null;
        if (!downloaded) throw new Error(APP_UPDATE_COPY.downloadFailed);
        fileRef.current = downloaded;
        dispatch({ type: 'download-completed' });

        if (downloaded.size !== update.apkSizeBytes) {
          throw new Error(APP_UPDATE_COPY.verifyFailed);
        }
        await verifyMd5(downloaded, update);
        if (flowRef.current !== flow) return;

        dispatch({ type: 'verified' });
        // The user already consented at "Download and install"; hand off to
        // the system installer without another tap.
        install();
      } catch (error) {
        if (flowRef.current !== flow) return;
        abandonTransfer();
        dispatch({
          type: 'failed',
          message:
            error instanceof Error && error.message.length > 0
              ? error.message
              : APP_UPDATE_COPY.downloadFailed,
        });
      }
    })();
  }, [abandonTransfer, install]);

  const dismiss = useCallback(() => {
    abandonTransfer();
    dispatch({ type: 'dismissed' });
  }, [abandonTransfer]);

  // Sweep stale downloads once per mount; a completed install can never
  // clean up after itself because Android kills the process to update.
  useEffect(() => {
    if (!supported) return;
    try {
      const directory = new Directory(Paths.cache, UPDATES_CACHE_DIRECTORY);
      if (!directory.exists) return;
      for (const entry of directory.list()) {
        try {
          entry.delete();
        } catch {
          // Leave what cannot be removed; it is bounded to this directory.
        }
      }
    } catch {
      // Cache enumeration is best-effort.
    }
  }, [supported]);

  useEffect(() => {
    if (!supported || autoCheckDone) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      updateAutoCheckPreference
        .read()
        .then((enabled) => {
          if (cancelled || autoCheckDone || !enabled) return;
          autoCheckDone = true;
          checkNow('auto');
        })
        .catch(() => undefined);
    }, AUTO_CHECK_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [checkNow, supported]);

  useEffect(() => abandonTransfer, [abandonTransfer]);

  const handle = useMemo<AppUpdateHandle>(
    () => ({ checkNow: () => checkNow('manual'), supported }),
    [checkNow, supported],
  );

  return (
    <AppUpdateContext.Provider value={handle}>
      {children}
      <AppUpdateSheet
        installedVersion={installedVersion}
        onDismiss={dismiss}
        onDownload={download}
        onInstall={install}
        state={state}
      />
    </AppUpdateContext.Provider>
  );
}

/**
 * Compares the platform-computed md5 of the download against the release's
 * `.md5` sidecar. A missing sidecar keeps the exact-size check as the only
 * corruption gate; a present-but-unfetchable or mismatched sidecar fails
 * the flow.
 */
async function verifyMd5(file: File, update: WaveAppUpdate): Promise<void> {
  if (!update.md5Url) return;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), MD5_SIDECAR_TIMEOUT_MS);
  let sidecar: string;
  try {
    const response = await expoFetch(update.md5Url, { signal: abort.signal });
    if (!response.ok) throw new Error(APP_UPDATE_COPY.downloadFailed);
    sidecar = await response.text();
  } catch {
    throw new Error(APP_UPDATE_COPY.downloadFailed);
  } finally {
    clearTimeout(timer);
  }
  const expected = /^[0-9a-f]{32}/.exec(
    sidecar.slice(0, MD5_SIDECAR_MAX_CHARS).trim().toLowerCase(),
  )?.[0];
  const actual = file.info({ md5: true }).md5?.toLowerCase();
  if (!expected || !actual || expected !== actual) {
    throw new Error(APP_UPDATE_COPY.verifyFailed);
  }
}
