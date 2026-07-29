import type { MobileAgentConfig } from './config.js';
import { discoverAndroid } from './discovery/android.js';
import { discoverIos } from './discovery/ios.js';
import { redactText } from './observability.js';
import { runCommand } from './process.js';
import type { MobilePlatform } from './types.js';

export interface NativeLogEntry {
  timestamp?: string;
  platform: MobilePlatform;
  source: 'native';
  severity: string;
  process?: string;
  subsystem?: string;
  category?: string;
  tag?: string;
  message: string;
}

export async function readNativeLogs(
  config: MobileAgentConfig,
  platform: MobilePlatform,
  options: { sinceSeconds: number; limit: number },
): Promise<{
  platform: MobilePlatform;
  deviceId: string;
  processId: number;
  entries: NativeLogEntry[];
  truncated: boolean;
}> {
  return platform === 'ios'
    ? await readIosLogs(config, options)
    : await readAndroidLogs(config, options);
}

async function readIosLogs(
  config: MobileAgentConfig,
  options: { sinceSeconds: number; limit: number },
): Promise<{
  platform: 'ios';
  deviceId: string;
  processId: number;
  entries: NativeLogEntry[];
  truncated: boolean;
}> {
  const discovery = await discoverIos(config);
  const device = discovery.selected;
  if (!device) throw new Error('No unique booted Radon iOS simulator is available.');
  const processId = await findIosProcessId(config, device.udid);
  const result = await runCommand(
    'xcrun',
    [
      'simctl',
      '--set',
      config.iosDeviceSetPath,
      'spawn',
      device.udid,
      'log',
      'show',
      '--style',
      'ndjson',
      '--last',
      `${options.sinceSeconds}s`,
      '--predicate',
      `processID == ${processId}`,
    ],
    { timeoutMs: 20_000, maxBuffer: 20 * 1024 * 1024 },
  );
  if (!result.ok) {
    throw new Error(result.stderr.trim() || result.error || 'Could not read iOS native logs.');
  }
  const allEntries = parseIosLogNdjson(result.stdout);
  return {
    platform: 'ios',
    deviceId: device.udid,
    processId,
    entries: allEntries.slice(-options.limit),
    truncated: allEntries.length > options.limit,
  };
}

async function findIosProcessId(config: MobileAgentConfig, udid: string): Promise<number> {
  const found = await runCommand('ps', ['-axo', 'pid=,command='], { timeoutMs: 5_000 });
  if (!found.ok) {
    throw new Error(found.stderr.trim() || found.error || 'Could not inspect iOS processes.');
  }
  const pids = findIosProcessIds(found.stdout, config.iosDeviceSetPath, udid);
  if (pids.length !== 1 || pids[0] === undefined) {
    throw new Error(
      `Expected one running Wave process on Radon simulator ${udid}, found ${pids.length}. Launch Wave and try again.`,
    );
  }
  return pids[0];
}

export function findIosProcessIds(
  processList: string,
  deviceSetPath: string,
  udid: string,
): number[] {
  const processPrefix = `${deviceSetPath}/${udid}/`;
  const executableMarker = '/wave.app/wave';
  const processIds: number[] = [];

  for (const line of processList.split(/\r?\n/)) {
    const match = line.match(/^\s*(\d+)\s+(.+)$/);
    if (!match) continue;
    const [, rawProcessId, command] = match;
    if (!rawProcessId || !command?.startsWith(processPrefix)) continue;
    const executableIndex = command.indexOf(executableMarker);
    if (executableIndex < 0) continue;
    const executableEnd = executableIndex + executableMarker.length;
    if (command.length > executableEnd && !/\s/.test(command[executableEnd] ?? '')) continue;
    const processId = Number.parseInt(rawProcessId, 10);
    if (Number.isInteger(processId) && processId > 0) processIds.push(processId);
  }

  return processIds;
}

