import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createWaveConnectionRecord,
  parseWaveConnectionRecord,
  serializeWaveConnectionRecord,
  toWaveConnectionSummary,
  WaveCredentialStoreError,
} from '../../src/services/credentials/connection-record.ts';

const record = createWaveConnectionRecord({
  baseUrl: 'https://wave.test/private/',
  credential: `wave_device_${'a'.repeat(43)}`,
  device: {
    createdAt: '2026-07-30T02:00:00.000Z',
    id: 'device-1',
    name: 'Test phone',
  },
});

test('round-trips a strict versioned connection record', () => {
  const restored = parseWaveConnectionRecord(
    serializeWaveConnectionRecord(record),
  );

  assert.deepEqual(restored, record);
  assert.equal(restored.baseUrl, 'https://wave.test/private');
});

test('keeps the device credential out of public connection summaries', () => {
  const summary = toWaveConnectionSummary(record);

  assert.deepEqual(summary, {
    baseUrl: 'https://wave.test/private',
    device: record.device,
  });
  assert.equal(JSON.stringify(summary).includes('wave_device_'), false);
});

test('rejects corrupt, unknown-version, and insecure stored records', () => {
  for (const serialized of [
    'not json',
    JSON.stringify({ ...record, version: 2 }),
    JSON.stringify({ ...record, baseUrl: 'http://wave.test' }),
    JSON.stringify({ ...record, credential: 'not-a-device-credential' }),
  ]) {
    assert.throws(
      () => parseWaveConnectionRecord(serialized),
      (error: unknown) => error instanceof WaveCredentialStoreError,
    );
  }
});
