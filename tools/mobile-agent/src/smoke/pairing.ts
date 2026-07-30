import { capabilitiesFor } from '../capabilities.js';
import type { MobileAgentConfig } from '../config.js';
import { runDoctor } from '../doctor.js';
import {
  callToolText,
  connectMobileAgentClient,
  type ToolTextResult,
} from '../mcp/client.js';
import type { MobilePlatform } from '../types.js';
import { ensureSimulatorWda } from '../wda.js';

const CONNECTION_SUCCESS_ID = 'connection-success';
const DISCONNECT_BUTTON_ID = 'disconnect-device-button';
const PAIR_BUTTON_ID = 'pair-device-button';

interface PairingSmokeOptions {
  baseUrl: string;
  code: string;
  platform: MobilePlatform;
}

export interface PairingSmokeReport {
  localDisconnectVerified: boolean;
  ok: boolean;
  platform: MobilePlatform;
  restoredAfterRestart: boolean;
  sessionCreated: boolean;
  sessionDeleted: boolean;
  steps: Array<{
    detail: string;
    name: string;
    ok: boolean;
  }>;
}

export async function runPairingSmoke(
  config: MobileAgentConfig,
  options: PairingSmokeOptions,
): Promise<PairingSmokeReport> {
  assertPairingInput(options);
  const report: PairingSmokeReport = {
    localDisconnectVerified: false,
    ok: false,
    platform: options.platform,
    restoredAfterRestart: false,
    sessionCreated: false,
    sessionDeleted: false,
    steps: [],
  };
  const doctor = await runDoctor(config);
  if (!doctor.readyPlatforms.includes(options.platform)) {
    throw new Error(
      `${options.platform} is not ready. Keep Wave open in Radon and set an explicit Metro URL when both platforms are running.`,
    );
  }
  const capabilities =
    options.platform === 'ios'
      ? capabilitiesFor(doctor, 'ios', {
          prebuiltWdaPath: (await ensureSimulatorWda(config)).appPath,
        })
      : capabilitiesFor(doctor, 'android');
  const connection = await connectMobileAgentClient(config);
  let sessionId: string | undefined;

  try {
    const created = await callToolText(
      connection.client,
      'appium_session_management',
      {
        action: 'create',
        capabilities: JSON.stringify(capabilities),
        platform: options.platform,
      },
      10 * 60_000,
    );
    assertToolSucceeded('create-session', created);
    sessionId = readSessionId(created.text);
    report.sessionCreated = true;
    report.steps.push({
      detail: `Created a non-destructive ${options.platform} native session.`,
      name: 'create-session',
      ok: true,
    });

    await lifecycle(connection.client, sessionId, 'terminate');
    await lifecycle(connection.client, sessionId, 'activate');
    await waitForNode(
      connection.client,
      sessionId,
      options.platform,
      PAIR_BUTTON_ID,
    );
    await replaceNodeText(
      connection.client,
      sessionId,
      options.platform,
      'companion-url-input',
      options.baseUrl,
    );
    await revealNextPairingField(
      connection.client,
      sessionId,
      options.platform,
    );
    await replaceNodeText(
      connection.client,
      sessionId,
      options.platform,
      'device-name-input',
      `Wave ${options.platform} pairing smoke`,
    );
    await revealNextPairingField(
      connection.client,
      sessionId,
      options.platform,
    );
    await replaceNodeText(
      connection.client,
      sessionId,
      options.platform,
      'pairing-code-input',
      options.code,
    );
    await revealNextPairingField(
      connection.client,
      sessionId,
      options.platform,
    );
    report.steps.push({
      detail:
        'Entered the fixture URL, device name, and one-time code without action traces.',
      name: 'enter-pairing',
      ok: true,
    });

    await submitPairing(
      connection.client,
      sessionId,
      options.platform,
    );
    await waitForNode(
      connection.client,
      sessionId,
      options.platform,
      CONNECTION_SUCCESS_ID,
      false,
      60,
    );
    report.steps.push({
      detail:
        'Redeemed the one-time code and passed the authenticated compatibility check.',
      name: 'pair',
      ok: true,
    });

    const state = await callToolText(
      connection.client,
      'mobile_read_state',
      {
        provider: 'wave-connection',
      },
    );
    assertToolSucceeded('read-connection-state', state);
    if (/\b(authorization|credential|token)\b/i.test(state.text)) {
      throw new Error(
        'The development connection summary exposed a sensitive field name.',
      );
    }
    report.steps.push({
      detail:
        'Verified that development state contains only the public connection summary.',
      name: 'secret-free-state',
      ok: true,
    });

    await lifecycle(connection.client, sessionId, 'terminate');
    await lifecycle(connection.client, sessionId, 'activate');
    await waitForNode(
      connection.client,
      sessionId,
      options.platform,
      CONNECTION_SUCCESS_ID,
      false,
      60,
    );
    report.restoredAfterRestart = true;
    report.steps.push({
      detail:
        'Terminated and relaunched Wave; the secure connection restored and revalidated.',
      name: 'restore-after-restart',
      ok: true,
    });

    await tapNode(
      connection.client,
      sessionId,
      options.platform,
      DISCONNECT_BUTTON_ID,
    );
    await waitForNode(
      connection.client,
      sessionId,
      options.platform,
      PAIR_BUTTON_ID,
      true,
    );
    report.localDisconnectVerified = true;
    report.steps.push({
      detail:
        'Cleared the local secure connection and returned to the pairing screen.',
      name: 'local-disconnect',
      ok: true,
    });

    report.ok = true;
    return report;
  } finally {
    if (sessionId) {
      const deleted = await callToolText(
        connection.client,
        'appium_session_management',
        {
          action: 'delete',
          sessionId,
        },
        120_000,
      ).catch((error: unknown) => ({
        isError: true,
        raw: undefined,
        text: error instanceof Error ? error.message : String(error),
      }));
      report.sessionDeleted = !deleted.isError;
      report.steps.push({
        detail: report.sessionDeleted
          ? 'Deleted the owned native automation session.'
          : 'Could not delete the owned native automation session.',
        name: 'delete-session',
        ok: report.sessionDeleted,
      });
    }
    await connection.close();
  }
}

