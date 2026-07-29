import assert from 'node:assert/strict';
import test from 'node:test';

import { capabilitiesFor } from './capabilities.js';
import type { DoctorReport } from './types.js';

test('iOS capabilities preserve the Radon-managed app and device state', () => {
  const capabilities = capabilitiesFor(doctorReport(), 'ios', {
    prebuiltWdaPath: '/tmp/WebDriverAgentRunner.app',
  });

  assert.deepEqual(capabilities, {
    platformName: 'iOS',
    'appium:automationName': 'XCUITest',
    'appium:deviceName': 'iPhone 17 Pro',
    'appium:platformVersion': '26.0',
    'appium:udid': 'IOS-DEVICE',
    'appium:bundleId': 'com.renanqueiroz.wave',
    'appium:simulatorDevicesSetPath': '/tmp/radon-ios',
    'appium:noReset': true,
    'appium:forceAppLaunch': false,
    'appium:shouldTerminateApp': false,
    'appium:usePreinstalledWDA': true,
    'appium:prebuiltWDAPath': '/tmp/WebDriverAgentRunner.app',
    'appium:newCommandTimeout': 300,
  });
});

test('Android capabilities attach without launching, stopping, or resetting Wave', () => {
  const capabilities = capabilitiesFor(doctorReport(), 'android');

  assert.deepEqual(capabilities, {
    platformName: 'Android',
    'appium:automationName': 'UiAutomator2',
    'appium:deviceName': 'emulator-5554',
    'appium:udid': 'emulator-5554',
    'appium:appPackage': 'com.renanqueiroz.wave',
    'appium:autoLaunch': false,
    'appium:noReset': true,
    'appium:dontStopAppOnReset': true,
    'appium:forceAppLaunch': false,
    'appium:shouldTerminateApp': false,
    'appium:newCommandTimeout': 300,
  });
});

function doctorReport(): DoctorReport {
  return {
    ok: true,
    readyPlatforms: ['ios', 'android'],
    generatedAt: '2026-07-29T00:00:00.000Z',
    projectRoot: '/tmp/wave',
    bundleId: 'com.renanqueiroz.wave',
    androidPackage: 'com.renanqueiroz.wave',
    toolchain: {
      nodeVersion: '22.0.0',
      nodeSupported: true,
      diagnostics: [],
    },
    ios: {
      supported: true,
      deviceSetPath: '/tmp/radon-ios',
      deviceSetExists: true,
      simulators: [],
      selected: {
        name: 'iPhone 17 Pro',
        udid: 'IOS-DEVICE',
        state: 'Booted',
        runtime: 'iOS 26.0',
        runtimeIdentifier: 'com.apple.CoreSimulator.SimRuntime.iOS-26-0',
        available: true,
        appInstalled: true,
      },
      diagnostics: [],
    },
    android: {
      adbPath: '/tmp/adb',
      devices: [],
      selected: {
        serial: 'emulator-5554',
        state: 'device',
        description: 'model:Pixel_9',
        appInstalled: true,
        appRunning: true,
      },
      diagnostics: [],
    },
    metro: {
      servers: [],
      diagnostics: [],
    },
  };
}
