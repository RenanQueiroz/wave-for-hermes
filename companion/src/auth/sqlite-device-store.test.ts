import assert from 'node:assert/strict';
import test from 'node:test';

import { SqliteDeviceStore } from './sqlite-device-store.ts';

const NOW = new Date('2026-07-30T01:00:00.000Z');
const EVENT_KEY_A = 'a'.repeat(64);
const EVENT_KEY_B = 'b'.repeat(64);
const EVENT_KEY_C = 'c'.repeat(64);

test('redeems a short-lived pairing code exactly once', () => {
  const store = new SqliteDeviceStore(':memory:', {
    now: () => NOW,
  });
  const pairing = store.issuePairingCode(new Date('2026-07-30T01:10:00.000Z'));

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

test('authenticates and revokes account-scoped device access', () => {
  const store = new SqliteDeviceStore(':memory:', {
    now: () => NOW,
  });
  const pairing = store.issuePairingCode(new Date('2026-07-30T01:10:00.000Z'));
  const redeemed = store.redeemPairingCode(pairing.code, 'Android emulator');
  assert.ok(redeemed);

  assert.deepEqual(
    store.authenticateDevice(redeemed.credential),
    redeemed.device,
  );
  assert.equal(store.authenticateDevice('not-a-credential'), undefined);
  assert.equal(store.isDeviceActive(redeemed.device.id), true);
  assert.equal(store.isDeviceActive('missing-device'), false);

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
  const pairing = store.issuePairingCode(new Date('2026-07-30T01:01:00.000Z'));
  now = new Date('2026-07-30T01:01:00.000Z');

  assert.equal(
    store.redeemPairingCode(pairing.code, 'Expired device'),
    undefined,
  );
  store.close();
});

test('persists idempotent realtime turns, messages, and Hermes handoffs', () => {
  const store = new SqliteDeviceStore(':memory:', {
    now: () => NOW,
  });
  const turnId = store.beginRealtimeTurn({
    createdAt: NOW.toISOString(),
    eventKey: EVENT_KEY_A,
    sessionId: 'session-1',
  });
  assert.equal(
    store.beginRealtimeTurn({
      createdAt: NOW.toISOString(),
      eventKey: EVENT_KEY_A,
      sessionId: 'session-1',
    }),
    turnId,
  );
  store.recordUserTranscript({
    transcript: 'Turn on the bedroom lights',
    turnId,
    updatedAt: NOW.toISOString(),
  });
  const acknowledgementId = store.recordWaveMessage({
    content: "I'll take care of that.",
    createdAt: NOW.toISOString(),
    eventKey: EVENT_KEY_B,
    sessionId: 'session-1',
    turnId,
  });
  assert.equal(
    store.recordWaveMessage({
      content: "I'll take care of that.",
      createdAt: NOW.toISOString(),
      eventKey: EVENT_KEY_B,
      sessionId: 'session-1',
      turnId,
    }),
    acknowledgementId,
  );
  const handoffId = store.beginHandoff({
    createdAt: NOW.toISOString(),
    eventKey: EVENT_KEY_C,
    instruction: 'Turn off the lights in the bedroom.',
    sessionId: 'session-1',
    turnId,
  });
  store.completeHandoff({
    completedAt: '2026-07-30T01:00:01.000Z',
    handoffId,
    hermesAssistantMessageId: 'internal-hermes-message',
    result: {
      answer: 'The bedroom lights are off.',
      ok: true,
      truncated: false,
    },
  });

  assert.deepEqual(store.listSessionTurns('session-1'), [
    {
      createdAt: NOW.toISOString(),
      entries: [
        {
          content: "I'll take care of that.",
          createdAt: NOW.toISOString(),
          id: acknowledgementId,
          type: 'wave_message',
        },
        {
          completedAt: '2026-07-30T01:00:01.000Z',
          createdAt: NOW.toISOString(),
          hermesAssistantMessageId: 'internal-hermes-message',
          id: handoffId,
          instruction: 'Turn off the lights in the bedroom.',
          result: {
            answer: 'The bedroom lights are off.',
            ok: true,
            truncated: false,
          },
          status: 'completed',
          type: 'handoff',
        },
      ],
      id: turnId,
      sessionId: 'session-1',
      userTranscript: 'Turn on the bedroom lights',
    },
  ]);

  store.deleteSession('session-1');
  assert.deepEqual(store.listSessionTurns('session-1'), []);
  store.close();
});
