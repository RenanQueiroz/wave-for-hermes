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

const CHAT_COMPOSER_ID = 'chat-composer-input';
const CHAT_CANCELLATION_DELTA = 'Waiting for cancellation…';
const CHAT_CANCELLATION_PROMPT = 'Cancel the Wave chat fixture';
const CHAT_RESPONSE_TEXT = 'Fixture response from Hermes.';
const CHAT_STOP_BUTTON_ID = 'chat-stop-button';
const CHAT_TOOL_NAME = 'fixture_lookup';
const CONNECTION_SUCCESS_ID = 'connection-success';
const CONNECTION_DISCONNECT_BUTTON_ID = 'connection-disconnect-button';
const CREATE_SESSION_BUTTON_ID = 'create-session-button';
const DISCONNECT_BUTTON_ID = 'disconnect-device-button';
const PAIR_BUTTON_ID = 'pair-device-button';
const SEND_BUTTON_ID = 'chat-send-button';
const HIDDEN_TOOL_OUTPUT =
  'Development fixture tool output is intentionally hidden.';

interface PairingSmokeOptions {
  baseUrl: string;
  code: string;
  platform: MobilePlatform;
}

interface FoundNode {
  currentValue?: string;
  nodeId: string;
  snapshotId: string;
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

export interface ChatSmokeReport {
  cancellationVerified: boolean;
  historyRestoredAfterRestart: boolean;
  localDisconnectVerified: boolean;
  ok: boolean;
  platform: MobilePlatform;
  responseStreamed: boolean;
  sessionCreated: boolean;
  sessionDeleted: boolean;
  toolOutputHidden: boolean;
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
    writeSmokeProgress('pairing', 'creating native automation session');
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
    writeSmokeProgress('pairing', 'native automation session ready');
    report.sessionCreated = true;
    report.steps.push({
      detail: `Created a non-destructive ${options.platform} native session.`,
      name: 'create-session',
      ok: true,
    });

    await pairDevice(connection.client, sessionId, options, 'pairing');
    report.steps.push({
      detail:
        'Entered the fixture URL, device name, and one-time code without action traces.',
      name: 'enter-pairing',
      ok: true,
    });
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
      writeSmokeProgress('pairing', 'deleting native automation session');
      const deleted = await withCleanupTimeout(
        callToolText(
          connection.client,
          'appium_session_management',
          {
            action: 'delete',
            sessionId,
          },
          30_000,
        ),
        35_000,
        'native automation session deletion',
      ).catch((error: unknown) => ({
        isError: true,
        raw: undefined,
        text: error instanceof Error ? error.message : String(error),
      }));
      report.sessionDeleted = !deleted.isError;
      writeSmokeProgress(
        'pairing',
        report.sessionDeleted
          ? 'native automation session deleted'
          : 'native automation session deletion could not be confirmed',
      );
      report.steps.push({
        detail: report.sessionDeleted
          ? 'Deleted the owned native automation session.'
          : 'Could not delete the owned native automation session.',
        name: 'delete-session',
        ok: report.sessionDeleted,
      });
    }
    await closeConnection(connection, 'pairing');
  }
}

