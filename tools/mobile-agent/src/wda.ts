import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { arch, tmpdir } from 'node:os';
import { join } from 'node:path';

import type { MobileAgentConfig } from './config.js';
import { runCommand } from './process.js';

// Checksums of the prebuilt simulator runner published for the
// `appium-webdriveragent` release the installed `appium-xcuitest-driver`
// nests (12.7.0 → WebDriverAgent v16.5.1). Re-pin both when the driver moves.
const WDA_ASSETS = {
  arm64: {
    filename: 'WebDriverAgentRunner-Build-Sim-arm64.zip',
    sha256: '40104c4b16e87658dc0c0757186c67ee7d0d160843e14550ad23c1f0078890f3',
  },
  x64: {
    filename: 'WebDriverAgentRunner-Build-Sim-x86_64.zip',
    sha256: '04e1bef5ef489c9ca2bfd6c73c8de0432e4173da0d186482a4002c635511f8c6',
  },
} as const;

type SupportedArchitecture = keyof typeof WDA_ASSETS;

interface WdaBuildMetadata {
  appiumXcuitestDriverVersion: string;
  webDriverAgentVersion: string;
  architecture: SupportedArchitecture;
  sha256: string;
  sourceUrl: string;
}

export interface PreparedWda {
  appPath: string;
  downloaded: boolean;
  metadata: WdaBuildMetadata;
}

export async function ensureSimulatorWda(
  config: MobileAgentConfig,
): Promise<PreparedWda> {
  if (process.platform !== 'darwin') {
    throw new Error(
      'Preparing WebDriverAgent for an iOS Simulator requires macOS.',
    );
  }

  const packageInfo = resolveWdaPackageInfo();
  const architecture = supportedArchitecture();
  const asset = WDA_ASSETS[architecture];
  const sourceUrl = `https://github.com/appium/WebDriverAgent/releases/download/v${packageInfo.wdaVersion}/${asset.filename}`;
  const metadata: WdaBuildMetadata = {
    appiumXcuitestDriverVersion: packageInfo.driverVersion,
    webDriverAgentVersion: packageInfo.wdaVersion,
    architecture,
    sha256: asset.sha256,
    sourceUrl,
  };
  const appPath = expectedWdaAppPath(config);
  const metadataPath = join(
    config.artifactsDir,
    'wda-prebuilt',
    'wave-mobile-agent.json',
  );

  if (existsSync(appPath) && (await metadataMatches(metadataPath, metadata))) {
    return { appPath, downloaded: false, metadata };
  }

  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), 'wave-mobile-agent-wda-'),
  );
  try {
    const archivePath = join(temporaryDirectory, asset.filename);
    const extractedPath = join(temporaryDirectory, 'extracted');
    const downloaded = await runCommand(
      'curl',
      ['-fL', '--retry', '2', '--output', archivePath, sourceUrl],
      { timeoutMs: 2 * 60_000, maxBuffer: 5 * 1024 * 1024 },
    );
    if (!downloaded.ok) {
      throw new Error(
        downloaded.stderr.trim() ||
          downloaded.error ||
          `Failed to download ${sourceUrl}.`,
      );
    }

    const actualSha256 = createHash('sha256')
      .update(await readFile(archivePath))
      .digest('hex');
    if (actualSha256 !== asset.sha256) {
      throw new Error(
        `WebDriverAgent checksum mismatch. Expected ${asset.sha256}, received ${actualSha256}.`,
      );
    }

    await mkdir(extractedPath, { recursive: true });
    const extracted = await runCommand(
      'ditto',
      ['-x', '-k', archivePath, extractedPath],
      {
        timeoutMs: 60_000,
      },
    );
    if (!extracted.ok) {
      throw new Error(
        extracted.stderr.trim() ||
          extracted.error ||
          'Failed to extract WebDriverAgent.',
      );
    }

    const extractedApp = join(extractedPath, 'WebDriverAgentRunner-Runner.app');
    if (!existsSync(extractedApp)) {
      throw new Error(
        'The verified WebDriverAgent archive did not contain the expected runner app.',
      );
    }

    const destinationDirectory = join(config.artifactsDir, 'wda-prebuilt');
    await mkdir(destinationDirectory, { recursive: true });
    if (existsSync(appPath)) {
      await rm(appPath, { recursive: true });
    }
    await cp(extractedApp, appPath, { recursive: true });
    await writeFile(
      metadataPath,
      `${JSON.stringify(metadata, null, 2)}\n`,
      'utf8',
    );
    return { appPath, downloaded: true, metadata };
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

export function expectedWdaAppPath(config: MobileAgentConfig): string {
  return join(
    config.artifactsDir,
    'wda-prebuilt',
    'WebDriverAgentRunner-Runner.app',
  );
}

export function hasPreparedWda(config: MobileAgentConfig): boolean {
  return existsSync(expectedWdaAppPath(config));
}

async function metadataMatches(
  path: string,
  expected: WdaBuildMetadata,
): Promise<boolean> {
  try {
    const actual = JSON.parse(await readFile(path, 'utf8')) as WdaBuildMetadata;
    return (
      actual.appiumXcuitestDriverVersion ===
        expected.appiumXcuitestDriverVersion &&
      actual.webDriverAgentVersion === expected.webDriverAgentVersion &&
      actual.architecture === expected.architecture &&
      actual.sha256 === expected.sha256 &&
      actual.sourceUrl === expected.sourceUrl
    );
  } catch {
    return false;
  }
}

function resolveWdaPackageInfo(): {
  driverVersion: string;
  wdaVersion: string;
} {
  const require = createRequire(import.meta.url);
  const driverPackagePath =
    require.resolve('appium-xcuitest-driver/package.json');
  const driverPackage = require(driverPackagePath) as { version: string };
  const driverRequire = createRequire(driverPackagePath);
  const wdaPackagePath = driverRequire.resolve(
    'appium-webdriveragent/package.json',
  );
  const wdaPackage = driverRequire(wdaPackagePath) as { version: string };
  return {
    driverVersion: driverPackage.version,
    wdaVersion: wdaPackage.version,
  };
}

function supportedArchitecture(): SupportedArchitecture {
  const current = arch();
  if (current === 'arm64' || current === 'x64') {
    return current;
  }
  throw new Error(
    `No pinned WebDriverAgent simulator asset is available for architecture ${current}.`,
  );
}
