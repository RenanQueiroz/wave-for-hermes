import type { AppiumMcpCore } from 'appium-mcp/core';

import { ANDROID_PACKAGE, IOS_BUNDLE_ID } from './config.js';
import type { ElementBounds } from './hierarchy.js';
import type { MobilePlatform } from './types.js';

export interface WindowRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface NativeDriver {
  constructor?: { name?: string };
  getPageSource(): Promise<string>;
  getScreenshot?(): Promise<string>;
  takeScreenshot?(): Promise<string>;
  getWindowRect?(): Promise<WindowRect>;
  getElementRect?(elementId: string): Promise<WindowRect>;
  findElement(strategy: string, selector: string): Promise<unknown>;
  click?(elementId: string): Promise<unknown>;
  elementClick?(elementId: string): Promise<unknown>;
  clear?(elementId: string): Promise<unknown>;
  setValue?(text: string, elementId: string): Promise<unknown>;
  back?(): Promise<unknown>;
  activateApp?(applicationId: string): Promise<unknown>;
  execute?(
    command: string,
    parameters?: Record<string, unknown>,
  ): Promise<unknown>;
  executeScript?(command: string, parameters: unknown[]): Promise<unknown>;
  elementSendKeys?(elementId: string, value: string): Promise<unknown>;
  mobilePressKey?(
    keyCode: number,
    metastate?: number,
    flags?: number,
    isLongPress?: boolean,
  ): Promise<unknown>;
  mobilePressButton?(name: string): Promise<unknown>;
  mobileDeepLink?(
    url: string,
    applicationId?: string,
    waitForLaunch?: boolean,
  ): Promise<unknown>;
  performActions(actions: unknown[]): Promise<unknown>;
}

export interface ResolvedDriver {
  driver: NativeDriver;
  sessionId: string;
  platform: MobilePlatform;
  deviceId: string;
  applicationId: string;
}

export function resolveNativeDriver(
  core: AppiumMcpCore,
  requestedSessionId?: string,
): ResolvedDriver {
  const sessionId = requestedSessionId ?? core.getSessionId() ?? undefined;
  if (!sessionId) {
    throw new Error('No Appium session is active. Create a session first.');
  }
  const session = core.getSessionInfo(sessionId);
  const driver = core.getDriver(sessionId) as NativeDriver | null;
  if (!session || !driver) {
    throw new Error(`Appium session ${sessionId} is not available.`);
  }
  const platformName =
    session.metadata.capabilities.platformName ?? session.metadata.platform;
  const platform =
    typeof platformName === 'string' &&
    platformName.toLocaleLowerCase() === 'android'
      ? 'android'
      : typeof platformName === 'string' &&
          platformName.toLocaleLowerCase() === 'ios'
        ? 'ios'
        : undefined;
  if (!platform) {
    throw new Error(
      `Session ${sessionId} is not an iOS or Android native session.`,
    );
  }
  if (
    typeof driver.getPageSource !== 'function' ||
    typeof driver.findElement !== 'function' ||
    typeof driver.performActions !== 'function'
  ) {
    throw new Error(
      `Session ${sessionId} does not expose the required native driver commands.`,
    );
  }
  const capabilities = session.metadata.capabilities as Record<string, unknown>;
  const deviceId = firstString(
    capabilities['appium:udid'],
    capabilities.udid,
    capabilities['appium:deviceName'],
    capabilities.deviceName,
  );
  if (!deviceId) {
    throw new Error(
      `Session ${sessionId} does not identify its target device.`,
    );
  }
  return {
    driver,
    sessionId,
    platform,
    deviceId,
    applicationId: platform === 'ios' ? IOS_BUNDLE_ID : ANDROID_PACKAGE,
  };
}

export async function findNativeElementId(
  driver: NativeDriver,
  strategy: string,
  selector: string,
): Promise<string> {
  const result = await driver.findElement(strategy, selector);
  if (!result || typeof result !== 'object') {
    throw new Error(
      `The native driver returned no element for ${strategy}=${selector}.`,
    );
  }
  const element = result as Record<string, unknown>;
  const elementId =
    element['element-6066-11e4-a52e-4f735466cecf'] ??
    element.ELEMENT ??
    element.elementId;
  if (typeof elementId !== 'string' || elementId.length === 0) {
    throw new Error(
      `The native driver returned an element without an ID for ${strategy}=${selector}.`,
    );
  }
  return elementId;
}

