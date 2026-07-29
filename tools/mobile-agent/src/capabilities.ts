import { ANDROID_PACKAGE, IOS_BUNDLE_ID } from './config.js';
import type { DoctorReport, MobilePlatform } from './types.js';

export function capabilitiesFor(
  report: DoctorReport,
  platform: MobilePlatform,
  options: { prebuiltWdaPath?: string } = {},
): Record<string, unknown> {
  if (platform === 'ios') {
    const device = report.ios.selected;
    if (!device) {
      throw new Error('No unique booted Radon iOS simulator is available.');
    }
    if (!device.appInstalled) {
      throw new Error(`${IOS_BUNDLE_ID} is not installed on ${device.name}.`);
    }
    return {
      platformName: 'iOS',
      'appium:automationName': 'XCUITest',
      'appium:deviceName': device.name,
      'appium:platformVersion': device.runtime.replace(/^iOS\s+/, ''),
      'appium:udid': device.udid,
      'appium:bundleId': IOS_BUNDLE_ID,
      'appium:simulatorDevicesSetPath': report.ios.deviceSetPath,
      'appium:noReset': true,
      'appium:forceAppLaunch': false,
      'appium:shouldTerminateApp': false,
      ...(options.prebuiltWdaPath
        ? {
            'appium:usePreinstalledWDA': true,
            'appium:prebuiltWDAPath': options.prebuiltWdaPath,
          }
        : {}),
      'appium:newCommandTimeout': 300,
    };
  }

  const device = report.android.selected;
  if (!device) {
    throw new Error('No unique online Android device is available.');
  }
  if (!device.appInstalled) {
    throw new Error(`${ANDROID_PACKAGE} is not installed on ${device.serial}.`);
  }
  if (!device.appRunning) {
    throw new Error(
      `${ANDROID_PACKAGE} is installed but not running on ${device.serial}. Launch it in Radon first.`,
    );
  }
  return {
    platformName: 'Android',
    'appium:automationName': 'UiAutomator2',
    'appium:deviceName': device.serial,
    'appium:udid': device.serial,
    'appium:appPackage': ANDROID_PACKAGE,
    'appium:autoLaunch': false,
    'appium:noReset': true,
    'appium:dontStopAppOnReset': true,
    'appium:forceAppLaunch': false,
    'appium:shouldTerminateApp': false,
    'appium:newCommandTimeout': 300,
  };
}
