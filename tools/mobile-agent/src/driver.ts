import type { AppiumMcpCore } from 'appium-mcp/core';

import type { ElementBounds } from './hierarchy.js';
import type { MobilePlatform } from './types.js';

export interface NativeDriver {
  constructor?: { name?: string };
  getPageSource(): Promise<string>;
  getScreenshot?(): Promise<string>;
  takeScreenshot?(): Promise<string>;
  findElement(strategy: string, selector: string): Promise<unknown>;
  click?(elementId: string): Promise<unknown>;
  elementClick?(elementId: string): Promise<unknown>;
  performActions(actions: unknown[]): Promise<unknown>;
}

export interface ResolvedDriver {
  driver: NativeDriver;
  sessionId: string;
  platform: MobilePlatform;
}

export function resolveNativeDriver(core: AppiumMcpCore, requestedSessionId?: string): ResolvedDriver {
  const sessionId = requestedSessionId ?? core.getSessionId() ?? undefined;
  if (!sessionId) {
    throw new Error('No Appium session is active. Create a session first.');
  }
  const session = core.getSessionInfo(sessionId);
  const driver = core.getDriver(sessionId) as NativeDriver | null;
  if (!session || !driver) {
    throw new Error(`Appium session ${sessionId} is not available.`);
  }
  const platformName = session.metadata.capabilities.platformName ?? session.metadata.platform;
  const platform =
    typeof platformName === 'string' && platformName.toLocaleLowerCase() === 'android'
      ? 'android'
      : typeof platformName === 'string' && platformName.toLocaleLowerCase() === 'ios'
        ? 'ios'
        : undefined;
  if (!platform) {
    throw new Error(`Session ${sessionId} is not an iOS or Android native session.`);
  }
  if (
    typeof driver.getPageSource !== 'function' ||
    typeof driver.findElement !== 'function' ||
    typeof driver.performActions !== 'function'
  ) {
    throw new Error(`Session ${sessionId} does not expose the required native driver commands.`);
  }
  return { driver, sessionId, platform };
}

export async function findNativeElementId(
  driver: NativeDriver,
  strategy: string,
  selector: string,
): Promise<string> {
  const result = await driver.findElement(strategy, selector);
  if (!result || typeof result !== 'object') {
    throw new Error(`The native driver returned no element for ${strategy}=${selector}.`);
  }
  const element = result as Record<string, unknown>;
  const elementId =
    element['element-6066-11e4-a52e-4f735466cecf'] ??
    element.ELEMENT ??
    element.elementId;
  if (typeof elementId !== 'string' || elementId.length === 0) {
    throw new Error(`The native driver returned an element without an ID for ${strategy}=${selector}.`);
  }
  return elementId;
}

export async function clickNativeElement(driver: NativeDriver, elementId: string): Promise<void> {
  if (driver.constructor?.name === 'Client' && typeof driver.elementClick === 'function') {
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

export async function tapCoordinates(driver: NativeDriver, bounds: ElementBounds): Promise<void> {
  const x = Math.round(bounds.x + bounds.width / 2);
  const y = Math.round(bounds.y + bounds.height / 2);
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

export async function captureNativeScreenshot(driver: NativeDriver): Promise<string> {
  const screenshot =
    typeof driver.getScreenshot === 'function'
      ? await driver.getScreenshot()
      : typeof driver.takeScreenshot === 'function'
        ? await driver.takeScreenshot()
        : undefined;
  if (typeof screenshot !== 'string' || screenshot.length === 0) {
    throw new Error('The active native driver does not support screenshot capture.');
  }
  return screenshot;
}
