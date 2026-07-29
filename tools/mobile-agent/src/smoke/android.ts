import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { capabilitiesFor } from '../capabilities.js';
import type { MobileAgentConfig } from '../config.js';
import { runDoctor } from '../doctor.js';
import { callToolText, connectMobileAgentClient, type ToolTextResult } from '../mcp/client.js';

export interface AndroidSmokeReport {
  ok: boolean;
  sessionCreated: boolean;
  sessionDeleted: boolean;
  sessionId?: string;
  pageSourcePath?: string;
  screenshotResult?: string;
  traceDirectory?: string;
  dismissedOnboarding: boolean;
  tappedElement?: string;
  steps: Array<{
    name: string;
    ok: boolean;
    detail: string;
  }>;
}

export async function runAndroidSmoke(config: MobileAgentConfig): Promise<AndroidSmokeReport> {
  const report: AndroidSmokeReport = {
    ok: false,
    sessionCreated: false,
    sessionDeleted: false,
    dismissedOnboarding: false,
    steps: [],
  };
  const doctor = await runDoctor(config);
  if (!doctor.readyPlatforms.includes('android')) {
    throw new Error(
      'Android is not ready. Keep the installed Wave development build running in Radon with its Hermes target connected.',
    );
  }
  await mkdir(config.artifactsDir, { recursive: true });
  const capabilities = capabilitiesFor(doctor, 'android');

  const connection = await connectMobileAgentClient(config, { forwardStderr: true });
  let sessionId: string | undefined;
  try {
    const tools = await connection.client.listTools();
    const requiredTools = [
      'mobile_doctor',
      'mobile_get_element_tree',
      'mobile_find_elements',
      'mobile_tap',
      'appium_session_management',
      'appium_app_lifecycle',
      'appium_get_page_source',
      'appium_screenshot',
      'appium_find_element',
    ];
    const missingTools = requiredTools.filter(
      (name) => !tools.tools.some((tool) => tool.name === name),
    );
    if (missingTools.length > 0) {
      throw new Error(`MCP server is missing required tools: ${missingTools.join(', ')}`);
    }
    report.steps.push({
      name: 'mcp-tools',
      ok: true,
      detail: `Verified ${requiredTools.length} required tools.`,
    });

    const created = await callToolText(
      connection.client,
      'appium_session_management',
      {
        action: 'create',
        platform: 'android',
        capabilities: JSON.stringify(capabilities),
      },
      10 * 60_000,
    );
    assertToolSucceeded('create-session', created);
    sessionId = readSessionId(created.text);
    report.sessionCreated = true;
    report.sessionId = sessionId;
    report.steps.push({
      name: 'create-session',
      ok: true,
      detail: created.text,
    });

    const appState = await callToolText(connection.client, 'appium_app_lifecycle', {
      action: 'query_state',
      id: 'com.renanqueiroz.wave',
      ...sessionArgs(sessionId),
    });
    assertToolSucceeded('query-wave-state', appState);
    report.steps.push({
      name: 'query-wave-state',
      ok: true,
      detail: appState.text,
    });
    if (!/\bstate:\s*4\b/.test(appState.text)) {
      const metroUrl = doctor.metro.selected?.url;
      if (!metroUrl) {
        throw new Error('Cannot foreground Wave because the Radon Metro URL is unavailable.');
      }
      const deepLink = `exp+wave://expo-development-client/?url=${encodeURIComponent(metroUrl)}`;
      const foregrounded = await callToolText(connection.client, 'appium_app_lifecycle', {
        action: 'deep_link',
        id: 'com.renanqueiroz.wave',
        url: deepLink,
        waitForLaunch: true,
        ...sessionArgs(sessionId),
      });
      assertToolSucceeded('foreground-wave', foregrounded);
      report.steps.push({
        name: 'foreground-wave',
        ok: true,
        detail: foregrounded.text,
      });
    }

    const pageSource = await callToolText(
      connection.client,
      'appium_get_page_source',
      sessionArgs(sessionId),
    );
    assertToolSucceeded('page-source', pageSource);
    const pageSourcePath = join(config.artifactsDir, 'android-smoke-page-source.txt');
    await writeFile(pageSourcePath, pageSource.text, 'utf8');
    report.pageSourcePath = pageSourcePath;
    report.steps.push({
      name: 'page-source',
      ok: true,
      detail: `Saved the native hierarchy to ${pageSourcePath}.`,
    });

    report.dismissedOnboarding = await dismissOnboardingIfPresent(
      connection.client,
      sessionId,
      report,
    );

    const safeElement = await findSafeElement(connection.client, sessionId);
    const tree = await callToolText(connection.client, 'mobile_get_element_tree', {
      interactiveOnly: true,
      maxNodes: 200,
      ...sessionArgs(sessionId),
    });
    assertToolSucceeded('normalized-tree', tree);
    const treeResult = parseJsonObject(tree.text, 'normalized tree');
    const snapshotId = readString(treeResult, 'snapshotId');
    report.steps.push({
      name: 'normalized-tree',
      ok: true,
      detail: `Captured native hierarchy snapshot ${snapshotId}.`,
    });

    const normalizedElement = await callToolText(connection.client, 'mobile_find_elements', {
      snapshotId,
      text: safeElement.label,
      exact: true,
      interactiveOnly: true,
      maxResults: 5,
      ...sessionArgs(sessionId),
    });
    assertToolSucceeded('normalized-find', normalizedElement);
    const foundResult = parseJsonObject(normalizedElement.text, 'normalized element result');
    const nodes = foundResult.nodes;
    if (!Array.isArray(nodes) || nodes.length !== 1) {
      throw new Error(
        `Expected one normalized "${safeElement.label}" node, received ${Array.isArray(nodes) ? nodes.length : 'invalid nodes'}.`,
      );
    }
    const normalizedNode = nodes[0];
    if (!normalizedNode || typeof normalizedNode !== 'object') {
      throw new Error('The normalized element result did not contain an object node.');
    }
    const nodeId = readString(normalizedNode as Record<string, unknown>, 'id');
    report.steps.push({
      name: 'normalized-find',
      ok: true,
      detail: `Resolved "${safeElement.label}" to stable node ${nodeId}.`,
    });

    const screenshot = await callToolText(
      connection.client,
      'appium_screenshot',
      sessionArgs(sessionId),
    );
    assertToolSucceeded('screenshot', screenshot);
    report.screenshotResult = screenshot.text;
    report.steps.push({
      name: 'screenshot',
      ok: true,
      detail: screenshot.text,
    });

    const tapped = await callToolText(connection.client, 'mobile_tap', {
      snapshotId,
      nodeId,
      allowCoordinateFallback: true,
      ...sessionArgs(sessionId),
    });
    assertToolSucceeded('safe-tap', tapped);
    const tapResult = parseJsonObject(tapped.text, 'normalized tap result');
    const trace = tapResult.trace;
    if (!trace || typeof trace !== 'object' || Array.isArray(trace)) {
      throw new Error('The normalized tap did not return its before/after action trace.');
    }
    report.traceDirectory = readString(trace as Record<string, unknown>, 'directory');
    report.tappedElement = safeElement.label;
    report.steps.push({
      name: 'safe-tap',
      ok: true,
      detail: `Tapped "${safeElement.label}" through stable normalized node ${nodeId}.`,
    });
    report.steps.push({
      name: 'action-trace',
      ok: true,
      detail: `Captured before/after hierarchy and screenshots under ${report.traceDirectory}.`,
    });

    report.ok = true;
    return report;
  } finally {
    if (report.sessionCreated) {
      const deleted = await callToolText(
        connection.client,
        'appium_session_management',
        {
          action: 'delete',
          ...sessionArgs(sessionId),
        },
        120_000,
      ).catch((error: unknown) => ({
        isError: true,
        text: error instanceof Error ? error.message : String(error),
        raw: undefined,
      }));
      report.sessionDeleted = !deleted.isError;
      report.steps.push({
        name: 'delete-session',
        ok: !deleted.isError,
        detail: deleted.text,
      });
    }
    await connection.close();
  }
}

