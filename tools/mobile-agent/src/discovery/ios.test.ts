import assert from 'node:assert/strict';
import test from 'node:test';

import type { IosSimulator } from '../types.js';
import { selectIosSimulator } from './ios.js';

test('selectIosSimulator requires an explicit UDID when multiple simulators are booted', () => {
  const simulators = [
    iosSimulator('DEVICE-A', 'iPhone 17 Pro'),
    iosSimulator('DEVICE-B', 'iPhone 17 Pro'),
  ];

  const ambiguous = selectIosSimulator(simulators);
  assert.equal(ambiguous.selected, undefined);
  assert.equal(ambiguous.diagnostics[0]?.code, 'MULTIPLE_BOOTED_IOS_DEVICES');

  const explicit = selectIosSimulator(simulators, 'DEVICE-B');
  assert.equal(explicit.selected?.udid, 'DEVICE-B');
  assert.equal(explicit.diagnostics[0]?.code, 'IOS_DEVICE_SELECTED');
});

test('selectIosSimulator never selects a configured shutdown simulator', () => {
  const selection = selectIosSimulator(
    [{ ...iosSimulator('DEVICE-A', 'iPhone 17 Pro'), state: 'Shutdown' }],
    'DEVICE-A',
  );

  assert.equal(selection.selected, undefined);
  assert.equal(selection.diagnostics[0]?.code, 'IOS_DEVICE_NOT_BOOTED');
});

function iosSimulator(udid: string, name: string): IosSimulator {
  return {
    name,
    udid,
    state: 'Booted',
    runtime: 'iOS 26.0',
    runtimeIdentifier: 'com.apple.CoreSimulator.SimRuntime.iOS-26-0',
    available: true,
    appInstalled: true,
  };
}
