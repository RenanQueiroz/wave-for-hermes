import { beginActionTrace, completeActionTrace, type ActionTraceResult } from './action-trace.js';
import type { MobileAgentConfig } from './config.js';
import type { ResolvedDriver } from './driver.js';
import type { HierarchySnapshot } from './hierarchy.js';
import type { MobilePlatform } from './types.js';

export type MobileActionName =
  | 'activate'
  | 'app_lifecycle'
  | 'background'
  | 'clear_text'
  | 'deep_link'
  | 'drag'
  | 'long_press'
  | 'press_key'
  | 'reload'
  | 'scroll'
  | 'swipe'
  | 'tap'
  | 'terminate'
  | 'type_text';

export interface MobileActionIdentity {
  platform: MobilePlatform;
  deviceId: string;
  applicationId: string;
  sessionId?: string;
}

export interface MobileActionEnvelope {
  ok: true;
  action: MobileActionName;
  platform: MobilePlatform;
  deviceId: string;
  applicationId: string;
  sessionId?: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  target: Record<string, unknown>;
  beforeSnapshotId?: string;
  afterSnapshotId?: string;
  result: Record<string, unknown>;
  trace?: ActionTraceResult;
  warnings: string[];
}

export interface MobileActionErrorEnvelope {
  ok: false;
  action: MobileActionName;
  platform?: MobilePlatform;
  deviceId?: string;
  applicationId?: string;
  sessionId?: string;
  durationMs: number;
  target?: Record<string, unknown>;
  error: {
    code: string;
    message: string;
    recovery?: string;
  };
}

export class MobileAgentError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly recovery?: string,
  ) {
    super(message);
  }
}

export async function performUnifiedAction(options: {
  config: MobileAgentConfig;
  resolved: ResolvedDriver;
  action: MobileActionName;
  target: Record<string, unknown>;
  captureTrace: boolean;
  beforeSnapshot?: HierarchySnapshot;
  captureHierarchy: () => Promise<HierarchySnapshot>;
  invalidateHierarchy: () => void;
  operation: () => Promise<Record<string, unknown> | void>;
  settleMs?: number;
}): Promise<MobileActionEnvelope> {
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const warnings: string[] = [];
  let beforeSnapshot = options.beforeSnapshot;
  let traceContext: Awaited<ReturnType<typeof beginActionTrace>> | undefined;

  if (options.captureTrace && !beforeSnapshot) {
    try {
      beforeSnapshot = await options.captureHierarchy();
    } catch (error: unknown) {
      warnings.push(`Before hierarchy failed: ${errorMessage(error)}`);
    }
  }
  if (options.captureTrace && beforeSnapshot) {
    try {
      traceContext = await beginActionTrace(
        options.config,
        options.resolved,
        beforeSnapshot,
        {
          action: options.action,
          target: options.target,
        },
      );
    } catch (error: unknown) {
      warnings.push(`Action trace could not start: ${errorMessage(error)}`);
    }
  }

  let result: Record<string, unknown>;
  try {
    result = (await options.operation()) ?? {};
  } finally {
    options.invalidateHierarchy();
  }
  let afterSnapshot: HierarchySnapshot | undefined;
  let trace: ActionTraceResult | undefined;
  if (traceContext) {
    await new Promise((resolve) => setTimeout(resolve, options.settleMs ?? 250));
    try {
      afterSnapshot = await options.captureHierarchy();
    } catch (error: unknown) {
      traceContext.warnings.push(`After hierarchy failed: ${errorMessage(error)}`);
    }
    try {
      trace = await completeActionTrace(
        options.config,
        options.resolved,
        traceContext,
        afterSnapshot,
      );
      warnings.push(...trace.warnings);
    } catch (error: unknown) {
      warnings.push(`Action succeeded, but trace completion failed: ${errorMessage(error)}`);
    }
  }

  const completedAtMs = Date.now();
  return {
    ok: true,
    action: options.action,
    platform: options.resolved.platform,
    deviceId: options.resolved.deviceId,
    applicationId: options.resolved.applicationId,
    sessionId: options.resolved.sessionId,
    startedAt,
    completedAt: new Date(completedAtMs).toISOString(),
    durationMs: completedAtMs - startedAtMs,
    target: options.target,
    ...(beforeSnapshot ? { beforeSnapshotId: beforeSnapshot.id } : {}),
    ...(afterSnapshot ? { afterSnapshotId: afterSnapshot.id } : {}),
    result,
    ...(trace ? { trace } : {}),
    warnings,
  };
}

export async function performDetachedAction(options: {
  identity: MobileActionIdentity;
  action: MobileActionName;
  target: Record<string, unknown>;
  operation: () => Promise<Record<string, unknown> | void>;
}): Promise<MobileActionEnvelope> {
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  const result = (await options.operation()) ?? {};
  const completedAtMs = Date.now();
  return {
    ok: true,
    action: options.action,
    platform: options.identity.platform,
    deviceId: options.identity.deviceId,
    applicationId: options.identity.applicationId,
    ...(options.identity.sessionId ? { sessionId: options.identity.sessionId } : {}),
    startedAt,
    completedAt: new Date(completedAtMs).toISOString(),
    durationMs: completedAtMs - startedAtMs,
    target: options.target,
    result,
    warnings: [],
  };
}

export function actionErrorEnvelope(
  action: MobileActionName,
  fallbackCode: string,
  error: unknown,
  startedAtMs: number,
  context: {
    identity?: MobileActionIdentity;
    target?: Record<string, unknown>;
  } = {},
): MobileActionErrorEnvelope {
  const known = error instanceof MobileAgentError;
  return {
    ok: false,
    action,
    ...(context.identity?.platform ? { platform: context.identity.platform } : {}),
    ...(context.identity?.deviceId ? { deviceId: context.identity.deviceId } : {}),
    ...(context.identity?.applicationId
      ? { applicationId: context.identity.applicationId }
      : {}),
    ...(context.identity?.sessionId ? { sessionId: context.identity.sessionId } : {}),
    durationMs: Date.now() - startedAtMs,
    ...(context.target ? { target: context.target } : {}),
    error: {
      code: known ? error.code : fallbackCode,
      message: errorMessage(error),
      ...(known && error.recovery ? { recovery: error.recovery } : {}),
    },
  };
}

export function identityFromDriver(resolved: ResolvedDriver): MobileActionIdentity {
  return {
    platform: resolved.platform,
    deviceId: resolved.deviceId,
    applicationId: resolved.applicationId,
    sessionId: resolved.sessionId,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
