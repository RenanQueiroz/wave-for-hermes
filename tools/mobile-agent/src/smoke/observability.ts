import { ANDROID_PACKAGE, type MobileAgentConfig } from '../config.js';
import { runDoctor } from '../doctor.js';
import { callToolText, connectMobileAgentClient } from '../mcp/client.js';
import type { InspectorTarget, MobilePlatform } from '../types.js';

export interface ObservabilitySmokeReport {
  ok: boolean;
  platform: MobilePlatform;
  targetId: string;
  marker: string;
  connected: boolean;
  logObserved: boolean;
  networkObserved: boolean;
  stateProviderObserved: boolean;
  stateRead: boolean;
  nativeLogsRead: boolean;
  requestId?: string;
}

export async function runObservabilitySmoke(
  config: MobileAgentConfig,
  options: { platform?: MobilePlatform; targetId?: string } = {},
): Promise<ObservabilitySmokeReport> {
  const marker = `wave-mobile-agent-probe-${Date.now()}`;
  let doctor = await runDoctor(config);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (
      doctor.metro.selected?.targets.some(
        (candidate) =>
          candidate.appId === ANDROID_PACKAGE && candidate.webSocketDebuggerUrl,
      )
    ) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
    doctor = await runDoctor(config);
  }
  const metro = doctor.metro.selected;
  const targets =
    metro?.targets.filter(
      (candidate) =>
        candidate.appId === ANDROID_PACKAGE && candidate.webSocketDebuggerUrl,
    ) ?? [];
  const target = selectTarget(targets, options.targetId);
  if (!metro || !target?.webSocketDebuggerUrl) {
    throw new Error(
      'Wave must be connected to a Metro Hermes inspector target.',
    );
  }
  const platform = selectPlatform(doctor.readyPlatforms, options.platform);
  const report: ObservabilitySmokeReport = {
    ok: false,
    marker,
    platform,
    targetId: target.id,
    connected: false,
    logObserved: false,
    networkObserved: false,
    stateProviderObserved: false,
    stateRead: false,
    nativeLogsRead: false,
  };

  const connection = await connectMobileAgentClient(config, {
    forwardStderr: true,
    extraEnv: { MOBILE_AGENT_OBSERVABILITY_TARGET_ID: target.id },
  });
  try {
    const statusResult = await callToolText(
      connection.client,
      'mobile_observability_status',
    );
    assertToolSucceeded('observability-status', statusResult);
    const status = parseJsonObject(statusResult.text, 'observability status');
    report.connected = status.state === 'connected';
    if (!report.connected) {
      throw new Error(
        `Observability did not connect: ${status.error ?? 'unknown error'}`,
      );
    }

    const cleared = await callToolText(
      connection.client,
      'mobile_clear_observability',
    );
    assertToolSucceeded('clear-observability', cleared);

    const probeResult = await callToolText(
      connection.client,
      'mobile_run_observability_probe',
      { marker },
    );
    assertToolSucceeded('emit-observability-probe', probeResult);

    let lastReadError: string | undefined;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const [logsResult, requestsResult] = await Promise.all([
        callToolText(connection.client, 'mobile_get_logs', { limit: 100 }),
        callToolText(connection.client, 'mobile_get_network_requests', {
          urlContains: marker,
          limit: 20,
        }),
      ]);
      if (logsResult.isError || requestsResult.isError) {
        lastReadError = logsResult.isError
          ? logsResult.text
          : requestsResult.text;
        await new Promise((resolve) => setTimeout(resolve, 250));
        continue;
      }
      const logs = parseJsonObject(logsResult.text, 'logs');
      const requests = parseJsonObject(requestsResult.text, 'network requests');
      report.logObserved =
        Array.isArray(logs.entries) &&
        logs.entries.some(
          (entry) =>
            entry &&
            typeof entry === 'object' &&
            String((entry as Record<string, unknown>).text).includes(marker),
        );
      const matchingRequest = Array.isArray(requests.requests)
        ? requests.requests.find(
            (request) =>
              request &&
              typeof request === 'object' &&
              String((request as Record<string, unknown>).url).includes(marker),
          )
        : undefined;
      report.networkObserved = Boolean(matchingRequest);
      if (matchingRequest && typeof matchingRequest === 'object') {
        const requestId = (matchingRequest as Record<string, unknown>)
          .requestId;
        if (typeof requestId === 'string') report.requestId = requestId;
      }
      if (report.logObserved && report.networkObserved) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    report.ok =
      report.connected && report.logObserved && report.networkObserved;
    if (!report.ok) {
      throw new Error(
        `Observability probe incomplete: logObserved=${report.logObserved}, networkObserved=${report.networkObserved}.${lastReadError ? ` Last error: ${lastReadError}` : ''}`,
      );
    }

    for (let attempt = 0; attempt < 20; attempt += 1) {
      const providersResult = await callToolText(
        connection.client,
        'mobile_list_state_providers',
      );
      if (!providersResult.isError) {
        const providers = parseJsonObject(
          providersResult.text,
          'state providers',
        ).providers;
        report.stateProviderObserved =
          Array.isArray(providers) && providers.includes('app-shell');
        if (report.stateProviderObserved) break;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!report.stateProviderObserved) {
      throw new Error(
        'The development app did not register the app-shell state provider.',
      );
    }
    const stateResult = await callToolText(
      connection.client,
      'mobile_read_state',
      {
        provider: 'app-shell',
      },
    );
    assertToolSucceeded('read-state', stateResult);
    const state = parseJsonObject(stateResult.text, 'state result');
    const value = asRecord(state.value);
    report.stateRead =
      value?.platform === platform &&
      (value.colorScheme === 'light' ||
        value.colorScheme === 'dark' ||
        value.colorScheme === null);
    if (!report.stateRead) {
      throw new Error(
        `The app-shell state provider returned unexpected data: ${stateResult.text}`,
      );
    }
    const nativeLogsResult = await callToolText(
      connection.client,
      'mobile_get_native_logs',
      {
        platform,
        sinceSeconds: 600,
        limit: 10,
      },
    );
    assertToolSucceeded('read-native-logs', nativeLogsResult);
    const nativeLogs = parseJsonObject(nativeLogsResult.text, 'native logs');
    report.nativeLogsRead =
      nativeLogs.platform === platform &&
      typeof nativeLogs.processId === 'number' &&
      Array.isArray(nativeLogs.entries);
    if (!report.nativeLogsRead) {
      throw new Error(
        `The ${platform} native log response was invalid: ${nativeLogsResult.text}`,
      );
    }
    report.ok =
      report.ok &&
      report.stateProviderObserved &&
      report.stateRead &&
      report.nativeLogsRead;
    return report;
  } finally {
    await connection.close();
  }
}

