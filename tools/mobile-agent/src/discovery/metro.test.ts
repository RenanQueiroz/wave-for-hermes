import assert from 'node:assert/strict';
import test from 'node:test';

import { loadConfig } from '../config.js';
import { candidateMetroUrls } from './metro.js';

test('an explicit Metro URL disables automatic server discovery', async () => {
  const config = loadConfig('/tmp/wave-mobile-agent-test', {
    NODE_ENV: 'test',
    MOBILE_AGENT_METRO_URL: 'http://127.0.0.1:55448/',
  });

  assert.deepEqual(await candidateMetroUrls(config), [
    'http://127.0.0.1:55448',
  ]);
});
