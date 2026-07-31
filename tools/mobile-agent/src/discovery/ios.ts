import { existsSync } from 'node:fs';

import { IOS_BUNDLE_ID, type MobileAgentConfig } from '../config.js';
import { runCommand } from '../process.js';
import type { Diagnostic, IosDiscovery, IosSimulator } from '../types.js';

interface SimctlDevice {
  name?: string;
  udid?: string;
  state?: string;
  isAvailable?: boolean;
  availabilityError?: string;
}

interface SimctlDeviceList {
  devices?: Record<string, SimctlDevice[]>;
}

export async function discoverIos(
  config: MobileAgentConfig,
): Promise<IosDiscovery> {
  const diagnostics: Diagnostic[] = [];
  const deviceSetExists = existsSync(config.iosDeviceSetPath);

  if (process.platform !== 'darwin') {
    diagnostics.push({
      code: 'IOS_UNSUPPORTED_HOST',
      status: 'warning',
      message: 'iOS Simulator automation requires macOS.',
    });
    return {
      supported: false,
      deviceSetPath: config.iosDeviceSetPath,
      deviceSetExists,
      simulators: [],
      diagnostics,
    };
  }

  if (!deviceSetExists) {
    diagnostics.push({
      code: 'NO_RADON_DEVICE_SET',
      status: 'error',
      message: `Radon's iOS device set was not found at ${config.iosDeviceSetPath}.`,
      recovery:
        'Start an iOS simulator from Radon, or set MOBILE_AGENT_IOS_DEVICE_SET to its CoreSimulator device-set path.',
    });
    return {
      supported: true,
      deviceSetPath: config.iosDeviceSetPath,
      deviceSetExists,
      simulators: [],
      diagnostics,
    };
  }

  const listed = await runCommand(
    'xcrun',
    ['simctl', '--set', config.iosDeviceSetPath, 'list', 'devices', '--json'],
    { timeoutMs: 15_000 },
  );
  if (!listed.ok) {
    diagnostics.push({
      code: 'SIMCTL_LIST_FAILED',
      status: 'error',
      message:
        listed.stderr.trim() ||
        listed.error ||
        'Unable to list Radon simulators.',
      recovery:
        'Confirm Xcode command-line tools are selected and Radon can launch its iOS simulator.',
    });
    return {
      supported: true,
      deviceSetPath: config.iosDeviceSetPath,
      deviceSetExists,
      simulators: [],
      diagnostics,
    };
  }

  let parsed: SimctlDeviceList;
  try {
    parsed = JSON.parse(listed.stdout) as SimctlDeviceList;
  } catch (error: unknown) {
    diagnostics.push({
      code: 'SIMCTL_INVALID_JSON',
      status: 'error',
      message: `simctl returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    });
    return {
      supported: true,
      deviceSetPath: config.iosDeviceSetPath,
      deviceSetExists,
      simulators: [],
      diagnostics,
    };
  }

  const simulators = await flattenSimulators(parsed, config.iosDeviceSetPath);
  const selection = selectIosSimulator(simulators, config.iosUdid);
  diagnostics.push(...selection.diagnostics);

  return {
    supported: true,
    deviceSetPath: config.iosDeviceSetPath,
    deviceSetExists,
    simulators,
    ...(selection.selected ? { selected: selection.selected } : {}),
    diagnostics,
  };
}

export function selectIosSimulator(
  simulators: IosSimulator[],
  configuredUdid?: string,
): { selected?: IosSimulator; diagnostics: Diagnostic[] } {
  const booted = simulators.filter(
    (device) => device.state === 'Booted' && device.available,
  );
  if (configuredUdid) {
    const configured = simulators.find(
      (device) => device.udid === configuredUdid,
    );
    if (!configured) {
      return {
        diagnostics: [
          {
            code: 'IOS_DEVICE_NOT_FOUND',
            status: 'error',
            message: `Configured iOS simulator ${configuredUdid} is not in Radon’s device set.`,
            recovery:
              'Start that simulator or update MOBILE_AGENT_IOS_UDID using a UDID from mobile_list_devices.',
          },
        ],
      };
    }
    if (configured.state !== 'Booted' || !configured.available) {
      return {
        diagnostics: [
          {
            code: 'IOS_DEVICE_NOT_BOOTED',
            status: 'error',
            message: `Configured iOS simulator ${configured.name} (${configuredUdid}) is ${configured.state}.`,
            recovery: 'Boot that simulator from Radon and rerun mobile_doctor.',
          },
        ],
      };
    }
    return {
      selected: configured,
      diagnostics: [iosReadyDiagnostic(configured, true)],
    };
  }

  if (booted.length === 0) {
    return {
      diagnostics: [
        {
          code: 'NO_BOOTED_IOS_DEVICE',
          status: 'error',
          message: 'No booted simulator was found in Radon’s iOS device set.',
          recovery:
            'Start the Wave iOS development build from Radon and rerun the doctor.',
        },
      ],
    };
  }
  if (booted.length > 1) {
    return {
      diagnostics: [
        {
          code: 'MULTIPLE_BOOTED_IOS_DEVICES',
          status: 'error',
          message: `Found ${booted.length} booted Radon iOS simulators; automatic selection is disabled.`,
          recovery:
            'Set MOBILE_AGENT_IOS_UDID to one UDID reported by mobile_list_devices.',
        },
      ],
    };
  }
  const onlyDevice = booted[0]!;
  return {
    selected: onlyDevice,
    diagnostics: [iosReadyDiagnostic(onlyDevice, false)],
  };
}

function iosReadyDiagnostic(
  device: IosSimulator,
  explicit: boolean,
): Diagnostic {
  const selected = explicit ? 'Selected ' : '';
  return {
    code: explicit ? 'IOS_DEVICE_SELECTED' : 'IOS_DEVICE_READY',
    status: device.appInstalled ? 'ok' : 'error',
    message: device.appInstalled
      ? `${selected}${device.name} (${device.udid}) is booted with ${IOS_BUNDLE_ID} installed.`
      : `${selected}${device.name} (${device.udid}) is booted, but ${IOS_BUNDLE_ID} is not installed.`,
    ...(!device.appInstalled
      ? {
          recovery:
            'Build and launch Wave from Radon before creating an Appium session.',
        }
      : {}),
  };
}

async function flattenSimulators(
  list: SimctlDeviceList,
  deviceSetPath: string,
): Promise<IosSimulator[]> {
  const entries = Object.entries(list.devices ?? {}).flatMap(
    ([runtimeIdentifier, devices]) =>
      devices.map((device) => ({ runtimeIdentifier, device })),
  );

  return Promise.all(
    entries.map(
      async ({ runtimeIdentifier, device }): Promise<IosSimulator> => {
        const udid = device.udid ?? '';
        const app = udid
          ? await runCommand(
              'xcrun',
              [
                'simctl',
                '--set',
                deviceSetPath,
                'get_app_container',
                udid,
                IOS_BUNDLE_ID,
                'app',
              ],
              { timeoutMs: 5_000 },
            )
          : { ok: false, stdout: '', stderr: '', exitCode: null };
        const appContainerPath = app.ok ? app.stdout.trim() : undefined;

        return {
          name: device.name ?? 'Unknown iOS Simulator',
          udid,
          state: device.state ?? 'Unknown',
          runtime: runtimeDisplayName(runtimeIdentifier),
          runtimeIdentifier,
          available: device.isAvailable !== false && !device.availabilityError,
          appInstalled: Boolean(appContainerPath),
          ...(appContainerPath ? { appContainerPath } : {}),
        };
      },
    ),
  );
}

function runtimeDisplayName(identifier: string): string {
  const suffix = identifier.split('.').at(-1) ?? identifier;
  return suffix.replace(/^iOS-/, 'iOS ').replaceAll('-', '.');
}