async function dismissOnboardingIfPresent(
  client: Awaited<ReturnType<typeof connectMobileAgentClient>>['client'],
  sessionId: string | undefined,
  report: AndroidSmokeReport,
): Promise<boolean> {
  const found = await callToolText(client, 'mobile_find_elements', {
    text: 'Continue',
    exact: true,
    interactiveOnly: true,
    maxResults: 5,
    ...sessionArgs(sessionId),
  });
  if (found.isError) {
    return false;
  }
  const result = parseJsonObject(found.text, 'onboarding element result');
  const nodes = result.nodes;
  if (!Array.isArray(nodes) || nodes.length !== 1) {
    return false;
  }
  const node = nodes[0];
  if (!node || typeof node !== 'object') {
    return false;
  }
  const snapshotId = readString(result, 'snapshotId');
  const nodeId = readString(node as Record<string, unknown>, 'id');
  const tapped = await callToolText(client, 'mobile_tap', {
    snapshotId,
    nodeId,
    allowCoordinateFallback: true,
    ...sessionArgs(sessionId),
  });
  assertToolSucceeded('dismiss-onboarding', tapped);
  report.steps.push({
    name: 'dismiss-onboarding',
    ok: true,
    detail: `Dismissed Expo's one-time development menu onboarding through node ${nodeId}.`,
  });
  return true;
}

async function findSafeElement(
  client: Awaited<ReturnType<typeof connectMobileAgentClient>>['client'],
  sessionId: string | undefined,
): Promise<{ label: string }> {
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    for (const label of ['Home', 'Explore']) {
      const found = await callToolText(client, 'mobile_find_elements', {
        text: label,
        exact: true,
        interactiveOnly: true,
        maxResults: 5,
        ...sessionArgs(sessionId),
      });
      if (!found.isError) {
        const result = parseJsonObject(found.text, 'safe element result');
        const nodes = result.nodes;
        if (Array.isArray(nodes) && nodes.length === 1) {
          return { label };
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    'Could not find a unique interactive Home or Explore tab after waiting for Wave to finish loading.',
  );
}

function assertToolSucceeded(step: string, result: ToolTextResult): void {
  if (result.isError) {
    throw new Error(`${step} failed: ${result.text}`);
  }
}

function readSessionId(text: string): string {
  const sessionId = text.match(/ID:\s*([^\s]+)/)?.[1];
  if (!sessionId) {
    throw new Error(`Could not parse Appium session ID from: ${text}`);
  }
  return sessionId;
}

function sessionArgs(sessionId: string | undefined): { sessionId?: string } {
  return sessionId ? { sessionId } : {};
}

function parseJsonObject(text: string, label: string): Record<string, unknown> {
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`The ${label} response was not a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

function readString(value: Record<string, unknown>, key: string): string {
  const result = value[key];
  if (typeof result !== 'string' || !result) {
    throw new Error(`Expected ${key} to be a non-empty string.`);
  }
  return result;
}
