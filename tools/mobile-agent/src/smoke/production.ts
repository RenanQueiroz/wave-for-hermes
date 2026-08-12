import { readFile, readdir, rm } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';

import type { MobileAgentConfig } from '../config.js';
import { runCommand } from '../process.js';

const FORBIDDEN_BRIDGE_STRINGS = [
  '__WAVE_MOBILE_AGENT_STATE__',
  'Mobile-agent state provider',
  'app-shell',
  // Nothing in the app reads env files; this name appearing in a bundle
  // means a key took a wrong turn at build time.
  'OPENAI_API_KEY',
  // Dev-only Realtime harness mode (src/dev/realtime-harness*): its
  // preference key, UI copy, and dummy-bearer marker must all be eliminated
  // from release bundles with the rest of the __DEV__-gated implementation.
  'wave.realtime-harness-url.v1',
  'Realtime harness',
  'sk-wave-harness',
] as const;

/**
 * Secret-shaped literals that must never ship in a bundle. The user-owned
 * OpenAI key lives only in platform secure storage; any `sk-…` literal in
 * exported output is a leak regardless of how it got there.
 */
const FORBIDDEN_SECRET_PATTERNS = [
  { label: 'openai-api-key-literal', pattern: /\bsk-[A-Za-z0-9_-]{24,}\b/ },
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
        env: {
          ...process.env,
          APP_VARIANT: 'production',
          NODE_ENV: 'production',
        },
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
    const text = contents.toString('utf8');
    for (const { label, pattern } of FORBIDDEN_SECRET_PATTERNS) {
      // Report the label, never the matched value.
      if (pattern.test(text)) found.add(label);
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
