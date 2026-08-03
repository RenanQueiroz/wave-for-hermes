import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

import { loadConfig, PINNED_APPIUM_MCP_VERSION } from './config.js';

const require = createRequire(import.meta.url);

test('Appium MCP doctor pin matches the exact workspace dependency', () => {
  const packageJson = require('../package.json') as {
    dependencies?: Record<string, string>;
  };
  const declaredVersion = packageJson.dependencies?.['appium-mcp'];

  assert.match(PINNED_APPIUM_MCP_VERSION, /^\d+\.\d+\.\d+$/);
  assert.equal(PINNED_APPIUM_MCP_VERSION, declaredVersion);
});

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
