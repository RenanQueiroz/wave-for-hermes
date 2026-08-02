import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyDefaultScheme,
  isPrivateLanPlainHttpHost,
  isTrustedPlainHttpHost,
} from '../../src/services/wave/base-url-policy.ts';

test('trusts loopback and the Tailscale CGNAT range only', () => {
  assert.equal(isTrustedPlainHttpHost('localhost'), true);
  assert.equal(isTrustedPlainHttpHost('LOCALHOST'), true);
  assert.equal(isTrustedPlainHttpHost('127.0.0.1'), true);
  assert.equal(isTrustedPlainHttpHost('100.64.0.0'), true);
  assert.equal(isTrustedPlainHttpHost('100.101.42.7'), true);
  assert.equal(isTrustedPlainHttpHost('100.127.255.255'), true);

  assert.equal(isTrustedPlainHttpHost('100.63.255.255'), false);
  assert.equal(isTrustedPlainHttpHost('100.128.0.0'), false);
  assert.equal(isTrustedPlainHttpHost('10.0.2.2'), false);
  assert.equal(isTrustedPlainHttpHost('wave.example.internal'), false);
  assert.equal(isTrustedPlainHttpHost('100.64.0'), false);
  assert.equal(isTrustedPlainHttpHost('100.64.0.0.1'), false);
  assert.equal(isTrustedPlainHttpHost('100.64.0.999'), false);
  assert.equal(isTrustedPlainHttpHost('100.64.0.x'), false);
  assert.equal(isTrustedPlainHttpHost(''), false);
});

test('recognizes RFC 1918 literals and mDNS names as private LAN hosts', () => {
  assert.equal(isPrivateLanPlainHttpHost('192.168.1.50'), true);
  assert.equal(isPrivateLanPlainHttpHost('10.0.0.7'), true);
  assert.equal(isPrivateLanPlainHttpHost('172.16.0.1'), true);
  assert.equal(isPrivateLanPlainHttpHost('172.31.255.255'), true);
  assert.equal(isPrivateLanPlainHttpHost('renans-mac-mini.local'), true);
  assert.equal(isPrivateLanPlainHttpHost('Renans-Mac-Mini.LOCAL'), true);
  assert.equal(isPrivateLanPlainHttpHost('renans-mac-mini.local.'), true);

  assert.equal(isPrivateLanPlainHttpHost('172.15.0.1'), false);
  assert.equal(isPrivateLanPlainHttpHost('172.32.0.1'), false);
  assert.equal(isPrivateLanPlainHttpHost('192.169.0.1'), false);
  assert.equal(isPrivateLanPlainHttpHost('11.0.0.1'), false);
  assert.equal(isPrivateLanPlainHttpHost('100.101.42.7'), false);
  assert.equal(isPrivateLanPlainHttpHost('.local'), false);
  assert.equal(isPrivateLanPlainHttpHost('local'), false);
  assert.equal(isPrivateLanPlainHttpHost('mac.localdomain'), false);
  assert.equal(isPrivateLanPlainHttpHost('wave.example.internal'), false);
  assert.equal(isPrivateLanPlainHttpHost(''), false);
});

test('defaults the scheme by host trust and leaves explicit schemes alone', () => {
  assert.equal(
    applyDefaultScheme('wave.example.internal'),
    'https://wave.example.internal',
  );
  assert.equal(
    applyDefaultScheme(' wave.example.internal:8787 '),
    'https://wave.example.internal:8787',
  );
  assert.equal(
    applyDefaultScheme('100.101.42.7:8787'),
    'http://100.101.42.7:8787',
  );
  assert.equal(applyDefaultScheme('localhost:8787'), 'http://localhost:8787');
  // Private LAN hosts stay https by default: cleartext requires typing http://.
  assert.equal(
    applyDefaultScheme('192.168.1.50:8787'),
    'https://192.168.1.50:8787',
  );
  assert.equal(
    applyDefaultScheme('renans-mac-mini.local:8787'),
    'https://renans-mac-mini.local:8787',
  );
  assert.equal(
    applyDefaultScheme('https://wave.example.internal'),
    'https://wave.example.internal',
  );
  assert.equal(
    applyDefaultScheme('http://100.64.0.1:8787'),
    'http://100.64.0.1:8787',
  );
  assert.equal(applyDefaultScheme(''), '');
});