function selectPlatform(
  readyPlatforms: MobilePlatform[],
  requested: MobilePlatform | undefined,
): MobilePlatform {
  if (requested) {
    if (!readyPlatforms.includes(requested)) {
      throw new Error(
        `${requested} is not ready. Ready platforms: ${readyPlatforms.join(', ') || 'none'}.`,
      );
    }
    return requested;
  }
  if (readyPlatforms.length !== 1 || !readyPlatforms[0]) {
    throw new Error(
      `Select --platform when ${readyPlatforms.length === 0 ? 'no platform is ready' : 'multiple platforms are ready'}.`,
    );
  }
  return readyPlatforms[0];
}

function selectTarget(
  targets: InspectorTarget[],
  requestedId: string | undefined,
): InspectorTarget | undefined {
  if (requestedId) {
    const target = targets.find((candidate) => candidate.id === requestedId);
    if (!target) {
      throw new Error(
        `Hermes target ${requestedId} is unavailable. Available IDs: ${targets.map((candidate) => candidate.id).join(', ') || 'none'}.`,
      );
    }
    return target;
  }
  if (targets.length > 1) {
    throw new Error(
      `Multiple Wave Hermes targets are connected. Pass --target-id with one of: ${targets.map((candidate) => candidate.id).join(', ')}.`,
    );
  }
  return targets[0];
}

function assertToolSucceeded(
  step: string,
  result: { isError: boolean; text: string },
): void {
  if (result.isError) throw new Error(`${step} failed: ${result.text}`);
}

function parseJsonObject(text: string, label: string): Record<string, unknown> {
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`The ${label} response was not a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
