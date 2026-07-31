import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { pruneActionTraces } from './artifacts.js';
import type { MobileAgentConfig } from './config.js';
import { captureNativeScreenshot, type ResolvedDriver } from './driver.js';
import type { HierarchySnapshot } from './hierarchy.js';

export interface ActionTraceContext {
  id: string;
  directory: string;
  action: string;
  platform: ResolvedDriver['platform'];
  deviceId: string;
  applicationId: string;
  sessionId: string;
  target: Record<string, unknown>;
  startedAt: string;
  beforeSnapshotId: string;
  beforeScreenshotPath?: string;
  warnings: string[];
}

export interface ActionTraceResult {
  id: string;
  directory: string;
  action: string;
  platform: ResolvedDriver['platform'];
  deviceId: string;
  applicationId: string;
  sessionId: string;
  target: Record<string, unknown>;
  startedAt: string;
  completedAt: string;
  before: {
    snapshotId: string;
    screenshotPath?: string;
  };
  after: {
    snapshotId?: string;
    screenshotPath?: string;
  };
  warnings: string[];
}

export async function beginActionTrace(
  config: MobileAgentConfig,
  resolved: ResolvedDriver,
  snapshot: HierarchySnapshot,
  metadata: {
    action: string;
    target: Record<string, unknown>;
  },
): Promise<ActionTraceContext> {
  const id = `${Date.now()}-${randomUUID()}`;
  const directory = join(config.artifactsDir, 'traces', id);
  const warnings: string[] = [];
  await mkdir(directory, { recursive: true });
  await writeJson(join(directory, 'before-hierarchy.json'), snapshot);
  const beforeScreenshotPath = await saveScreenshot(
    resolved,
    join(directory, 'before.png'),
    warnings,
  );
  return {
    id,
    directory,
    action: metadata.action,
    platform: resolved.platform,
    deviceId: resolved.deviceId,
    applicationId: resolved.applicationId,
    sessionId: resolved.sessionId,
    target: metadata.target,
    startedAt: new Date().toISOString(),
    beforeSnapshotId: snapshot.id,
    ...(beforeScreenshotPath ? { beforeScreenshotPath } : {}),
    warnings,
  };
}

export async function completeActionTrace(
  config: MobileAgentConfig,
  resolved: ResolvedDriver,
  context: ActionTraceContext,
  afterSnapshot?: HierarchySnapshot,
): Promise<ActionTraceResult> {
  if (afterSnapshot) {
    await writeJson(
      join(context.directory, 'after-hierarchy.json'),
      afterSnapshot,
    );
  }
  const afterScreenshotPath = await saveScreenshot(
    resolved,
    join(context.directory, 'after.png'),
    context.warnings,
  );
  const result: ActionTraceResult = {
    id: context.id,
    directory: context.directory,
    action: context.action,
    platform: context.platform,
    deviceId: context.deviceId,
    applicationId: context.applicationId,
    sessionId: context.sessionId,
    target: context.target,
    startedAt: context.startedAt,
    completedAt: new Date().toISOString(),
    before: {
      snapshotId: context.beforeSnapshotId,
      ...(context.beforeScreenshotPath
        ? { screenshotPath: context.beforeScreenshotPath }
        : {}),
    },
    after: {
      ...(afterSnapshot ? { snapshotId: afterSnapshot.id } : {}),
      ...(afterScreenshotPath ? { screenshotPath: afterScreenshotPath } : {}),
    },
    warnings: context.warnings,
  };
  await writeJson(join(context.directory, 'trace.json'), result);
  await pruneActionTraces(config, { dryRun: false });
  return result;
}

async function saveScreenshot(
  resolved: ResolvedDriver,
  path: string,
  warnings: string[],
): Promise<string | undefined> {
  try {
    const base64 = await captureNativeScreenshot(resolved.driver);
    await writeFile(path, Buffer.from(base64, 'base64'));
    return path;
  } catch (error: unknown) {
    warnings.push(error instanceof Error ? error.message : String(error));
    return undefined;
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
