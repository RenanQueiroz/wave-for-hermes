import assert from 'node:assert/strict';
import test from 'node:test';

import { COMPANION_SETUP_PROMPT } from '../../src/features/connection/companion-setup-prompt.ts';

test('setup prompt walks the agent through the full companion workflow', () => {
  assert.match(
    COMPANION_SETUP_PROMPT,
    /https:\/\/github\.com\/RenanQueiroz\/wave-for-hermes/,
  );
  assert.match(COMPANION_SETUP_PROMPT, /companion\/Dockerfile/);
  assert.match(COMPANION_SETUP_PROMPT, /WAVE_DATABASE_PATH/);
  assert.match(COMPANION_SETUP_PROMPT, /tailscale serve/);
  assert.match(COMPANION_SETUP_PROMPT, /100\.64\.0\.0\/10/);
  assert.match(COMPANION_SETUP_PROMPT, /\/v1\/status/);
  assert.match(COMPANION_SETUP_PROMPT, /admin\.js pair/);
});

test('setup prompt keeps credentials out of the exchange', () => {
  // The prompt must instruct the agent, not carry values: no key material,
  // and explicit orders to never echo credential values back.
  assert.match(COMPANION_SETUP_PROMPT, /never print its value/);
  assert.match(
    COMPANION_SETUP_PROMPT,
    /do not echo the Hermes or OpenAI key values/,
  );
  assert.doesNotMatch(COMPANION_SETUP_PROMPT, /sk-[A-Za-z0-9]/);
  assert.doesNotMatch(COMPANION_SETUP_PROMPT, /Bearer /);
  // Server-only environment variable names must stay out of mobile source;
  // the workspace boundary check enforces the same rule repository-wide.
  assert.doesNotMatch(COMPANION_SETUP_PROMPT, /HERMES_API_(?:KEY|URL)/);
  assert.doesNotMatch(COMPANION_SETUP_PROMPT, /OPENAI_API_KEY/);
});
