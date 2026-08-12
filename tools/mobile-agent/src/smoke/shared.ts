import { ANDROID_PACKAGE, IOS_BUNDLE_ID } from '../config.js';
import type { ToolTextResult } from '../mcp/client.js';
import type { MobilePlatform } from '../types.js';

export const SAFE_CONTROL_ID = 'gateway-sign-in-button';

export interface SmokeReportStep {
  name: string;
  ok: boolean;
  detail: string;
}

export function assertStaleSnapshotRejected(
  result: ToolTextResult,
  platform: MobilePlatform,
  sessionId: string | undefined,
  snapshotId: string,
): void {
  if (!result.isError) {
    throw new Error(
      'Expected the previous hierarchy snapshot to be rejected as stale.',
    );
  }
  const envelope = parseJsonObject(result.text, 'stale snapshot error');
  const error = envelope.error;
  const target = envelope.target;
  if (
    envelope.ok !== false ||
    envelope.action !== 'tap' ||
    envelope.platform !== platform ||
    typeof envelope.deviceId !== 'string' ||
    envelope.applicationId !== applicationIdFor(platform) ||
    (sessionId && envelope.sessionId !== sessionId) ||
    typeof envelope.durationMs !== 'number' ||
    !target ||
    typeof target !== 'object' ||
    Array.isArray(target) ||
    (target as Record<string, unknown>).snapshotId !== snapshotId ||
    !error ||
    typeof error !== 'object' ||
    Array.isArray(error) ||
    (error as Record<string, unknown>).code !== 'STALE_SNAPSHOT'
  ) {
    throw new Error(
      'Expected the stale action error code to be STALE_SNAPSHOT.',
    );
  }
}

export function assertActionEnvelope(
  value: Record<string, unknown>,
  action: string,
  platform: MobilePlatform,
  sessionId: string | undefined,
): void {
  if (value.ok !== true || value.action !== action) {
    throw new Error(
      `Expected a successful "${action}" unified action envelope.`,
    );
  }
  if (value.platform !== platform) {
    throw new Error(
      `Expected the "${action}" action to identify platform ${platform}.`,
    );
  }
  if (
    typeof value.deviceId !== 'string' ||
    value.applicationId !== applicationIdFor(platform) ||
    typeof value.durationMs !== 'number' ||
    !value.target ||
    typeof value.target !== 'object' ||
    Array.isArray(value.target) ||
    !value.result ||
    typeof value.result !== 'object' ||
    Array.isArray(value.result) ||
    !Array.isArray(value.warnings)
  ) {
    throw new Error(
      `The "${action}" result is missing unified action envelope fields.`,
    );
  }
  if (sessionId && value.sessionId !== sessionId) {
    throw new Error(
      `The "${action}" action returned an unexpected session ID.`,
    );
  }
}

export function assertToolSucceeded(
  step: string,
  result: ToolTextResult,
): void {
  if (result.isError) {
    throw new Error(`${step} failed: ${result.text}`);
  }
}

export function readSessionId(text: string): string {
  const sessionId = text.match(/ID:\s*([^\s]+)/)?.[1];
  if (!sessionId) {
    throw new Error(`Could not parse Appium session ID from: ${text}`);
  }
  return sessionId;
}

export function sessionArgs(sessionId: string | undefined): {
  sessionId?: string;
} {
  return sessionId ? { sessionId } : {};
}

export function parseJsonObject(
  text: string,
  label: string,
): Record<string, unknown> {
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`The ${label} response was not a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

export function readString(
  value: Record<string, unknown>,
  key: string,
): string {
  const result = value[key];
  if (typeof result !== 'string' || !result) {
    throw new Error(`Expected ${key} to be a non-empty string.`);
  }
  return result;
}

function applicationIdFor(platform: MobilePlatform): string {
  return platform === 'ios' ? IOS_BUNDLE_ID : ANDROID_PACKAGE;
}
