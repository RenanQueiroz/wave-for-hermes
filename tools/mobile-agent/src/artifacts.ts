import { readdir, rm, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';

import type { MobileAgentConfig } from './config.js';

export interface ArtifactRetentionReport {
  traceRoot: string;
  dryRun: boolean;
  retained: string[];
  eligible: Array<{
    path: string;
    reason: 'age' | 'count';
  }>;
  removed: string[];
}

export async function pruneActionTraces(
  config: MobileAgentConfig,
  options: { dryRun: boolean; now?: number },
): Promise<ArtifactRetentionReport> {
  const traceRoot = resolve(config.artifactsDir, 'traces');
  const report: ArtifactRetentionReport = {
    traceRoot,
    dryRun: options.dryRun,
    retained: [],
    eligible: [],
    removed: [],
  };
  let entries;
  try {
    entries = await readdir(traceRoot, { withFileTypes: true });
  } catch (error: unknown) {
    if (isErrnoException(error) && error.code === 'ENOENT') return report;
    throw error;
  }

  const directories = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
      .map(async (entry) => {
        const path = join(traceRoot, entry.name);
        assertTraceTarget(traceRoot, path);
        return { path, modifiedAt: (await stat(path)).mtimeMs };
      }),
  );
  directories.sort((left, right) => right.modifiedAt - left.modifiedAt);
  const now = options.now ?? Date.now();
  const oldestAllowed = now - config.traceMaxAgeDays * 24 * 60 * 60 * 1_000;

  for (const [index, directory] of directories.entries()) {
    const reason =
      directory.modifiedAt < oldestAllowed
        ? 'age'
        : index >= config.traceMaxCount
          ? 'count'
          : undefined;
    if (!reason) {
      report.retained.push(directory.path);
      continue;
    }
    report.eligible.push({ path: directory.path, reason });
    if (!options.dryRun) {
      await rm(directory.path, { recursive: true, force: false });
      report.removed.push(directory.path);
    }
  }
  return report;
}

function assertTraceTarget(traceRoot: string, target: string): void {
  const relativeTarget = relative(traceRoot, target);
  if (
    !relativeTarget ||
    relativeTarget === '..' ||
    relativeTarget.startsWith(
      `..${process.platform === 'win32' ? '\\' : '/'}`,
    ) ||
    isAbsolute(relativeTarget)
  ) {
    throw new Error(`Refusing to prune unsafe trace target ${target}.`);
  }
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