export async function clickNativeElement(
  driver: NativeDriver,
  elementId: string,
): Promise<void> {
  if (
    driver.constructor?.name === 'Client' &&
    typeof driver.elementClick === 'function'
  ) {
    await driver.elementClick(elementId);
    return;
  }
  if (typeof driver.click === 'function') {
    await driver.click(elementId);
    return;
  }
  if (typeof driver.elementClick === 'function') {
    await driver.elementClick(elementId);
    return;
  }
  throw new Error('The active native driver does not support element clicks.');
}

export async function tapCoordinates(
  driver: NativeDriver,
  bounds: ElementBounds,
): Promise<void> {
  const x = Math.round(bounds.x + bounds.width / 2);
  const y = Math.round(bounds.y + bounds.height / 2);
  await tapPoint(driver, x, y);
}

export async function tapPoint(
  driver: NativeDriver,
  x: number,
  y: number,
): Promise<void> {
  await driver.performActions([
    {
      type: 'pointer',
      id: 'finger',
      parameters: { pointerType: 'touch' },
      actions: [
        { type: 'pointerMove', duration: 0, x, y, origin: 'viewport' },
        { type: 'pointerDown', button: 0 },
        { type: 'pause', duration: 80 },
        { type: 'pointerUp', button: 0 },
      ],
    },
  ]);
}

export async function longPressPoint(
  driver: NativeDriver,
  x: number,
  y: number,
  durationMs: number,
): Promise<void> {
  await driver.performActions([
    {
      type: 'pointer',
      id: 'finger',
      parameters: { pointerType: 'touch' },
      actions: [
        { type: 'pointerMove', duration: 0, x, y, origin: 'viewport' },
        { type: 'pointerDown', button: 0 },
        { type: 'pause', duration: durationMs },
        { type: 'pointerUp', button: 0 },
      ],
    },
  ]);
}

export async function dragPoints(
  driver: NativeDriver,
  source: { x: number; y: number },
  target: { x: number; y: number },
  durationMs: number,
  longPressDurationMs: number,
): Promise<void> {
  await driver.performActions([
    {
      type: 'pointer',
      id: 'finger',
      parameters: { pointerType: 'touch' },
      actions: [
        {
          type: 'pointerMove',
          duration: 0,
          x: source.x,
          y: source.y,
          origin: 'viewport',
        },
        { type: 'pointerDown', button: 0 },
        { type: 'pause', duration: longPressDurationMs },
        {
          type: 'pointerMove',
          duration: durationMs,
          x: target.x,
          y: target.y,
          origin: 'viewport',
        },
        { type: 'pause', duration: 150 },
        { type: 'pointerUp', button: 0 },
      ],
    },
  ]);
}

export async function swipePoints(
  driver: NativeDriver,
  source: { x: number; y: number },
  target: { x: number; y: number },
  durationMs: number,
): Promise<void> {
  await driver.performActions([
    {
      type: 'pointer',
      id: 'finger',
      parameters: { pointerType: 'touch' },
      actions: [
        {
          type: 'pointerMove',
          duration: 0,
          x: source.x,
          y: source.y,
          origin: 'viewport',
        },
        { type: 'pointerDown', button: 0 },
        {
          type: 'pointerMove',
          duration: durationMs,
          x: target.x,
          y: target.y,
          origin: 'viewport',
        },
        { type: 'pointerUp', button: 0 },
      ],
    },
  ]);
}

export async function getNativeWindowRect(
  driver: NativeDriver,
): Promise<WindowRect> {
  if (typeof driver.getWindowRect !== 'function') {
    throw new Error(
      'The active native driver does not support window rectangle queries.',
    );
  }
  const rect = await driver.getWindowRect();
  if (
    !Number.isFinite(rect.x) ||
    !Number.isFinite(rect.y) ||
    !Number.isFinite(rect.width) ||
    !Number.isFinite(rect.height) ||
    rect.width <= 0 ||
    rect.height <= 0
  ) {
    throw new Error(
      'The active native driver returned an invalid window rectangle.',
    );
  }
  return rect;
}

