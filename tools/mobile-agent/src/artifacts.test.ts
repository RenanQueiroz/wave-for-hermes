import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, stat, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import test from 'node:test';

import { pruneActionTraces } from './artifacts.js';
import { loadConfig } from './config.js';

test('action-trace retention previews and removes only age/count overflow', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wave-mobile-agent-retention-'));
  const traces = join(root, 'traces');
  const now = Date.now();
  try {
    await Promise.all(
      [
        ['newest', now - 60 * 60 * 1_000],
        ['second', now - 2 * 60 * 60 * 1_000],
        ['count-overflow', now - 3 * 60 * 60 * 1_000],
        ['expired', now - 10 * 24 * 60 * 60 * 1_000],
      ].map(async ([name, modifiedAt]) => {
        if (typeof name !== 'string' || typeof modifiedAt !== 'number') return;
        const path = join(traces, name);
        await mkdir(path, { recursive: true });
        await utimes(path, modifiedAt / 1_000, modifiedAt / 1_000);
      }),
    );
    const config = loadConfig('/tmp/wave-mobile-agent-test', {
      NODE_ENV: 'test',
      MOBILE_AGENT_ARTIFACTS_DIR: root,
      MOBILE_AGENT_TRACE_MAX_COUNT: '2',
      MOBILE_AGENT_TRACE_MAX_AGE_DAYS: '7',
    });

    const preview = await pruneActionTraces(config, { dryRun: true, now });
    assert.deepEqual(
      preview.eligible.map(({ path, reason }) => [basename(path), reason]),
      [
        ['count-overflow', 'count'],
        ['expired', 'age'],
      ],
    );
    await stat(join(traces, 'expired'));

    const applied = await pruneActionTraces(config, { dryRun: false, now });
    assert.equal(applied.removed.length, 2);
    await assert.rejects(stat(join(traces, 'expired')), { code: 'ENOENT' });
    await stat(join(traces, 'newest'));
    await stat(join(traces, 'second'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
