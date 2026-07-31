import { existsSync } from 'node:fs';
import { basename, delimiter, dirname, isAbsolute, join } from 'node:path';

import { ANDROID_PACKAGE, type MobileAgentConfig } from '../config.js';
import { runCommand } from '../process.js';
import type { AndroidDevice, AndroidDiscovery, Diagnostic } from '../types.js';

export async function discoverAndroid(
  config: Pick<MobileAgentConfig, 'androidSerial'> = {},
  env = process.env,
): Promise<AndroidDiscovery> {
  const diagnostics: Diagnostic[] = [];
  const adbPath = await resolveAdbPath(env);

  if (!adbPath) {
    diagnostics.push({
      code: 'ADB_NOT_FOUND',
      status: 'warning',
      message: 'ADB was not found. Android discovery is unavailable.',
      recovery:
        'Install Android platform-tools and set ANDROID_HOME or add adb to PATH.',
    });
    return { devices: [], diagnostics };
  }

  const listed = await runCommand(adbPath, ['devices', '-l'], {
    timeoutMs: 10_000,
  });
  if (!listed.ok) {
    diagnostics.push({
      code: 'ADB_LIST_FAILED',
      status: 'warning',
      message:
        listed.stderr.trim() ||
        listed.error ||
        'Unable to list Android devices.',
      recovery:
        'Start an Android emulator from Radon and confirm adb devices succeeds.',
    });
    return { adbPath, devices: [], diagnostics };
  }

  const parsed = parseAdbDevices(listed.stdout);
  const devices = await Promise.all(
    parsed.map(async (device): Promise<AndroidDevice> => {
      if (device.state !== 'device') {
        return { ...device, appInstalled: false, appRunning: false };
      }
      const installed = await runCommand(
        adbPath,
        ['-s', device.serial, 'shell', 'pm', 'path', ANDROID_PACKAGE],
        { timeoutMs: 5_000 },
      );
      const appInstalled =
        installed.ok && installed.stdout.trim().startsWith('package:');
      const [running, activity] = appInstalled
        ? await Promise.all([
            runCommand(
              adbPath,
              ['-s', device.serial, 'shell', 'pidof', ANDROID_PACKAGE],
              { timeoutMs: 5_000 },
            ),
            runCommand(
              adbPath,
              [
                '-s',
                device.serial,
                'shell',
                'cmd',
                'package',
                'resolve-activity',
                '--brief',
                ANDROID_PACKAGE,
              ],
              { timeoutMs: 5_000 },
            ),
          ])
        : [undefined, undefined];
      const launchActivity = activity?.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.startsWith(`${ANDROID_PACKAGE}/`));
      return {
        ...device,
        appInstalled,
        appRunning: Boolean(running?.ok && running.stdout.trim()),
        ...(launchActivity ? { launchActivity } : {}),
      };
    }),
  );
  const selection = selectAndroidDevice(devices, config.androidSerial);
  diagnostics.push(...selection.diagnostics);

  return {
    adbPath,
    devices,
    ...(selection.selected ? { selected: selection.selected } : {}),
    diagnostics,
  };
}

export function selectAndroidDevice(
  devices: AndroidDevice[],
  configuredSerial?: string,
): { selected?: AndroidDevice; diagnostics: Diagnostic[] } {
  const online = devices.filter((device) => device.state === 'device');
  if (configuredSerial) {
    const configured = devices.find(
      (device) => device.serial === configuredSerial,
    );
    if (!configured) {
      return {
        diagnostics: [
          {
            code: 'ANDROID_DEVICE_NOT_FOUND',
            status: 'warning',
            message: `Configured Android device ${configuredSerial} is not visible to ADB.`,
            recovery:
              'Start that device or update MOBILE_AGENT_ANDROID_SERIAL using a serial from mobile_list_devices.',
          },
        ],
      };
    }
    if (configured.state !== 'device') {
      return {
        diagnostics: [
          {
            code: 'ANDROID_DEVICE_NOT_ONLINE',
            status: 'warning',
            message: `Configured Android device ${configuredSerial} is ${configured.state}, not online.`,
            recovery:
              'Wait for the device to become online and rerun mobile_doctor.',
          },
        ],
      };
    }
    return {
      selected: configured,
      diagnostics: [androidReadyDiagnostic(configured, true)],
    };
  }

  if (online.length === 0) {
    return {
      diagnostics: [
        {
          code: 'NO_ANDROID_DEVICE',
          status: 'warning',
          message:
            'No online Android emulator or device is currently visible to ADB.',
          recovery:
            'Start one Android emulator from Radon before beginning the Android phase.',
        },
      ],
    };
  }
  if (online.length > 1) {
    return {
      diagnostics: [
        {
          code: 'MULTIPLE_ANDROID_DEVICES',
          status: 'warning',
          message: `Found ${online.length} online Android devices; automatic selection is disabled.`,
          recovery:
            'Set MOBILE_AGENT_ANDROID_SERIAL to one serial reported by mobile_list_devices.',
        },
      ],
    };
  }
  const onlyDevice = online[0]!;
  return {
    selected: onlyDevice,
    diagnostics: [androidReadyDiagnostic(onlyDevice, false)],
  };
}

function androidReadyDiagnostic(
  device: AndroidDevice,
  explicit: boolean,
): Diagnostic {
  const prefix = explicit ? `Selected ${device.serial}` : device.serial;
  return {
    code: explicit ? 'ANDROID_DEVICE_SELECTED' : 'ANDROID_DEVICE_READY',
    status: device.appInstalled ? 'ok' : 'warning',
    message:
      device.appInstalled && device.appRunning
        ? `${prefix} is online with ${ANDROID_PACKAGE} installed and running.`
        : device.appInstalled
          ? `${prefix} is online with ${ANDROID_PACKAGE} installed but not running.`
          : `${prefix} is online, but ${ANDROID_PACKAGE} is not installed.`,
  };
}

export function parseAdbDevices(
  output: string,
): Omit<AndroidDevice, 'appInstalled' | 'appRunning' | 'launchActivity'>[] {
  return output
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [serial = '', state = 'unknown', ...details] = line.split(/\s+/);
      return {
        serial,
        state,
        description: details.join(' '),
      };
    });
}

export function androidSdkRootFromAdbPath(
  adbPath: string | undefined,
): string | undefined {
  if (!adbPath || !isAbsolute(adbPath)) return undefined;
  const platformTools = dirname(adbPath);
  if (basename(platformTools) !== 'platform-tools') return undefined;
  return dirname(platformTools);
}

async function resolveAdbPath(
  env: NodeJS.ProcessEnv,
): Promise<string | undefined> {
  const executable = process.platform === 'win32' ? 'adb.exe' : 'adb';
  const sdkRoots = [env.ANDROID_HOME, env.ANDROID_SDK_ROOT].filter(
    (value): value is string => Boolean(value),
  );
  for (const root of sdkRoots) {
    const candidate = join(root, 'platform-tools', executable);
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  for (const pathEntry of (env.PATH ?? '').split(delimiter)) {
    const candidate = join(pathEntry, executable);
    if (pathEntry && existsSync(candidate)) {
      return candidate;
    }
  }

  const direct = await runCommand(executable, ['version'], {
    timeoutMs: 5_000,
  });
  return direct.ok ? executable : undefined;
}