export async function runChatSmoke(
  config: MobileAgentConfig,
  options: PairingSmokeOptions,
): Promise<ChatSmokeReport> {
  assertPairingInput(options);
  const report: ChatSmokeReport = {
    cancellationVerified: false,
    historyRestoredAfterRestart: false,
    localDisconnectVerified: false,
    ok: false,
    platform: options.platform,
    responseStreamed: false,
    sessionCreated: false,
    sessionDeleted: false,
    steps: [],
    toolOutputHidden: false,
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
    writeSmokeProgress('chat', 'creating native automation session');
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
    writeSmokeProgress('chat', 'native automation session ready');
    report.sessionCreated = true;
    report.steps.push({
      detail: `Created a non-destructive ${options.platform} native session.`,
      name: 'create-session',
      ok: true,
    });

    await pairDevice(connection.client, sessionId, options, 'chat');
    writeSmokeProgress('chat', 'fixture pairing complete');
    report.steps.push({
      detail:
        'Paired with the development fixture and passed the authenticated compatibility check.',
      name: 'pair',
      ok: true,
    });

    await tapNode(
      connection.client,
      sessionId,
      options.platform,
      CREATE_SESSION_BUTTON_ID,
    );
    await waitForNode(
      connection.client,
      sessionId,
      options.platform,
      CHAT_COMPOSER_ID,
    );
    writeSmokeProgress('chat', 'fixture conversation ready');
    report.steps.push({
      detail: 'Created and opened a fixture-backed Hermes conversation.',
      name: 'create-conversation',
      ok: true,
    });

    await replaceNodeText(
      connection.client,
      sessionId,
      options.platform,
      CHAT_COMPOSER_ID,
      CHAT_CANCELLATION_PROMPT,
    );
    await submitChat(
      connection.client,
      sessionId,
      options.platform,
    );
    await waitForText(
      connection.client,
      sessionId,
      options.platform,
      CHAT_CANCELLATION_DELTA,
      false,
      120,
    );
    await tapNode(
      connection.client,
      sessionId,
      options.platform,
      CHAT_STOP_BUTTON_ID,
    );
    await waitForNode(
      connection.client,
      sessionId,
      options.platform,
      CHAT_COMPOSER_ID,
    );
    writeSmokeProgress('chat', 'active turn cancelled');
    report.cancellationVerified = true;
    report.steps.push({
      detail:
        'Cancelled an active fixture turn and returned the composer to a usable state.',
      name: 'cancel-turn',
      ok: true,
    });

    await replaceNodeText(
      connection.client,
      sessionId,
      options.platform,
      CHAT_COMPOSER_ID,
      'Run the Wave chat fixture',
    );
    await submitChat(
      connection.client,
      sessionId,
      options.platform,
    );
    await waitForText(
      connection.client,
      sessionId,
      options.platform,
      CHAT_RESPONSE_TEXT,
      false,
      120,
    );
    await waitForText(
      connection.client,
      sessionId,
      options.platform,
      CHAT_TOOL_NAME,
      false,
      30,
    );
    writeSmokeProgress('chat', 'assistant response and tool state streamed');
    report.responseStreamed = true;
    report.steps.push({
      detail:
        'Observed ordered assistant text and a sanitized PanelUI task lifecycle.',
      name: 'stream-turn',
      ok: true,
    });

    await assertTextAbsent(
      connection.client,
      sessionId,
      options.platform,
      HIDDEN_TOOL_OUTPUT,
    );
    report.toolOutputHidden = true;
    report.steps.push({
      detail:
        'Confirmed the fixture tool output is absent from the native accessibility tree.',
      name: 'hide-tool-output',
      ok: true,
    });

    await lifecycle(connection.client, sessionId, 'terminate');
    await lifecycle(connection.client, sessionId, 'activate');
    await waitForText(
      connection.client,
      sessionId,
      options.platform,
      CHAT_RESPONSE_TEXT,
      false,
      120,
    );
    await waitForText(
      connection.client,
      sessionId,
      options.platform,
      CHAT_TOOL_NAME,
      false,
      30,
    );
    writeSmokeProgress('chat', 'conversation history restored after relaunch');
    report.historyRestoredAfterRestart = true;
    report.steps.push({
      detail:
        'Relaunched Wave and restored the active conversation from normalized history.',
      name: 'restore-history',
      ok: true,
    });

    const back = await callToolText(connection.client, 'mobile_press_key', {
      captureTrace: false,
      key: 'back',
      sessionId,
    });
    assertToolSucceeded('navigate-back', back);
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
    );
    report.localDisconnectVerified = true;
    report.steps.push({
      detail:
        'Returned to the conversation list, cleared the local credential, and reached pairing.',
      name: 'local-disconnect',
      ok: true,
    });

    report.ok = true;
    return report;
  } finally {
    if (sessionId) {
      writeSmokeProgress('chat', 'deleting native automation session');
      const deleted = await withCleanupTimeout(
        callToolText(
          connection.client,
          'appium_session_management',
          {
            action: 'delete',
            sessionId,
          },
          30_000,
        ),
        35_000,
        'native automation session deletion',
      ).catch((error: unknown) => ({
        isError: true,
        raw: undefined,
        text: error instanceof Error ? error.message : String(error),
      }));
      report.sessionDeleted = !deleted.isError;
      writeSmokeProgress(
        'chat',
        report.sessionDeleted
          ? 'native automation session deleted'
          : 'native automation session deletion could not be confirmed',
      );
      report.steps.push({
        detail: report.sessionDeleted
          ? 'Deleted the owned native automation session.'
          : 'Could not delete the owned native automation session.',
        name: 'delete-session',
        ok: report.sessionDeleted,
      });
    }
    await closeConnection(connection, 'chat');
  }
}

