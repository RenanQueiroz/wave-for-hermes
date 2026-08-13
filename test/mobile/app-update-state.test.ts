import assert from 'node:assert/strict';
import test from 'node:test';

import {
  APP_UPDATE_IDLE,
  appUpdateReducer,
  downloadFraction,
  formatUpdateSize,
  formatUpdateVersion,
  isUpdateSheetPresented,
  type AppUpdateEvent,
  type AppUpdateState,
} from '../../src/features/updates/app-update.shared.ts';
import type { WaveAppUpdate } from '../../src/services/updates/github-release-feed.ts';

const update: WaveAppUpdate = {
  apkSizeBytes: 60 * 1024 * 1024,
  apkUrl:
    'https://github.com/RenanQueiroz/wave-for-hermes/releases/download/v0.2.0-300/wave-0.2.0.apk',
  notes: 'Notes.',
  versionCode: 300,
  versionName: '0.2.0',
};

function run(events: AppUpdateEvent[], from: AppUpdateState = APP_UPDATE_IDLE) {
  return events.reduce(appUpdateReducer, from);
}

test('the happy path walks idle to ready', () => {
  const state = run([
    { type: 'check-started', trigger: 'auto' },
    { type: 'check-completed', outcome: { kind: 'update', update } },
    { type: 'download-started' },
    { type: 'download-progress', progress: 0.4 },
    { type: 'download-completed' },
    { type: 'verified' },
  ]);
  assert.deepEqual(state, { phase: 'ready', update });
});

test('manual up-to-date shows the sheet; auto stays silent', () => {
  const manual = run([
    { type: 'check-started', trigger: 'manual' },
    { type: 'check-completed', outcome: { kind: 'up-to-date' } },
  ]);
  assert.deepEqual(manual, { phase: 'up-to-date' });
  assert.equal(isUpdateSheetPresented(manual), true);

  const auto = run([
    { type: 'check-started', trigger: 'auto' },
    { type: 'check-completed', outcome: { kind: 'up-to-date' } },
  ]);
  assert.deepEqual(auto, APP_UPDATE_IDLE);
});

test('check failures surface only for manual checks', () => {
  const manual = run([
    { type: 'check-started', trigger: 'manual' },
    { type: 'check-failed', message: 'nope' },
  ]);
  assert.deepEqual(manual, { phase: 'error', message: 'nope' });

  const auto = run([
    { type: 'check-started', trigger: 'auto' },
    { type: 'check-failed', message: 'nope' },
  ]);
  assert.deepEqual(auto, APP_UPDATE_IDLE);
});

test('a manual checking sheet is visible; an auto check is not', () => {
  assert.equal(
    isUpdateSheetPresented({ phase: 'checking', trigger: 'manual' }),
    true,
  );
  assert.equal(
    isUpdateSheetPresented({ phase: 'checking', trigger: 'auto' }),
    false,
  );
  assert.equal(isUpdateSheetPresented(APP_UPDATE_IDLE), false);
});

test('dismissal resets every phase to idle', () => {
  const phases: AppUpdateState[] = [
    { phase: 'checking', trigger: 'manual' },
    { phase: 'up-to-date' },
    { phase: 'available', update },
    { phase: 'downloading', progress: 0.2, update },
    { phase: 'verifying', update },
    { phase: 'ready', update },
    { phase: 'error', message: 'x' },
  ];
  for (const state of phases) {
    assert.deepEqual(
      appUpdateReducer(state, { type: 'dismissed' }),
      APP_UPDATE_IDLE,
    );
  }
});

test('stale async events cannot corrupt the flow', () => {
  const cases: [AppUpdateState, AppUpdateEvent][] = [
    [
      APP_UPDATE_IDLE,
      { type: 'check-completed', outcome: { kind: 'up-to-date' } },
    ],
    [APP_UPDATE_IDLE, { type: 'download-progress', progress: 0.5 }],
    [APP_UPDATE_IDLE, { type: 'verified' }],
    [{ phase: 'ready', update }, { type: 'download-completed' }],
    [{ phase: 'available', update }, { type: 'verified' }],
    [
      { phase: 'downloading', update },
      { type: 'check-started', trigger: 'manual' },
    ],
    [
      { phase: 'verifying', update },
      { type: 'check-started', trigger: 'auto' },
    ],
    [
      { phase: 'ready', update },
      { type: 'check-started', trigger: 'manual' },
    ],
    [APP_UPDATE_IDLE, { type: 'failed', message: 'x' }],
  ];
  for (const [state, event] of cases) {
    assert.equal(appUpdateReducer(state, event), state);
  }
});

test('a re-check is allowed from settled phases', () => {
  for (const state of [
    APP_UPDATE_IDLE,
    { phase: 'up-to-date' } as const,
    { phase: 'available', update } as const,
    { phase: 'error', message: 'x' } as const,
  ]) {
    assert.deepEqual(
      appUpdateReducer(state, { type: 'check-started', trigger: 'manual' }),
      { phase: 'checking', trigger: 'manual' },
    );
  }
});

test('failures during download, verify, and install surface as errors', () => {
  for (const state of [
    { phase: 'downloading', update } as const,
    { phase: 'verifying', update } as const,
    { phase: 'ready', update } as const,
    { phase: 'available', update } as const,
  ]) {
    assert.deepEqual(
      appUpdateReducer(state, { type: 'failed', message: 'boom' }),
      {
        phase: 'error',
        message: 'boom',
      },
    );
  }
});

test('download progress helper clamps and degrades', () => {
  assert.equal(downloadFraction(30, 60, 50), 0.5);
  assert.equal(downloadFraction(30, -1, 60), 0.5);
  assert.equal(downloadFraction(120, -1, 60), 1);
  assert.equal(downloadFraction(10, -1, 0), undefined);
  assert.equal(downloadFraction(-1, 60, 60), undefined);
});

test('formatting helpers are stable', () => {
  assert.equal(formatUpdateVersion(update), '0.2.0 (300)');
  assert.equal(formatUpdateSize(60 * 1024 * 1024), '60.0 MB');
  assert.equal(formatUpdateSize(150 * 1024 * 1024), '150 MB');
});
