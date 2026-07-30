import assert from 'node:assert/strict';
import test from 'node:test';

import { SqliteDeviceStore } from './sqlite-device-store.ts';

const NOW = new Date('2026-07-30T01:00:00.000Z');

test('redeems a short-lived pairing code exactly once', () => {
  const store = new SqliteDeviceStore(':memory:', {
    now: () => NOW,
  });
  const pairing = store.issuePairingCode(
    new Date('2026-07-30T01:10:00.000Z'),
  );

  assert.match(pairing.code, /^[A-Z2-9]{4}(?:-[A-Z2-9]{4}){3}$/);
  const redeemed = store.redeemPairingCode(
    pairing.code.toLowerCase(),
    'Renan’s iPhone',
  );
  assert.ok(redeemed);
  assert.match(redeemed.credential, /^wave_device_[A-Za-z0-9_-]{43}$/);
  assert.equal(redeemed.device.name, 'Renan’s iPhone');
  assert.equal(
    store.redeemPairingCode(pairing.code, 'Second device'),
    undefined,
  );
  store.close();
});

test('authenticates, binds, lists, and revokes device access', () => {
  const store = new SqliteDeviceStore(':memory:', {
    now: () => NOW,
  });
  const pairing = store.issuePairingCode(
    new Date('2026-07-30T01:10:00.000Z'),
  );
  const redeemed = store.redeemPairingCode(pairing.code, 'Android emulator');
  assert.ok(redeemed);

  assert.deepEqual(
    store.authenticateDevice(redeemed.credential),
    redeemed.device,
  );
  assert.equal(store.authenticateDevice('not-a-credential'), undefined);
  store.bindSession(redeemed.device.id, 'session-1');
  store.bindSession(redeemed.device.id, 'session-1');
  assert.equal(store.hasSession(redeemed.device.id, 'session-1'), true);
  assert.equal(store.isDeviceActive(redeemed.device.id), true);
  assert.equal(store.isDeviceActive('missing-device'), false);
  assert.deepEqual(store.listSessionIds(redeemed.device.id), ['session-1']);

  const listed = store.listDevices();
  assert.equal(listed.length, 1);
  assert.equal(listed[0]?.id, redeemed.device.id);
  assert.equal('credential' in (listed[0] ?? {}), false);

  assert.equal(store.revokeDevice(redeemed.device.id), true);
  assert.equal(store.revokeDevice(redeemed.device.id), false);
  assert.equal(store.authenticateDevice(redeemed.credential), undefined);
  assert.equal(store.isDeviceActive(redeemed.device.id), false);
  store.close();
});

test('rejects expired pairing codes', () => {
  let now = NOW;
  const store = new SqliteDeviceStore(':memory:', {
    now: () => now,
  });
  const pairing = store.issuePairingCode(
    new Date('2026-07-30T01:01:00.000Z'),
  );
  now = new Date('2026-07-30T01:01:00.000Z');

  assert.equal(
    store.redeemPairingCode(pairing.code, 'Expired device'),
    undefined,
  );
  store.close();
});
