import assert from 'node:assert/strict';
import test from 'node:test';

import { loadConfig } from './config.js';

test('loadConfig reads explicit native device selectors', () => {
  const config = loadConfig('/tmp/wave-mobile-agent-test', {
    NODE_ENV: 'test',
    MOBILE_AGENT_ANDROID_SERIAL: 'emulator-5556',
    MOBILE_AGENT_IOS_UDID: 'DEVICE-B',
  });

  assert.equal(config.androidSerial, 'emulator-5556');
  assert.equal(config.iosUdid, 'DEVICE-B');
  assert.equal(config.traceMaxCount, 50);
  assert.equal(config.traceMaxAgeDays, 7);
});

test('loadConfig validates and reads trace retention limits', () => {
  const config = loadConfig('/tmp/wave-mobile-agent-test', {
    NODE_ENV: 'test',
    MOBILE_AGENT_TRACE_MAX_COUNT: '12',
    MOBILE_AGENT_TRACE_MAX_AGE_DAYS: '3',
  });

  assert.equal(config.traceMaxCount, 12);
  assert.equal(config.traceMaxAgeDays, 3);
  assert.throws(
    () =>
      loadConfig('/tmp/wave-mobile-agent-test', {
        NODE_ENV: 'test',
        MOBILE_AGENT_TRACE_MAX_COUNT: '0',
      }),
    /must be a positive integer/,
  );
});
