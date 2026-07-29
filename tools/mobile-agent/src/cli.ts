#!/usr/bin/env node

import { performDetachedAction, type MobileActionIdentity } from './actions.js';
import { pruneActionTraces } from './artifacts.js';
import { capabilitiesFor } from './capabilities.js';
import { ANDROID_PACKAGE, IOS_BUNDLE_ID, loadConfig } from './config.js';
import { runDoctor } from './doctor.js';
import { formatDoctor } from './format.js';
import { ObservabilityCollector } from './observability.js';
import { runAndroidSmoke } from './smoke/android.js';
import { runIosSmoke } from './smoke/ios.js';
import { runObservabilitySmoke } from './smoke/observability.js';
import { runProductionBridgeSmoke } from './smoke/production.js';
import type { MobilePlatform } from './types.js';
import { ensureSimulatorWda, expectedWdaAppPath, hasPreparedWda } from './wda.js';

async function main(args = process.argv.slice(2)): Promise<number> {
  const command = args[0] ?? 'help';
  const json = args.includes('--json');
  const config = loadConfig();

  if (command === 'doctor') {
    const report = await runDoctor(config);
    process.stdout.write(`${json ? JSON.stringify(report, null, 2) : formatDoctor(report)}\n`);
    return report.ok ? 0 : 1;
  }

  if (command === 'devices') {
    const report = await runDoctor(config);
    const devices = { ios: report.ios, android: report.android };
    process.stdout.write(`${JSON.stringify(devices, null, 2)}\n`);
    return 0;
  }

  if (command === 'capabilities') {
    const platform = readPlatform(args);
    const report = await runDoctor(config);
    if (platform === 'ios' && !hasPreparedWda(config)) {
      throw new Error('Run mobile-agent prepare-ios before requesting iOS capabilities.');
    }
    process.stdout.write(
      `${JSON.stringify(
        capabilitiesFor(
          report,
          platform,
          platform === 'ios' ? { prebuiltWdaPath: expectedWdaAppPath(config) } : {},
        ),
        null,
        2,
      )}\n`,
    );
    return 0;
  }

  if (command === 'prepare-ios') {
    process.stdout.write(`${JSON.stringify(await ensureSimulatorWda(config), null, 2)}\n`);
    return 0;
  }

  if (command === 'reload') {
    const report = await runDoctor(config);
    const platform =
      readOptionalPlatform(args) ??
      (report.readyPlatforms.length === 1 ? report.readyPlatforms[0] : undefined);
    if (!platform) {
      throw new Error(
        'Reload target is ambiguous. Pass --platform ios or --platform android.',
      );
    }
    const identity = reloadIdentity(report, platform);
    const observability = new ObservabilityCollector(config);
    try {
      const target = { runtime: 'hermes' };
      process.stdout.write(
        `${JSON.stringify(
          await performDetachedAction({
            identity,
            action: 'reload',
            target,
            operation: async () => {
              const result = await observability.reloadApplication();
              return {
                targetId: result.targetId,
                reconnecting: result.reconnecting,
                method: 'hermes-cdp',
              };
            },
          }),
          null,
          2,
        )}\n`,
      );
      return 0;
    } finally {
      await observability.stop();
    }
  }

  if (command === 'smoke-ios') {
    const report = await runIosSmoke(config);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return report.ok && report.sessionDeleted ? 0 : 1;
  }

  if (command === 'smoke-android') {
    const report = await runAndroidSmoke(config);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return report.ok && report.sessionDeleted ? 0 : 1;
  }

  if (command === 'smoke-observability') {
    const platform = readOptionalPlatform(args);
    const targetId = readOption(args, '--target-id');
    const report = await runObservabilitySmoke(config, {
      ...(platform ? { platform } : {}),
      ...(targetId ? { targetId } : {}),
    });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return report.ok ? 0 : 1;
  }

  if (command === 'smoke-production') {
    const report = await runProductionBridgeSmoke(config);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return report.ok ? 0 : 1;
  }

  if (command === 'prune-artifacts') {
    const confirmed = args.includes('--confirm');
    const report = await pruneActionTraces(config, { dryRun: !confirmed });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return 0;
  }

  process.stdout.write(
    [
      'Usage: mobile-agent <command> [options]',
      '',
      'Commands:',
      '  doctor [--json]                    Validate local mobile automation prerequisites',
      '  devices                            List discovered iOS and Android devices',
      '  capabilities --platform ios|android',
      '  prepare-ios                        Download/cache verified simulator WebDriverAgent',
      '  reload [--platform ios|android]    Reload Wave JavaScript through Hermes CDP',
      '  smoke-observability [--platform ios|android] [--target-id id]',
      '  smoke-android                      Run the non-destructive Radon Android Appium smoke',
      '  smoke-ios                          Run the non-destructive Radon iOS Appium spike',
      '  smoke-production                   Verify state bridge exclusion in production',
      '  prune-artifacts [--confirm]        Preview/apply action-trace retention',
      '',
      'Environment:',
      '  MOBILE_AGENT_IOS_DEVICE_SET        Override Radon CoreSimulator device-set path',
      '  MOBILE_AGENT_IOS_UDID              Select one booted Radon iOS simulator by UDID',
      '  MOBILE_AGENT_ANDROID_SERIAL        Select one online Android device by ADB serial',
      '  MOBILE_AGENT_METRO_URL             Override Metro base URL',
      '  MOBILE_AGENT_OBSERVABILITY_TARGET_ID Select one Wave Hermes target by ID',
      '  MOBILE_AGENT_ARTIFACTS_DIR         Override ignored artifact directory',
      '  MOBILE_AGENT_TRACE_MAX_COUNT       Retain at most this many action traces (default 50)',
      '  MOBILE_AGENT_TRACE_MAX_AGE_DAYS    Retain traces for this many days (default 7)',
    ].join('\n') + '\n',
  );
  return command === 'help' || command === '--help' || command === '-h' ? 0 : 2;
}

function reloadIdentity(
  report: Awaited<ReturnType<typeof runDoctor>>,
  platform: MobilePlatform,
): MobileActionIdentity {
  if (!report.readyPlatforms.includes(platform)) {
    throw new Error(
      `${platform} is not ready. Run mobile-agent doctor and resolve its diagnostics.`,
    );
  }
  const deviceId =
    platform === 'ios' ? report.ios.selected?.udid : report.android.selected?.serial;
  if (!deviceId) throw new Error(`No selected ${platform} device is available.`);
  return {
    platform,
    deviceId,
    applicationId: platform === 'ios' ? IOS_BUNDLE_ID : ANDROID_PACKAGE,
  };
}

function readPlatform(args: string[]): MobilePlatform {
  const index = args.indexOf('--platform');
  const platform = index >= 0 ? args[index + 1] : undefined;
  if (platform !== 'ios' && platform !== 'android') {
    throw new Error('--platform must be ios or android');
  }
  return platform;
}

function readOptionalPlatform(args: string[]): MobilePlatform | undefined {
  const value = readOption(args, '--platform');
  if (value === undefined) return undefined;
  if (value !== 'ios' && value !== 'android') {
    throw new Error('--platform must be ios or android');
  }
  return value;
}

function readOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : undefined;
  if (index >= 0 && !value) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

try {
  process.exitCode = await main();
} catch (error: unknown) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
