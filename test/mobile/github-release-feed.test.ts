import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseLatestReleasePayload,
  UPDATE_FEED_ERROR_COPY,
  WAVE_RELEASE_DOWNLOAD_PREFIX,
} from '../../src/services/updates/github-release-feed.ts';

const DOWNLOAD_BASE = `${WAVE_RELEASE_DOWNLOAD_PREFIX}v0.2.0-300/`;

function asset(name: string, overrides: Record<string, unknown> = {}) {
  return {
    browser_download_url: `${DOWNLOAD_BASE}${name}`,
    name,
    size: 50 * 1024 * 1024,
    ...overrides,
  };
}

function release(overrides: Record<string, unknown> = {}) {
  return {
    assets: [
      asset('wave-0.2.0.apk'),
      asset('wave-0.2.0.apk.sha256', { size: 101 }),
      asset('wave-0.2.0.apk.md5', { size: 55 }),
    ],
    body: 'Fixes and improvements.',
    draft: false,
    prerelease: false,
    tag_name: 'v0.2.0-300',
    ...overrides,
  };
}

test('a newer release parses into a bounded update', () => {
  const outcome = parseLatestReleasePayload(release(), 233);
  assert.equal(outcome.kind, 'update');
  if (outcome.kind !== 'update') return;
  assert.deepEqual(outcome.update, {
    apkSizeBytes: 50 * 1024 * 1024,
    apkUrl: `${DOWNLOAD_BASE}wave-0.2.0.apk`,
    md5Url: `${DOWNLOAD_BASE}wave-0.2.0.apk.md5`,
    notes: 'Fixes and improvements.',
    versionCode: 300,
    versionName: '0.2.0',
  });
});

test('equal and older version codes report up to date', () => {
  assert.deepEqual(parseLatestReleasePayload(release(), 300), {
    kind: 'up-to-date',
  });
  assert.deepEqual(parseLatestReleasePayload(release(), 999), {
    kind: 'up-to-date',
  });
});

test('an up-to-date verdict never requires assets', () => {
  assert.deepEqual(parseLatestReleasePayload(release({ assets: [] }), 300), {
    kind: 'up-to-date',
  });
});

test('malformed payloads are rejected with the user-safe copy', () => {
  const cases: unknown[] = [
    null,
    'v0.2.0-300',
    [],
    release({ draft: true }),
    release({ prerelease: true }),
    release({ tag_name: 'v0.2.0' }),
    release({ tag_name: 'release-300' }),
    release({ tag_name: 'v0.2.0-0' }),
    release({ tag_name: 'v0.2.0-2100000001' }),
    release({ tag_name: 42 }),
    release({ assets: [] }),
    release({ assets: 'none' }),
    release({ assets: [asset('other.apk')] }),
  ];
  for (const payload of cases) {
    assert.throws(
      () => parseLatestReleasePayload(payload, 233),
      new Error(UPDATE_FEED_ERROR_COPY),
      `expected rejection for ${JSON.stringify(payload)?.slice(0, 80)}`,
    );
  }
});

test('an APK asset with a foreign download URL is hostile, not usable', () => {
  const hostile = release({
    assets: [
      asset('wave-0.2.0.apk', {
        browser_download_url: 'https://evil.example/wave-0.2.0.apk',
      }),
    ],
  });
  assert.throws(
    () => parseLatestReleasePayload(hostile, 233),
    new Error(UPDATE_FEED_ERROR_COPY),
  );
});

test('APK size must be a bounded positive integer', () => {
  for (const size of [0, -5, 1.5, '50', 400 * 1024 * 1024, Number.NaN]) {
    assert.throws(
      () =>
        parseLatestReleasePayload(
          release({ assets: [asset('wave-0.2.0.apk', { size })] }),
          233,
        ),
      new Error(UPDATE_FEED_ERROR_COPY),
      `expected rejection for size ${String(size)}`,
    );
  }
});

test('the APK asset must appear within the scanned-asset bound', () => {
  const padding = Array.from({ length: 30 }, (_, index) =>
    asset(`noise-${index}.txt`, { size: 10 }),
  );
  assert.throws(
    () =>
      parseLatestReleasePayload(
        release({ assets: [...padding, asset('wave-0.2.0.apk')] }),
        233,
      ),
    new Error(UPDATE_FEED_ERROR_COPY),
  );
});

test('the md5 sidecar is optional and its absence drops the field', () => {
  const outcome = parseLatestReleasePayload(
    release({ assets: [asset('wave-0.2.0.apk')] }),
    233,
  );
  assert.equal(outcome.kind, 'update');
  if (outcome.kind !== 'update') return;
  assert.equal('md5Url' in outcome.update, false);
});

test('release notes are sanitized, inert, and bounded', () => {
  const noisy =
    'Line one\r\nLine two \u0007\u0000with control chars\r\n\ttabbed';
  const outcome = parseLatestReleasePayload(release({ body: noisy }), 233);
  assert.equal(outcome.kind, 'update');
  if (outcome.kind !== 'update') return;
  assert.equal(
    outcome.update.notes,
    'Line one\nLine two with control chars\n\ttabbed',
  );

  const flooded = parseLatestReleasePayload(
    release({ body: 'x'.repeat(20_000) }),
    233,
  );
  assert.equal(flooded.kind, 'update');
  if (flooded.kind !== 'update') return;
  assert.equal(flooded.update.notes.length, 4_001);
  assert.ok(flooded.update.notes.endsWith('…'));

  const missing = parseLatestReleasePayload(release({ body: 42 }), 233);
  assert.equal(missing.kind, 'update');
  if (missing.kind !== 'update') return;
  assert.equal(missing.update.notes, '');
});

test('a nonsensical installed version code is rejected', () => {
  for (const installed of [0, -1, 1.5, Number.NaN]) {
    assert.throws(
      () => parseLatestReleasePayload(release(), installed),
      new Error(UPDATE_FEED_ERROR_COPY),
    );
  }
});