async function pairDevice(
  client: Awaited<ReturnType<typeof connectMobileAgentClient>>['client'],
  sessionId: string,
  options: PairingSmokeOptions,
  smokeName: 'chat' | 'pairing',
) {
  await lifecycle(client, sessionId, 'terminate');
  await lifecycle(client, sessionId, 'activate');
  writeSmokeProgress(smokeName, 'app relaunched; waiting for pairing screen');
  await ensurePairingScreen(
    client,
    sessionId,
    options.platform,
  );
  writeSmokeProgress(smokeName, 'pairing screen ready');
  await replaceNodeText(
    client,
    sessionId,
    options.platform,
    'companion-url-input',
    options.baseUrl,
  );
  await revealNextPairingField(client, sessionId, options.platform);
  await replaceNodeText(
    client,
    sessionId,
    options.platform,
    'device-name-input',
    `Wave ${options.platform} ${smokeName} smoke`,
  );
  await revealNextPairingField(client, sessionId, options.platform);
  await replaceNodeText(
    client,
    sessionId,
    options.platform,
    'pairing-code-input',
    options.code,
  );
  await revealNextPairingField(client, sessionId, options.platform);
  await submitPairing(client, sessionId, options.platform);
  writeSmokeProgress(smokeName, 'pairing submitted; waiting for compatibility check');
  await waitForNode(
    client,
    sessionId,
    options.platform,
    CONNECTION_SUCCESS_ID,
    false,
    60,
  );
}

function writeSmokeProgress(smokeName: 'chat' | 'pairing', detail: string) {
  process.stderr.write(`[mobile-agent:${smokeName}] ${detail}\n`);
}

async function closeConnection(
  connection: Awaited<ReturnType<typeof connectMobileAgentClient>>,
  smokeName: 'chat' | 'pairing',
) {
  writeSmokeProgress(smokeName, 'closing mobile-agent connection');
  await withCleanupTimeout(
    connection.close(),
    10_000,
    'mobile-agent connection close',
  ).catch(() => undefined);
  writeSmokeProgress(smokeName, 'mobile-agent connection closed');
}

async function withCleanupTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`Timed out during ${label}.`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
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

async function submitChat(
  client: Awaited<ReturnType<typeof connectMobileAgentClient>>['client'],
  sessionId: string,
  platform: MobilePlatform,
) {
  await tapNode(client, sessionId, platform, SEND_BUTTON_ID);
}

async function replaceNodeText(
  client: Awaited<ReturnType<typeof connectMobileAgentClient>>['client'],
  sessionId: string,
  platform: MobilePlatform,
  stableId: string,
  text: string,
) {
  let node = await waitForNode(
    client,
    sessionId,
    platform,
    stableId,
    true,
  );
  const cleared = await callToolText(client, 'mobile_clear_text', {
    captureTrace: false,
    nodeId: node.nodeId,
    sessionId,
    snapshotId: node.snapshotId,
  });
  assertToolSucceeded(`clear-${stableId}`, cleared);
  await new Promise((resolve) => setTimeout(resolve, 250));

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    node = await waitForNode(
      client,
      sessionId,
      platform,
      stableId,
      true,
    );
    const typed = await callToolText(client, 'mobile_type_text', {
      captureTrace: false,
      nodeId: node.nodeId,
      sessionId,
      snapshotId: node.snapshotId,
      text,
    });
    assertToolSucceeded(`type-${stableId}`, typed);
    const verified = await waitForNodeValue(
      client,
      sessionId,
      platform,
      stableId,
      text,
      10,
    );
    if (verified) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Could not verify the value of ${stableId} on ${platform}.`);
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
): Promise<FoundNode> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const node = await findNode(
      client,
      sessionId,
      platform,
      stableId,
      interactiveOnly,
    );
    if (node) return node;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Could not find ${stableId} on ${platform}.`);
}

