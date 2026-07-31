import assert from 'node:assert/strict';
import test from 'node:test';

import { redactHeaders, redactText, redactUrl } from './observability.js';

test('redacts sensitive headers without hiding ordinary metadata', () => {
  assert.deepEqual(
    redactHeaders({
      Authorization: 'Bearer visible-token',
      Cookie: 'session=secret',
      Accept: 'application/json',
    }),
    {
      Authorization: '[REDACTED]',
      Cookie: '[REDACTED]',
      Accept: 'application/json',
    },
  );
});

test('redacts sensitive URL parameters and inline secrets', () => {
  const url = redactUrl(
    'https://example.test/items?page=2&access_token=secret',
  );
  assert.match(url, /page=2/);
  assert.doesNotMatch(url, /secret/);
  assert.equal(
    redactText('Authorization: Bearer abc.def'),
    'Authorization=[REDACTED]',
  );
  assert.equal(
    redactText('access_token=abc cookie=session'),
    'access_token=[REDACTED] cookie=[REDACTED]',
  );
});
