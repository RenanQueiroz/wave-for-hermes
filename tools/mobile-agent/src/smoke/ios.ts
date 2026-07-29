import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { capabilitiesFor } from '../capabilities.js';
import type { MobileAgentConfig } from '../config.js';
import { runDoctor } from '../doctor.js';
import { callToolText, connectMobileAgentClient, type ToolTextResult } from '../mcp/client.js';
import { ensureSimulatorWda } from '../wda.js';

export interface IosSmokeReport {
  ok: boolean;
  sessionCreated: boolean;
  sessionDeleted: boolean;
  sessionId?: string;
  pageSourcePath?: string;
  screenshotResult?: string;
  traceDirectory?: string;
  tappedElement?: string;
  steps: Array<{
    name: string;
    ok: boolean;
    detail: string;
  }>;
}

export async function runIosSmoke(config: MobileAgentConfig): Promise<IosSmokeReport> {
  const report: IosSmokeReport = {
    ok: false,
    sessionCreated: false,
    sessionDeleted: false,
    steps: [],
  };
  const doctor = await runDoctor(config);
  if (!doctor.ok) {
    throw new Error('The mobile-agent doctor must pass before the iOS smoke test.');
  }
  await mkdir(config.artifactsDir, { recursive: true });
  const wda = await ensureSimulatorWda(config);
  const capabilities = capabilitiesFor(doctor, 'ios', { prebuiltWdaPath: wda.appPath });
  report.steps.push({
    name: 'prepare-wda',
    ok: true,
    detail: `${wda.downloaded ? 'Downloaded and verified' : 'Reused'} WebDriverAgent at ${wda.appPath}.`,
  });

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
        platform: 'ios',
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

    const activated = await callToolText(connection.client, 'appium_app_lifecycle', {
      action: 'activate',
      id: 'com.renanqueiroz.wave',
      ...sessionArgs(sessionId),
    });
    assertToolSucceeded('activate-wave', activated);
    report.steps.push({
      name: 'activate-wave',
      ok: true,
      detail: activated.text,
    });

    const safeElement = await findSafeElement(connection.client, sessionId);

    const tree = await callToolText(connection.client, 'mobile_get_element_tree', {
      interactiveOnly: true,
      maxNodes: 100,
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
      accessibilityId: safeElement.label,
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

    const pageSource = await callToolText(
      connection.client,
      'appium_get_page_source',
      sessionArgs(sessionId),
    );
    assertToolSucceeded('page-source', pageSource);
    const pageSourcePath = join(config.artifactsDir, 'ios-smoke-page-source.txt');
    await writeFile(pageSourcePath, pageSource.text, 'utf8');
    report.pageSourcePath = pageSourcePath;
    report.steps.push({
      name: 'page-source',
      ok: true,
      detail: `Saved the native hierarchy to ${pageSourcePath}.`,
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
      detail: `Tapped "${safeElement.label}" through normalized node ${nodeId} and its unique native locator.`,
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

async function findSafeElement(
  client: Awaited<ReturnType<typeof connectMobileAgentClient>>['client'],
  sessionId: string | undefined,
): Promise<{ label: string; elementId: string }> {
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    for (const label of ['Home', 'Explore']) {
      const found = await callToolText(client, 'appium_find_element', {
        strategy: 'accessibility id',
        selector: label,
        ...sessionArgs(sessionId),
      });
      if (!found.isError) {
        return {
          label,
          elementId: readElementId(found.text),
        };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    'Could not find the safe Home or Explore tab by accessibility ID after waiting for Wave to finish loading.',
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

function readElementId(text: string): string {
  const elementId = text.match(/^elementId '([^']+)'/m)?.[1];
  if (!elementId) {
    throw new Error(`Could not parse element ID from: ${text}`);
  }
  return elementId;
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
