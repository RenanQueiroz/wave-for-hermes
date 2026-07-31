import { runCommand } from '../process.js';
import type {
  Diagnostic,
  InspectorTarget,
  MetroDiscovery,
  MetroServer,
} from '../types.js';
import type { MobileAgentConfig } from '../config.js';

interface RawInspectorTarget {
  id?: unknown;
  title?: unknown;
  description?: unknown;
  appId?: unknown;
  deviceName?: unknown;
  webSocketDebuggerUrl?: unknown;
  reactNative?: {
    capabilities?: {
      supportsMultipleDebuggers?: unknown;
    };
  };
}

export async function discoverMetro(
  config: MobileAgentConfig,
): Promise<MetroDiscovery> {
  const diagnostics: Diagnostic[] = [];
  const urls = await candidateMetroUrls(config);
  const servers = (
    await Promise.all(urls.map(async (url) => await probeMetro(url)))
  ).filter((server): server is MetroServer => server !== undefined);
  const withWave = servers.filter((server) =>
    server.targets.some((target) => target.appId === 'com.renanqueiroz.wave'),
  );
  let selected: MetroServer | undefined;

  if (withWave.length === 1) {
    selected = withWave[0];
  } else if (withWave.length > 1) {
    diagnostics.push({
      code: 'MULTIPLE_WAVE_METRO_SERVERS',
      status: 'warning',
      message: `Found ${withWave.length} Metro servers with a Wave inspector target.`,
      recovery: 'Set MOBILE_AGENT_METRO_URL to the Radon-managed Metro URL.',
    });
  } else if (servers.length === 1) {
    selected = servers[0];
  }

  if (!selected) {
    diagnostics.push({
      code: servers.length === 0 ? 'METRO_NOT_FOUND' : 'CDP_TARGET_NOT_FOUND',
      status: 'error',
      message:
        servers.length === 0
          ? 'No running Metro server was discovered.'
          : 'Metro is running, but no unique Wave inspector target was found.',
      recovery:
        'Keep the Wave development build connected in Radon, or set MOBILE_AGENT_METRO_URL explicitly.',
    });
  } else {
    const target = selected.targets.find(
      (candidate) => candidate.appId === 'com.renanqueiroz.wave',
    );
    diagnostics.push({
      code: target ? 'METRO_AND_CDP_READY' : 'METRO_READY',
      status: target ? 'ok' : 'warning',
      message: target
        ? `Metro at ${selected.url} exposes the Wave Hermes inspector target.`
        : `Metro at ${selected.url} is running without a Wave Hermes inspector target.`,
    });
  }

  return {
    servers,
    ...(selected ? { selected } : {}),
    diagnostics,
  };
}

export async function candidateMetroUrls(
  config: MobileAgentConfig,
): Promise<string[]> {
  if (config.metroUrl) {
    return [normalizeBaseUrl(config.metroUrl)];
  }

  const urls = new Set<string>();
  urls.add('http://127.0.0.1:8081');

  const ports = await listeningNodePorts();
  for (const port of ports) {
    urls.add(`http://127.0.0.1:${port}`);
  }
  return [...urls];
}

async function listeningNodePorts(): Promise<number[]> {
  if (process.platform === 'win32') {
    const result = await runCommand('netstat', ['-ano', '-p', 'tcp'], {
      timeoutMs: 5_000,
    });
    if (!result.ok) {
      return [];
    }
    return uniquePorts(
      result.stdout
        .split(/\r?\n/)
        .filter((line) => /\bLISTENING\b/.test(line))
        .map((line) => Number.parseInt(line.match(/:(\d+)\s+/)?.[1] ?? '', 10)),
    );
  }

  const result = await runCommand(
    'lsof',
    ['-nP', '-a', '-c', 'node', '-iTCP', '-sTCP:LISTEN', '-F', 'n'],
    { timeoutMs: 5_000 },
  );
  if (!result.ok) {
    return [];
  }
  return uniquePorts(
    result.stdout
      .split(/\r?\n/)
      .map((line) => Number.parseInt(line.match(/:(\d+)$/)?.[1] ?? '', 10)),
  );
}

function uniquePorts(values: number[]): number[] {
  return [
    ...new Set(
      values.filter(
        (value) => Number.isInteger(value) && value > 0 && value <= 65_535,
      ),
    ),
  ].slice(0, 100);
}

async function probeMetro(url: string): Promise<MetroServer | undefined> {
  try {
    const statusResponse = await fetch(`${url}/status`, {
      signal: AbortSignal.timeout(750),
    });
    if (!statusResponse.ok) {
      return undefined;
    }
    const status = (await statusResponse.text()).trim();
    if (status !== 'packager-status:running') {
      return undefined;
    }

    let targets: InspectorTarget[] = [];
    try {
      const response = await fetch(`${url}/json/list`, {
        signal: AbortSignal.timeout(1_500),
      });
      if (response.ok) {
        const raw = (await response.json()) as RawInspectorTarget[];
        targets = raw
          .map(normalizeInspectorTarget)
          .filter((target): target is InspectorTarget => target !== undefined);
      }
    } catch {
      // Metro can be ready before an inspector target is connected.
    }

    const parsed = new URL(url);
    return {
      url,
      port: Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80)),
      status,
      targets,
    };
  } catch {
    return undefined;
  }
}

function normalizeInspectorTarget(
  raw: RawInspectorTarget,
): InspectorTarget | undefined {
  if (typeof raw.id !== 'string') {
    return undefined;
  }
  return {
    id: raw.id,
    ...(typeof raw.title === 'string' ? { title: raw.title } : {}),
    ...(typeof raw.description === 'string'
      ? { description: raw.description }
      : {}),
    ...(typeof raw.appId === 'string' ? { appId: raw.appId } : {}),
    ...(typeof raw.deviceName === 'string'
      ? { deviceName: raw.deviceName }
      : {}),
    ...(typeof raw.webSocketDebuggerUrl === 'string'
      ? { webSocketDebuggerUrl: raw.webSocketDebuggerUrl }
      : {}),
    ...(typeof raw.reactNative?.capabilities?.supportsMultipleDebuggers ===
    'boolean'
      ? {
          supportsMultipleDebuggers:
            raw.reactNative.capabilities.supportsMultipleDebuggers,
        }
      : {}),
  };
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '');
}