export async function getNativeElementRect(
  driver: NativeDriver,
  elementId: string,
): Promise<WindowRect> {
  if (typeof driver.getElementRect !== 'function') {
    throw new Error(
      'The active native driver does not support element rectangle queries.',
    );
  }
  const rect = await driver.getElementRect(elementId);
  if (
    !Number.isFinite(rect.x) ||
    !Number.isFinite(rect.y) ||
    !Number.isFinite(rect.width) ||
    !Number.isFinite(rect.height) ||
    rect.width <= 0 ||
    rect.height <= 0
  ) {
    throw new Error(
      `The native driver returned invalid bounds for element ${elementId}.`,
    );
  }
  return rect;
}

export async function setNativeElementValue(
  driver: NativeDriver,
  elementId: string,
  value: string,
): Promise<void> {
  if (typeof driver.clear === 'function') {
    await driver.clear(elementId);
    if (!value) return;
  }
  if (typeof driver.setValue !== 'function') {
    if (typeof driver.elementSendKeys === 'function') {
      await driver.elementSendKeys(elementId, value);
      return;
    }
    throw new Error(
      'The active native driver does not support setting element values.',
    );
  }
  await driver.setValue(value, elementId);
}

export async function pressNativeKey(
  resolved: ResolvedDriver,
  key: 'back' | 'home',
): Promise<void> {
  if (key === 'back') {
    if (typeof resolved.driver.back !== 'function') {
      throw new Error(
        'The active native driver does not support back navigation.',
      );
    }
    await resolved.driver.back();
    return;
  }
  if (resolved.platform === 'android') {
    if (typeof resolved.driver.mobilePressKey === 'function') {
      await resolved.driver.mobilePressKey(3);
      return;
    }
    await executeMobileCommand(resolved.driver, 'mobile: pressKey', {
      keycode: 3,
    });
    return;
  }
  if (typeof resolved.driver.mobilePressButton === 'function') {
    await resolved.driver.mobilePressButton('home');
    return;
  }
  await executeMobileCommand(resolved.driver, 'mobile: pressButton', {
    name: 'home',
  });
}

export async function activateNativeApplication(
  resolved: ResolvedDriver,
): Promise<void> {
  if (typeof resolved.driver.activateApp !== 'function') {
    throw new Error(
      'The active native driver does not support application activation.',
    );
  }
  await resolved.driver.activateApp(resolved.applicationId);
}

export async function terminateNativeApplication(
  resolved: ResolvedDriver,
): Promise<void> {
  await executeMobileCommand(
    resolved.driver,
    'mobile: terminateApp',
    resolved.platform === 'android'
      ? { appId: resolved.applicationId }
      : { bundleId: resolved.applicationId },
  );
}

export async function backgroundNativeApplication(
  resolved: ResolvedDriver,
  seconds: number,
): Promise<void> {
  await executeMobileCommand(resolved.driver, 'mobile: backgroundApp', {
    seconds,
  });
}

export async function openNativeDeepLink(
  resolved: ResolvedDriver,
  url: string,
  waitForLaunch: boolean,
): Promise<void> {
  if (typeof resolved.driver.mobileDeepLink === 'function') {
    await resolved.driver.mobileDeepLink(
      url,
      resolved.applicationId,
      waitForLaunch,
    );
    return;
  }
  await executeMobileCommand(
    resolved.driver,
    'mobile: deepLink',
    resolved.platform === 'android'
      ? { url, package: resolved.applicationId, waitForLaunch }
      : { url, bundleId: resolved.applicationId },
  );
}

export async function captureNativeScreenshot(
  driver: NativeDriver,
): Promise<string> {
  const screenshot =
    typeof driver.getScreenshot === 'function'
      ? await driver.getScreenshot()
      : typeof driver.takeScreenshot === 'function'
        ? await driver.takeScreenshot()
        : undefined;
  if (typeof screenshot !== 'string' || screenshot.length === 0) {
    throw new Error(
      'The active native driver does not support screenshot capture.',
    );
  }
  return screenshot;
}

async function executeMobileCommand(
  driver: NativeDriver,
  command: string,
  parameters: Record<string, unknown>,
): Promise<void> {
  if (typeof driver.execute !== 'function') {
    if (typeof driver.executeScript === 'function') {
      await driver.executeScript(command, [parameters]);
      return;
    }
    throw new Error(`The active native driver does not support ${command}.`);
  }
  await driver.execute(command, parameters);
}

function firstString(...values: unknown[]): string | undefined {
  return values.find(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );
}