async function ensurePairingScreen(
  client: Awaited<ReturnType<typeof connectMobileAgentClient>>['client'],
  sessionId: string,
  platform: MobilePlatform,
) {
  for (let attempt = 1; attempt <= 120; attempt += 1) {
    const pairButton = await findNode(
      client,
      sessionId,
      platform,
      PAIR_BUTTON_ID,
      true,
    );
    if (pairButton) return;

    const staleConnectionButton = await findNode(
      client,
      sessionId,
      platform,
      CONNECTION_DISCONNECT_BUTTON_ID,
      true,
    );
    if (staleConnectionButton) {
      await tapNode(
        client,
        sessionId,
        platform,
        CONNECTION_DISCONNECT_BUTTON_ID,
      );
      await waitForNode(
        client,
        sessionId,
        platform,
        PAIR_BUTTON_ID,
        true,
        60,
      );
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Could not reach the pairing screen on ${platform}.`);
}

async function findNode(
  client: Awaited<ReturnType<typeof connectMobileAgentClient>>['client'],
  sessionId: string,
  platform: MobilePlatform,
  stableId: string,
  interactiveOnly: boolean,
): Promise<FoundNode | undefined> {
  const found = await callToolText(client, 'mobile_find_elements', {
    ...(platform === 'ios'
      ? { accessibilityId: stableId }
      : { resourceId: stableId }),
    exact: true,
    interactiveOnly,
    maxResults: 5,
    sessionId,
  });
  if (found.isError) return undefined;
  const result = parseJsonObject(found.text, `${stableId} query`);
  const nodes = result.nodes;
  if (!Array.isArray(nodes) || nodes.length !== 1) return undefined;
  const node = nodes[0];
  if (!node || typeof node !== 'object' || Array.isArray(node)) {
    return undefined;
  }
  const record = node as Record<string, unknown>;
  const currentValue =
    typeof record.value === 'string'
      ? record.value
      : typeof record.text === 'string'
        ? record.text
        : undefined;
  return {
    ...(currentValue === undefined ? {} : { currentValue }),
    nodeId: readString(record, 'id'),
    snapshotId: readString(result, 'snapshotId'),
  };
}

async function waitForNodeValue(
  client: Awaited<ReturnType<typeof connectMobileAgentClient>>['client'],
  sessionId: string,
  platform: MobilePlatform,
  stableId: string,
  expectedValue: string,
  attempts: number,
) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const node = await findNode(
      client,
      sessionId,
      platform,
      stableId,
      true,
    );
    if (node?.currentValue === expectedValue) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

async function waitForText(
  client: Awaited<ReturnType<typeof connectMobileAgentClient>>['client'],
  sessionId: string,
  platform: MobilePlatform,
  value: string,
  interactiveOnly = false,
  attempts = 30,
) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (platform === 'ios') {
      const found = await callToolText(client, 'appium_find_element', {
        selector: value,
        sessionId,
        strategy: 'accessibility id',
      });
      if (!found.isError) return;
      await new Promise((resolve) => setTimeout(resolve, 500));
      continue;
    }
    const found = await callToolText(client, 'mobile_find_elements', {
      exact: true,
      interactiveOnly,
      maxResults: 5,
      sessionId,
      text: value,
    });
    if (!found.isError) {
      const result = parseJsonObject(found.text, `${value} query`);
      if (Array.isArray(result.nodes) && result.nodes.length > 0) {
        return;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Could not find native text "${value}".`);
}

async function assertTextAbsent(
  client: Awaited<ReturnType<typeof connectMobileAgentClient>>['client'],
  sessionId: string,
  platform: MobilePlatform,
  value: string,
) {
  if (platform === 'ios') {
    const found = await callToolText(client, 'appium_find_element', {
      selector: value,
      sessionId,
      strategy: 'accessibility id',
    });
    if (!found.isError) {
      throw new Error(`Sensitive fixture text "${value}" was rendered.`);
    }
    return;
  }
  const found = await callToolText(client, 'mobile_find_elements', {
    exact: true,
    interactiveOnly: false,
    maxResults: 5,
    sessionId,
    text: value,
  });
  assertToolSucceeded(`query-hidden-text-${value}`, found);
  const result = parseJsonObject(found.text, `${value} absence query`);
  if (!Array.isArray(result.nodes) || result.nodes.length !== 0) {
    throw new Error(`Sensitive fixture text "${value}" was rendered.`);
  }
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
