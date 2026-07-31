import assert from 'node:assert/strict';
import test from 'node:test';

import {
  findIosProcessIds,
  parseAndroidLogcat,
  parseIosLogNdjson,
} from './native-logs.js';

test('finds a Radon iOS app process when its command includes launch arguments', () => {
  const deviceSetPath =
    '/Users/test/Library/Caches/com.swmansion.radon-ide/Devices/iOS';
  const udid = 'D0C58420-E685-4A70-9C69-AA634B245C82';
  const processList = [
    `77448 /Library/Developer/CoreSimulator/simctl --set ${deviceSetPath} launch ${udid} com.renanqueiroz.wave`,
    `77477 ${deviceSetPath}/${udid}/data/Containers/Bundle/Application/APP/wave.app/wave --initialUrl exp+wave://expo-development-client`,
    `77478 ${deviceSetPath}/${udid}/data/Containers/Bundle/Application/APP/wave.app/wave-helper`,
  ].join('\n');

  assert.deepEqual(
    findIosProcessIds(processList, deviceSetPath, udid),
    [77477],
  );
});

test('parses and redacts iOS NDJSON logs', () => {
  const entries = parseIosLogNdjson(
    JSON.stringify({
      eventType: 'logEvent',
      timestamp: '2026-07-29 01:38:22.030624-0400',
      messageType: 'Error',
      processImagePath: '/path/wave.app/wave',
      subsystem: 'com.renanqueiroz.wave',
      category: 'network',
      eventMessage: 'token=secret-value request failed',
    }),
  );

  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.process, 'wave');
  assert.equal(entries[0]?.severity, 'error');
  assert.doesNotMatch(entries[0]?.message ?? '', /secret-value/);
});

test('parses and redacts Android logcat epoch lines', () => {
  const entries = parseAndroidLogcat(
    '1785303500.123  1000 12345 12346 E WaveTag: Authorization: Bearer abc.def',
  );

  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.tag, 'WaveTag');
  assert.equal(entries[0]?.severity, 'error');
  assert.equal(entries[0]?.message, 'Authorization=[REDACTED]');
});
