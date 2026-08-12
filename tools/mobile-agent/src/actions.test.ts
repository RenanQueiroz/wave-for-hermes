import assert from 'node:assert/strict';
import test from 'node:test';

import {
  actionErrorEnvelope,
  MobileAgentError,
  performDetachedAction,
  performUnifiedAction,
} from './actions.js';
import type { MobileAgentConfig } from './config.js';
import type { ResolvedDriver } from './driver.js';
import type { HierarchySnapshot } from './hierarchy.js';

const identity = {
  platform: 'ios' as const,
  deviceId: 'radon-device',
  applicationId: 'com.renanqueiroz.wave.dev',
  sessionId: 'session-1',
};

test('native actions return the shared envelope and preserve snapshot identity', async () => {
  const beforeSnapshot = snapshot('before');
  let invalidated = false;
  const resolved = {
    ...identity,
    driver: {
      getPageSource: async () => '<AppiumAUT />',
      findElement: async () => ({}),
      performActions: async () => undefined,
    },
  } satisfies ResolvedDriver;

  const result = await performUnifiedAction({
    config: config(),
    resolved,
    action: 'tap',
    target: {
      snapshotId: beforeSnapshot.id,
      nodeId: 'node-1',
      method: 'native-element',
    },
    captureTrace: false,
    beforeSnapshot,
    captureHierarchy: async () => {
      throw new Error(
        'captureHierarchy must not run when trace capture is disabled',
      );
    },
    invalidateHierarchy: () => {
      invalidated = true;
    },
    operation: async () => ({ method: 'native-element' }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.action, 'tap');
  assert.equal(result.platform, 'ios');
  assert.equal(result.deviceId, identity.deviceId);
  assert.equal(result.applicationId, identity.applicationId);
  assert.equal(result.sessionId, identity.sessionId);
  assert.equal(result.beforeSnapshotId, beforeSnapshot.id);
  assert.deepEqual(result.result, { method: 'native-element' });
  assert.deepEqual(result.warnings, []);
  assert.equal(invalidated, true);
  assert.ok(result.completedAt >= result.startedAt);
  assert.ok(result.durationMs >= 0);
});

test('detached reloads use the same envelope without inventing a session', async () => {
  const result = await performDetachedAction({
    identity: {
      platform: 'android',
      deviceId: 'emulator-5554',
      applicationId: 'com.renanqueiroz.wave.dev',
    },
    action: 'reload',
    target: { runtime: 'hermes' },
    operation: async () => ({ method: 'hermes-cdp', reconnecting: true }),
  });

  assert.equal(result.action, 'reload');
  assert.equal(result.platform, 'android');
  assert.equal(result.deviceId, 'emulator-5554');
  assert.equal('sessionId' in result, false);
  assert.deepEqual(result.result, { method: 'hermes-cdp', reconnecting: true });
});

test('action errors retain stable codes, identity, target, and recovery guidance', () => {
  const result = actionErrorEnvelope(
    'tap',
    'TAP_FAILED',
    new MobileAgentError(
      'STALE_SNAPSHOT',
      'The snapshot is stale.',
      'Capture a new tree.',
    ),
    Date.now(),
    {
      identity,
      target: { snapshotId: 'snapshot-1', nodeId: 'node-1' },
    },
  );

  assert.equal(result.ok, false);
  assert.equal(result.action, 'tap');
  assert.equal(result.platform, 'ios');
  assert.equal(result.deviceId, identity.deviceId);
  assert.deepEqual(result.target, {
    snapshotId: 'snapshot-1',
    nodeId: 'node-1',
  });
  assert.deepEqual(result.error, {
    code: 'STALE_SNAPSHOT',
    message: 'The snapshot is stale.',
    recovery: 'Capture a new tree.',
  });
});

function config(): MobileAgentConfig {
  return {
    projectRoot: '/tmp/wave',
    artifactsDir: '/tmp/wave/.mobile-agent',
    iosDeviceSetPath: '/tmp/radon-devices',
    traceMaxCount: 50,
    traceMaxAgeDays: 7,
  };
}

function snapshot(id: string): HierarchySnapshot {
  return {
    id,
    sessionId: identity.sessionId,
    platform: identity.platform,
    createdAt: new Date(0).toISOString(),
    rootIds: [],
    nodes: [],
  };
}
