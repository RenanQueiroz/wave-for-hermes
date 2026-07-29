import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, parse, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const IOS_BUNDLE_ID = 'com.renanqueiroz.wave';
export const ANDROID_PACKAGE = 'com.renanqueiroz.wave';
export const REQUIRED_NODE_MAJOR = 22;
export const PINNED_APPIUM_MCP_VERSION = '1.90.0';
export const DEFAULT_TRACE_MAX_COUNT = 50;
export const DEFAULT_TRACE_MAX_AGE_DAYS = 7;

export interface MobileAgentConfig {
  projectRoot: string;
  artifactsDir: string;
  iosDeviceSetPath: string;
  iosUdid?: string;
  androidSerial?: string;
  traceMaxCount: number;
  traceMaxAgeDays: number;
  metroUrl?: string;
  observabilityTargetId?: string;
}

export function loadConfig(cwd = process.cwd(), env = process.env): MobileAgentConfig {
  const projectRoot = env.MOBILE_AGENT_PROJECT_ROOT
    ? resolve(env.MOBILE_AGENT_PROJECT_ROOT)
    : findProjectRoot(cwd);
  const configuredArtifacts = env.MOBILE_AGENT_ARTIFACTS_DIR || join(projectRoot, '.mobile-agent');
  const configuredDeviceSet =
    env.MOBILE_AGENT_IOS_DEVICE_SET ||
    join(homedir(), 'Library', 'Caches', 'com.swmansion.radon-ide', 'Devices', 'iOS');

  return {
    projectRoot,
    artifactsDir: resolveFrom(projectRoot, configuredArtifacts),
    iosDeviceSetPath: resolveFrom(projectRoot, configuredDeviceSet),
    ...(env.MOBILE_AGENT_IOS_UDID ? { iosUdid: env.MOBILE_AGENT_IOS_UDID } : {}),
    ...(env.MOBILE_AGENT_ANDROID_SERIAL
      ? { androidSerial: env.MOBILE_AGENT_ANDROID_SERIAL }
      : {}),
    traceMaxCount: readPositiveInteger(
      env.MOBILE_AGENT_TRACE_MAX_COUNT,
      DEFAULT_TRACE_MAX_COUNT,
      'MOBILE_AGENT_TRACE_MAX_COUNT',
    ),
    traceMaxAgeDays: readPositiveInteger(
      env.MOBILE_AGENT_TRACE_MAX_AGE_DAYS,
      DEFAULT_TRACE_MAX_AGE_DAYS,
      'MOBILE_AGENT_TRACE_MAX_AGE_DAYS',
    ),
    ...(env.MOBILE_AGENT_METRO_URL ? { metroUrl: env.MOBILE_AGENT_METRO_URL } : {}),
    ...(env.MOBILE_AGENT_OBSERVABILITY_TARGET_ID
      ? { observabilityTargetId: env.MOBILE_AGENT_OBSERVABILITY_TARGET_ID }
      : {}),
  };
}

export function currentModuleDirectory(importMetaUrl: string): string {
  return fileURLToPath(new URL('.', importMetaUrl));
}

function resolveFrom(root: string, value: string): string {
  return isAbsolute(value) ? value : resolve(root, value);
}

function findProjectRoot(start: string): string {
  let candidate = resolve(start);
  const filesystemRoot = parse(candidate).root;

  while (candidate !== filesystemRoot) {
    if (existsSync(join(candidate, 'app.json')) && existsSync(join(candidate, '.codex', 'config.toml'))) {
      return candidate;
    }
    candidate = dirname(candidate);
  }

  return resolve(start);
}

function readPositiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}
