import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const forbiddenContractDependencies = new Set([
  '@expo/ui',
  '@openai/agents',
  '@rnrepo/expo-config-plugin',
  'expo',
  'fastify',
  'openai',
  'panelui-native',
  'react',
  'react-native',
  'react-native-webrtc',
  'uniwind',
]);
const forbiddenMobileDependencies = new Set([
  '@openai/agents',
  '@wave/companion',
  'fastify',
  'openai',
]);
const forbiddenMobileImports = [
  /(?:from|import\()\s*['"]@wave\/companion(?:\/|['"])/,
  /(?:from|import\()\s*['"]fastify(?:\/|['"])/,
  /(?:from|import\()\s*['"]openai(?:\/|['"])/,
  /(?:from|import\()\s*['"][^'"]*services\/hermes(?:\/|['"])/,
];
const forbiddenMobileStrings = [
  'HERMES_API_KEY',
  'HERMES_API_URL',
  'OPENAI_API_KEY',
];

const rootPackage = await readJson('package.json');
const contractsPackage = await readJson('packages/contracts/package.json');
const claudeGuide = await readFile(join(projectRoot, 'CLAUDE.md'), 'utf8');

for (const [name, command] of Object.entries(rootPackage.scripts ?? {})) {
  if (!/\b(?:eas|eas-cli(?:@\S+)?)\s+build\b/.test(command)) continue;
  if (!/(?:^|\s)--local(?:\s|$)/.test(command)) {
    throw new Error(
      `Root EAS build script ${name} must use --local; cloud builds are not allowed.`,
    );
  }
}

if (claudeGuide !== '@AGENTS.md\n') {
  throw new Error(
    'CLAUDE.md must contain exactly @AGENTS.md followed by a newline.',
  );
}

// The companion workspace retired in stage 5; its reappearance means an
// accidental resurrection rather than a deliberate one.
if (await exists(join(projectRoot, 'companion', 'package.json'))) {
  throw new Error(
    'The companion workspace was retired; remove companion/package.json.',
  );
}
for (const workspace of rootPackage.workspaces ?? []) {
  if (workspace.includes('companion')) {
    throw new Error(
      'The root manifest must not list the retired companion workspace.',
    );
  }
}

assertNoKeys(
  rootPackage.dependencies ?? {},
  forbiddenMobileDependencies,
  'mobile root dependencies',
);

const contractRuntimeDependencies = {
  ...(contractsPackage.dependencies ?? {}),
  ...(contractsPackage.optionalDependencies ?? {}),
  ...(contractsPackage.peerDependencies ?? {}),
};
assertNoKeys(
  contractRuntimeDependencies,
  forbiddenContractDependencies,
  'contract runtime dependencies',
);
const contractDependencyNames = Object.keys(contractRuntimeDependencies);
if (
  contractDependencyNames.length !== 1 ||
  contractDependencyNames[0] !== 'zod'
) {
  throw new Error(
    `Contract runtime dependencies must contain only zod; found: ${contractDependencyNames.join(', ') || 'none'}.`,
  );
}

const mobileFiles = await listFiles(join(projectRoot, 'src'));
for (const file of mobileFiles.filter((candidate) =>
  /\.[cm]?[jt]sx?$/.test(candidate),
)) {
  const source = await readFile(file, 'utf8');
  for (const pattern of forbiddenMobileImports) {
    if (pattern.test(source)) {
      throw new Error(
        `Mobile source imports a server-only module: ${relative(projectRoot, file)}.`,
      );
    }
  }
  for (const value of forbiddenMobileStrings) {
    if (source.includes(value)) {
      throw new Error(
        `Mobile source contains server-only configuration ${value}: ${relative(projectRoot, file)}.`,
      );
    }
  }
}

const productionExport = join(
  projectRoot,
  '.mobile-agent',
  'production-export',
);
if (await exists(productionExport)) {
  const bundleFiles = (await listFiles(productionExport)).filter((file) =>
    /\.(?:hbc|js|json)$/.test(file),
  );
  const forbiddenBundleStrings = [
    '@wave/companion',
    'HERMES_API_KEY',
    'HERMES_API_URL',
    'HttpHermesClient',
    'OPENAI_API_KEY',
  ];
  for (const file of bundleFiles) {
    const contents = await readFile(file);
    for (const value of forbiddenBundleStrings) {
      if (contents.includes(Buffer.from(value))) {
        throw new Error(
          `Production mobile export contains server-only marker ${value}: ${relative(projectRoot, file)}.`,
        );
      }
    }
  }
}

console.log(
  `Workspace boundaries verified across ${mobileFiles.length} mobile files.`,
);

function assertNoKeys(dependencies, forbidden, label, allowed = new Set()) {
  const violations = Object.keys(dependencies).filter(
    (name) => forbidden.has(name) && !allowed.has(name),
  );
  if (violations.length > 0) {
    throw new Error(
      `${label} contains forbidden packages: ${violations.join(', ')}.`,
    );
  }
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error && error.code === 'ENOENT') return false;
    throw error;
  }
}

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(path)));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
}

async function readJson(path) {
  return JSON.parse(await readFile(join(projectRoot, path), 'utf8'));
}
