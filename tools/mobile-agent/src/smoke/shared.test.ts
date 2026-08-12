import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertActionEnvelope,
  assertStaleSnapshotRejected,
  parseJsonObject,
  readSessionId,
} from './shared.js';

test('shared smoke assertions accept valid platform action envelopes', () => {
  assert.doesNotThrow(() =>
    assertActionEnvelope(
      {
        ok: true,
        action: 'tap',
        platform: 'ios',
        deviceId: 'radon-device',
        applicationId: 'com.renanqueiroz.wave.dev',
        sessionId: 'session-1',
        durationMs: 10,
        target: { nodeId: 'node-1' },
        result: { method: 'native-element' },
        warnings: [],
      },
      'tap',
      'ios',
      'session-1',
    ),
  );
});

test('shared smoke assertions reject platform identity mismatches', () => {
  assert.throws(
    () =>
      assertActionEnvelope(
        {
          ok: true,
          action: 'tap',
          platform: 'android',
          deviceId: 'radon-device',
          applicationId: 'com.renanqueiroz.wave.dev',
          durationMs: 10,
          target: { nodeId: 'node-1' },
          result: { method: 'native-element' },
          warnings: [],
        },
        'tap',
        'ios',
        undefined,
      ),
    /identify platform ios/,
  );
});

test('shared stale-snapshot assertion validates the bounded error shape', () => {
  assert.doesNotThrow(() =>
    assertStaleSnapshotRejected(
      {
        isError: true,
        text: JSON.stringify({
          ok: false,
          action: 'tap',
          platform: 'android',
          deviceId: 'pixel',
          applicationId: 'com.renanqueiroz.wave.dev',
          sessionId: 'session-1',
          durationMs: 5,
          target: { snapshotId: 'snapshot-1' },
          error: { code: 'STALE_SNAPSHOT' },
        }),
        raw: undefined,
      },
      'android',
      'session-1',
      'snapshot-1',
    ),
  );
});

test('shared smoke parsers reject invalid values', () => {
  assert.deepEqual(parseJsonObject('{"ok":true}', 'result'), { ok: true });
  assert.equal(
    readSessionId('Created session with ID: session-1'),
    'session-1',
  );
  assert.throws(() => parseJsonObject('[]', 'result'), /was not a JSON object/);
  assert.throws(() => readSessionId('missing'), /Could not parse/);
});
