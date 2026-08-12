import assert from 'node:assert/strict';
import test from 'node:test';

import {
  backgroundNativeApplication,
  dragPoints,
  openNativeDeepLink,
  pressNativeKey,
  setNativeElementValue,
  swipePoints,
  terminateNativeApplication,
  type NativeDriver,
  type ResolvedDriver,
} from './driver.js';

test('swipe and drag build bounded W3C touch sequences', async () => {
  const operations: unknown[][] = [];
  const driver = fakeDriver({
    performActions: async (actions) => {
      operations.push(actions);
    },
  });

  await swipePoints(driver, { x: 20, y: 80 }, { x: 20, y: 20 }, 300);
  await dragPoints(driver, { x: 10, y: 10 }, { x: 90, y: 90 }, 1_200, 600);

  const swipe = pointerActions(operations[0]);
  assert.deepEqual(swipe, [
    { type: 'pointerMove', duration: 0, x: 20, y: 80, origin: 'viewport' },
    { type: 'pointerDown', button: 0 },
    { type: 'pointerMove', duration: 300, x: 20, y: 20, origin: 'viewport' },
    { type: 'pointerUp', button: 0 },
  ]);
  const drag = pointerActions(operations[1]);
  assert.deepEqual(drag[2], { type: 'pause', duration: 600 });
  assert.deepEqual(drag[3], {
    type: 'pointerMove',
    duration: 1_200,
    x: 90,
    y: 90,
    origin: 'viewport',
  });
});

test('text values are sent directly to the selected native element', async () => {
  const calls: Array<{ text: string; elementId: string }> = [];
  const cleared: string[] = [];
  const driver = fakeDriver({
    clear: async (elementId) => {
      cleared.push(elementId);
    },
    setValue: async (text, elementId) => {
      calls.push({ text, elementId });
    },
  });

  await setNativeElementValue(driver, 'element-1', 'private text');
  await setNativeElementValue(driver, 'element-1', '');

  assert.deepEqual(calls, [{ text: 'private text', elementId: 'element-1' }]);
  assert.deepEqual(cleared, ['element-1', 'element-1']);
});

test('safe lifecycle and deep-link helpers use platform-specific mobile commands', async () => {
  const commands: Array<{
    command: string;
    parameters?: Record<string, unknown>;
  }> = [];
  const driver = fakeDriver({
    execute: async (command, parameters) => {
      commands.push({ command, ...(parameters ? { parameters } : {}) });
    },
  });
  const ios = resolved(driver, 'ios');
  const android = resolved(driver, 'android');

  await terminateNativeApplication(ios);
  await terminateNativeApplication(android);
  await backgroundNativeApplication(android, 3);
  await openNativeDeepLink(ios, 'wave-dev://chat', true);

  assert.deepEqual(commands, [
    {
      command: 'mobile: terminateApp',
      parameters: { bundleId: 'com.renanqueiroz.wave.dev' },
    },
    {
      command: 'mobile: terminateApp',
      parameters: { appId: 'com.renanqueiroz.wave.dev' },
    },
    { command: 'mobile: backgroundApp', parameters: { seconds: 3 } },
    {
      command: 'mobile: deepLink',
      parameters: {
        url: 'wave-dev://chat',
        bundleId: 'com.renanqueiroz.wave.dev',
      },
    },
  ]);
});

test('navigation keys map to safe native back and home commands', async () => {
  const calls: unknown[] = [];
  const driver = fakeDriver({
    back: async () => {
      calls.push('back');
    },
    mobilePressKey: async (keyCode) => {
      calls.push({ keyCode });
    },
    mobilePressButton: async (name) => {
      calls.push({ name });
    },
  });

  await pressNativeKey(resolved(driver, 'android'), 'back');
  await pressNativeKey(resolved(driver, 'android'), 'home');
  await pressNativeKey(resolved(driver, 'ios'), 'home');

  assert.deepEqual(calls, ['back', { keyCode: 3 }, { name: 'home' }]);
});

function fakeDriver(overrides: Partial<NativeDriver>): NativeDriver {
  return {
    getPageSource: async () => '<AppiumAUT />',
    findElement: async () => ({}),
    performActions: async () => undefined,
    ...overrides,
  };
}

function resolved(
  driver: NativeDriver,
  platform: 'ios' | 'android',
): ResolvedDriver {
  return {
    driver,
    sessionId: 'session-1',
    platform,
    deviceId: 'device-1',
    applicationId: 'com.renanqueiroz.wave.dev',
  };
}

function pointerActions(operation: unknown[] | undefined): unknown[] {
  assert.ok(operation);
  const sequence = operation[0];
  assert.ok(
    sequence && typeof sequence === 'object' && !Array.isArray(sequence),
  );
  const actions = (sequence as Record<string, unknown>).actions;
  assert.ok(Array.isArray(actions));
  return actions;
}