async function readAndroidLogs(
  config: MobileAgentConfig,
  options: { sinceSeconds: number; limit: number },
): Promise<{
  platform: 'android';
  deviceId: string;
  processId: number;
  entries: NativeLogEntry[];
  truncated: boolean;
}> {
  const discovery = await discoverAndroid(config);
  const device = discovery.selected;
  if (!discovery.adbPath || !device) {
    throw new Error('No unique online Android device is available.');
  }
  const pidResult = await runCommand(
    discovery.adbPath,
    ['-s', device.serial, 'shell', 'pidof', 'com.renanqueiroz.wave'],
    { timeoutMs: 5_000 },
  );
  const processId = Number.parseInt(pidResult.stdout.trim().split(/\s+/)[0] ?? '', 10);
  if (!pidResult.ok || !Number.isInteger(processId) || processId <= 0) {
    throw new Error(
      `com.renanqueiroz.wave is not running on Android device ${device.serial}. Launch Wave and try again.`,
    );
  }
  const lineLimit = Math.min(Math.max(options.limit * 4, 200), 4_000);
  const result = await runCommand(
    discovery.adbPath,
    [
      '-s',
      device.serial,
      'logcat',
      '-d',
      '--pid',
      String(processId),
      '-v',
      'epoch',
      '-t',
      String(lineLimit),
    ],
    { timeoutMs: 15_000, maxBuffer: 20 * 1024 * 1024 },
  );
  if (!result.ok) {
    throw new Error(result.stderr.trim() || result.error || 'Could not read Android native logs.');
  }
  const cutoff = Date.now() - options.sinceSeconds * 1_000;
  const allEntries = parseAndroidLogcat(result.stdout).filter((entry) => {
    if (!entry.timestamp) return true;
    const timestamp = Date.parse(entry.timestamp);
    return Number.isNaN(timestamp) || timestamp >= cutoff;
  });
  return {
    platform: 'android',
    deviceId: device.serial,
    processId,
    entries: allEntries.slice(-options.limit),
    truncated: allEntries.length > options.limit,
  };
}

export function parseIosLogNdjson(value: string): NativeLogEntry[] {
  const entries: NativeLogEntry[] = [];
  for (const line of value.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (raw.eventType !== 'logEvent' || typeof raw.eventMessage !== 'string') continue;
    const process =
      typeof raw.processImagePath === 'string'
        ? raw.processImagePath.split('/').at(-1)
        : undefined;
    entries.push({
      ...(typeof raw.timestamp === 'string' ? { timestamp: normalizeIosTimestamp(raw.timestamp) } : {}),
      platform: 'ios',
      source: 'native',
      severity: typeof raw.messageType === 'string' ? raw.messageType.toLocaleLowerCase() : 'default',
      ...(process ? { process } : {}),
      ...(typeof raw.subsystem === 'string' && raw.subsystem ? { subsystem: raw.subsystem } : {}),
      ...(typeof raw.category === 'string' && raw.category ? { category: raw.category } : {}),
      message: redactText(raw.eventMessage),
    });
  }
  return entries;
}

export function parseAndroidLogcat(value: string): NativeLogEntry[] {
  const entries: NativeLogEntry[] = [];
  const pattern =
    /^\s*(\d+\.\d+)\s+\d+\s+\d+\s+\d+\s+([VDIWEAF])\s+([^:]+):\s?(.*)$/;
  for (const line of value.split(/\r?\n/)) {
    const match = line.match(pattern);
    if (!match) continue;
    const [, epoch, priority, tag, message] = match;
    if (!epoch || !priority || !tag || message === undefined) continue;
    entries.push({
      timestamp: new Date(Number(epoch) * 1_000).toISOString(),
      platform: 'android',
      source: 'native',
      severity: androidSeverity(priority),
      tag: tag.trim(),
      message: redactText(message),
    });
  }
  return entries;
}

function normalizeIosTimestamp(value: string): string {
  const normalized = value.replace(/(\.\d{3})\d*([+-]\d{2})(\d{2})$/, '$1$2:$3');
  const timestamp = new Date(normalized);
  return Number.isNaN(timestamp.valueOf()) ? value : timestamp.toISOString();
}

function androidSeverity(priority: string): string {
  return (
    {
      V: 'verbose',
      D: 'debug',
      I: 'info',
      W: 'warning',
      E: 'error',
      A: 'assert',
      F: 'fatal',
    }[priority] ?? 'default'
  );
}
