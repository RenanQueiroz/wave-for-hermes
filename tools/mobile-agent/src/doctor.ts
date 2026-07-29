import { createRequire } from 'node:module';

import {
  ANDROID_PACKAGE,
  IOS_BUNDLE_ID,
  PINNED_APPIUM_MCP_VERSION,
  REQUIRED_NODE_MAJOR,
  type MobileAgentConfig,
} from './config.js';
import { discoverAndroid } from './discovery/android.js';
import { discoverIos } from './discovery/ios.js';
import { discoverMetro } from './discovery/metro.js';
import { runCommand } from './process.js';
import type {
  Diagnostic,
  DoctorReport,
  MobilePlatform,
  ToolchainDiscovery,
} from './types.js';

export async function runDoctor(config: MobileAgentConfig): Promise<DoctorReport> {
  const [toolchain, ios, android, metro] = await Promise.all([
    discoverToolchain(),
    discoverIos(config),
    discoverAndroid(config),
    discoverMetro(config),
  ]);
  const commonDiagnostics = toolchain.diagnostics.filter(
    (diagnostic) => !diagnostic.code.startsWith('XCODE_'),
  );
  const commonReady = !commonDiagnostics.some((diagnostic) => diagnostic.status === 'error');
  const metroReady = Boolean(
    metro.selected?.targets.some((target) => target.appId === ANDROID_PACKAGE),
  );
  const xcodeReady = !toolchain.diagnostics.some(
    (diagnostic) =>
      diagnostic.code.startsWith('XCODE_') && diagnostic.status === 'error',
  );
  const readyPlatforms: MobilePlatform[] = [];
  if (commonReady && metroReady && xcodeReady && ios.selected?.appInstalled) {
    readyPlatforms.push('ios');
  }
  if (
    commonReady &&
    metroReady &&
    android.selected?.appInstalled &&
    android.selected.appRunning
  ) {
    readyPlatforms.push('android');
  }

  return {
    ok: readyPlatforms.length > 0,
    readyPlatforms,
    generatedAt: new Date().toISOString(),
    projectRoot: config.projectRoot,
    bundleId: IOS_BUNDLE_ID,
    androidPackage: ANDROID_PACKAGE,
    toolchain,
    ios,
    android,
    metro,
  };
}

async function discoverToolchain(): Promise<ToolchainDiscovery> {
  const diagnostics: Diagnostic[] = [];
  const nodeVersion = process.versions.node;
  const nodeMajor = Number.parseInt(nodeVersion.split('.')[0] ?? '0', 10);
  const nodeSupported = nodeMajor >= REQUIRED_NODE_MAJOR;

  diagnostics.push({
    code: 'NODE_VERSION',
    status: nodeSupported ? 'ok' : 'error',
    message: nodeSupported
      ? `Node.js ${nodeVersion} satisfies the Node.js ${REQUIRED_NODE_MAJOR}+ requirement.`
      : `Node.js ${nodeVersion} is too old; Node.js ${REQUIRED_NODE_MAJOR}+ is required.`,
  });

  let appiumMcpVersion: string | undefined;
  try {
    const require = createRequire(import.meta.url);
    const appiumPackage = require('appium-mcp/package.json') as { version?: string };
    appiumMcpVersion = appiumPackage.version;
    diagnostics.push({
      code: 'APPIUM_MCP_VERSION',
      status: appiumMcpVersion === PINNED_APPIUM_MCP_VERSION ? 'ok' : 'error',
      message:
        appiumMcpVersion === PINNED_APPIUM_MCP_VERSION
          ? `appium-mcp ${appiumMcpVersion} is installed and pinned.`
          : `Expected appium-mcp ${PINNED_APPIUM_MCP_VERSION}, found ${appiumMcpVersion ?? 'unknown'}.`,
      ...(appiumMcpVersion !== PINNED_APPIUM_MCP_VERSION
        ? { recovery: 'Run npm install from tools/mobile-agent.' }
        : {}),
    });
  } catch (error: unknown) {
    diagnostics.push({
      code: 'APPIUM_MCP_NOT_INSTALLED',
      status: 'error',
      message: error instanceof Error ? error.message : String(error),
      recovery: 'Run npm install from tools/mobile-agent.',
    });
  }

  let xcodeVersion: string | undefined;
  if (process.platform === 'darwin') {
    const xcode = await runCommand('xcodebuild', ['-version'], { timeoutMs: 10_000 });
    if (xcode.ok) {
      xcodeVersion = xcode.stdout.trim().replace(/\r?\n/g, ' / ');
      diagnostics.push({
        code: 'XCODE_VERSION',
        status: 'ok',
        message: xcodeVersion,
      });
    } else {
      diagnostics.push({
        code: 'XCODE_NOT_READY',
        status: 'error',
        message: xcode.stderr.trim() || xcode.error || 'xcodebuild is unavailable.',
        recovery: 'Install/select Xcode and accept its license before running iOS automation.',
      });
    }
  }

  return {
    nodeVersion,
    nodeSupported,
    ...(xcodeVersion ? { xcodeVersion } : {}),
    ...(appiumMcpVersion ? { appiumMcpVersion } : {}),
    diagnostics,
  };
}