function assertPairingInput(options: PairingSmokeOptions) {
  const url = new URL(options.baseUrl);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('MOBILE_AGENT_PAIRING_URL must use HTTP or HTTPS.');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error(
      'MOBILE_AGENT_PAIRING_URL cannot contain credentials, a query, or a fragment.',
    );
  }
  if (!/^[A-Z2-9]{4}(?:-[A-Z2-9]{4}){3}$/.test(options.code)) {
    throw new Error(
      'MOBILE_AGENT_PAIRING_CODE must use the XXXX-XXXX-XXXX-XXXX fixture format.',
    );
  }
}

async function lifecycle(
  client: Awaited<ReturnType<typeof connectMobileAgentClient>>['client'],
  sessionId: string,
  action: 'activate' | 'terminate',
) {
  const result = await callToolText(client, 'mobile_app_lifecycle', {
    action,
    captureTrace: false,
    sessionId,
  });
  assertToolSucceeded(action, result);
}

async function revealNextPairingField(
  client: Awaited<ReturnType<typeof connectMobileAgentClient>>['client'],
  sessionId: string,
  platform: MobilePlatform,
) {
  if (platform !== 'ios') return;
  const result = await callToolText(client, 'mobile_scroll', {
    captureTrace: false,
    direction: 'up',
    distance: 0.16,
    durationMs: 300,
    sessionId,
  });
  assertToolSucceeded('reveal-next-pairing-field', result);
}

async function submitPairing(
  client: Awaited<ReturnType<typeof connectMobileAgentClient>>['client'],
  sessionId: string,
  platform: MobilePlatform,
) {
  if (platform === 'android') {
    await tapNode(client, sessionId, platform, PAIR_BUTTON_ID);
    return;
  }
  const result = await callToolText(client, 'appium_perform_actions', {
    actions: [
      {
        type: 'key',
        id: 'pairing-submit',
        actions: [
          { type: 'keyDown', value: '\uE007' },
          { type: 'keyUp', value: '\uE007' },
        ],
      },
    ],
    sessionId,
  });
  assertToolSucceeded('submit-pairing', result);
}

async function replaceNodeText(
  client: Awaited<ReturnType<typeof connectMobileAgentClient>>['client'],
  sessionId: string,
  platform: MobilePlatform,
  stableId: string,
  text: string,
) {
  const node = await waitForNode(client, sessionId, platform, stableId, true);
  const typed = await callToolText(client, 'mobile_type_text', {
    captureTrace: false,
    nodeId: node.nodeId,
    sessionId,
    snapshotId: node.snapshotId,
    text,
  });
  assertToolSucceeded(`type-${stableId}`, typed);
}

async function tapNode(
  client: Awaited<ReturnType<typeof connectMobileAgentClient>>['client'],
  sessionId: string,
  platform: MobilePlatform,
  stableId: string,
) {
  const node = await waitForNode(client, sessionId, platform, stableId, true);
  const tapped = await callToolText(client, 'mobile_tap', {
    allowCoordinateFallback: false,
    captureTrace: false,
    nodeId: node.nodeId,
    sessionId,
    snapshotId: node.snapshotId,
  });
  assertToolSucceeded(`tap-${stableId}`, tapped);
}

async function waitForNode(
  client: Awaited<ReturnType<typeof connectMobileAgentClient>>['client'],
  sessionId: string,
  platform: MobilePlatform,
  stableId: string,
  interactiveOnly = true,
  attempts = 30,
): Promise<{ nodeId: string; snapshotId: string }> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const found = await callToolText(
      client,
      'mobile_find_elements',
      {
        ...(platform === 'ios'
          ? { accessibilityId: stableId }
          : { resourceId: stableId }),
        exact: true,
        interactiveOnly,
        maxResults: 5,
        sessionId,
      },
    );
    if (!found.isError) {
      const result = parseJsonObject(found.text, `${stableId} query`);
      const nodes = result.nodes;
      if (Array.isArray(nodes) && nodes.length === 1) {
        const node = nodes[0];
        if (node && typeof node === 'object' && !Array.isArray(node)) {
          return {
            nodeId: readString(
              node as Record<string, unknown>,
              'id',
            ),
            snapshotId: readString(result, 'snapshotId'),
          };
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Could not find ${stableId} on ${platform}.`);
}

function assertToolSucceeded(step: string, result: ToolTextResult) {
  if (result.isError) {
    throw new Error(`${step} failed: ${result.text}`);
  }
}

function parseJsonObject(
  text: string,
  label: string,
): Record<string, unknown> {
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`The ${label} response was not a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

function readSessionId(text: string) {
  const sessionId = text.match(/ID:\s*([^\s]+)/)?.[1];
  if (!sessionId) {
    throw new Error('Could not read the native session identifier.');
  }
  return sessionId;
}

function readString(value: Record<string, unknown>, key: string) {
  const result = value[key];
  if (typeof result !== 'string' || !result) {
    throw new Error(`Expected ${key} to be a non-empty string.`);
  }
  return result;
}
