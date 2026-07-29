import assert from 'node:assert/strict';
import test from 'node:test';

import type { AndroidDevice } from '../types.js';
import { parseAdbDevices, selectAndroidDevice } from './android.js';

test('parseAdbDevices parses devices and preserves descriptive fields', () => {
  const devices = parseAdbDevices(
    [
      'List of devices attached',
      'emulator-5554 device product:sdk_gphone model:Pixel_9 transport_id:1',
      'ABC123 offline usb:1-1',
      '',
    ].join('\n'),
  );

  assert.deepEqual(devices, [
    {
      serial: 'emulator-5554',
      state: 'device',
      description: 'product:sdk_gphone model:Pixel_9 transport_id:1',
    },
    {
      serial: 'ABC123',
      state: 'offline',
      description: 'usb:1-1',
    },
  ]);
});

test('selectAndroidDevice requires an explicit serial when multiple devices are online', () => {
  const devices = [
    androidDevice('emulator-5554'),
    androidDevice('emulator-5556'),
  ];

  const ambiguous = selectAndroidDevice(devices);
  assert.equal(ambiguous.selected, undefined);
  assert.equal(ambiguous.diagnostics[0]?.code, 'MULTIPLE_ANDROID_DEVICES');

  const explicit = selectAndroidDevice(devices, 'emulator-5556');
  assert.equal(explicit.selected?.serial, 'emulator-5556');
  assert.equal(explicit.diagnostics[0]?.code, 'ANDROID_DEVICE_SELECTED');
});

test('selectAndroidDevice never selects a configured offline device', () => {
  const selection = selectAndroidDevice(
    [{ ...androidDevice('physical-1'), state: 'offline' }],
    'physical-1',
  );

  assert.equal(selection.selected, undefined);
  assert.equal(selection.diagnostics[0]?.code, 'ANDROID_DEVICE_NOT_ONLINE');
});

function androidDevice(serial: string): AndroidDevice {
  return {
    serial,
    state: 'device',
    description: 'model:Pixel_9',
    appInstalled: true,
    appRunning: true,
  };
}
