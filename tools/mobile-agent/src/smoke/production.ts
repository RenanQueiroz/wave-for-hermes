import { readFile, readdir, rm } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';

import type { MobileAgentConfig } from '../config.js';
import { runCommand } from '../process.js';

const FORBIDDEN_BRIDGE_STRINGS = [
  '__WAVE_MOBILE_AGENT_STATE__',
  'Mobile-agent state provider',
  'app-shell',
] as const;

export interface ProductionBridgeSmokeReport {
  ok: boolean;
  outputDirectory: string;
  inspectedFiles: string[];
  forbiddenStrings: string[];
}

export async function runProductionBridgeSmoke(
  config: MobileAgentConfig,
): Promise<ProductionBridgeSmokeReport> {
  const outputDirectory = resolve(config.artifactsDir, 'production-export');
  const expectedPrefix = `${resolve(config.artifactsDir)}${sep}`;
  if (!outputDirectory.startsWith(expectedPrefix)) {
    throw new Error(
      'Production smoke output must remain inside the mobile-agent artifact directory.',
    );
  }
  await rm(outputDirectory, { recursive: true, force: true });

  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  for (const platform of ['ios', 'android'] as const) {
    const platformOutputDirectory = resolve(outputDirectory, platform);
    const exported = await runCommand(
      npx,
      [
        'expo',
        'export',
        '--platform',
        platform,
        '--output-dir',
        platformOutputDirectory,
        '--clear',
      ],
      {
        cwd: config.projectRoot,
        timeoutMs: 5 * 60_000,
        maxBuffer: 30 * 1024 * 1024,
        env: { ...process.env, NODE_ENV: 'production' },
      },
    );
    if (!exported.ok) {
      throw new Error(
        exported.stderr.trim() ||
          exported.stdout.trim() ||
          exported.error ||
          `Expo ${platform} export failed.`,
      );
    }
  }

  const files = await listFiles(outputDirectory);
  const inspectedFiles: string[] = [];
  const found = new Set<string>();
  for (const file of files) {
    if (!/\.(hbc|js|json|map)$/i.test(file)) continue;
    inspectedFiles.push(relative(outputDirectory, file));
    const contents = await readFile(file);
    for (const forbidden of FORBIDDEN_BRIDGE_STRINGS) {
      if (contents.includes(Buffer.from(forbidden))) found.add(forbidden);
    }
  }
  if (inspectedFiles.length === 0) {
    throw new Error(
      'The Expo production export did not contain an inspectable bundle.',
    );
  }
  return {
    ok: found.size === 0,
    outputDirectory,
    inspectedFiles,
    forbiddenStrings: [...found],
  };
}

async function listFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? await listFiles(path) : [path];
    }),
  );
  return nested.flat();
}
