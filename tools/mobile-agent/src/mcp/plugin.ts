import type {
  AppiumMcpCore,
  AppiumMcpPlugin,
  McpRegistry,
  PluginContext,
} from 'appium-mcp/core';
import { z } from 'zod';

import { beginActionTrace, completeActionTrace } from '../action-trace.js';
import { pruneActionTraces } from '../artifacts.js';
import { capabilitiesFor } from '../capabilities.js';
import { ANDROID_PACKAGE, IOS_BUNDLE_ID, loadConfig } from '../config.js';
import {
  clickNativeElement,
  findNativeElementId,
  resolveNativeDriver,
  tapCoordinates,
} from '../driver.js';
import { runDoctor } from '../doctor.js';
import {
  findHierarchyNodes,
  HierarchyStore,
  nodeById,
  serializeHierarchy,
  type HierarchySnapshot,
} from '../hierarchy.js';
import { readNativeLogs } from '../native-logs.js';
import { ObservabilityCollector } from '../observability.js';
import { sanitizeState } from '../state.js';
import { ensureSimulatorWda, expectedWdaAppPath, hasPreparedWda } from '../wda.js';

const capabilitiesParameters = z.object({
  platform: z.enum(['ios', 'android']),
});

const treeParameters = z.object({
  sessionId: z.string().optional(),
  visibleOnly: z.boolean().default(true),
  interactiveOnly: z.boolean().default(false),
  maxDepth: z.number().int().min(0).max(100).default(40),
  maxNodes: z.number().int().min(1).max(2_000).default(500),
});

const findParameters = z.object({
  sessionId: z.string().optional(),
  snapshotId: z.string().uuid().optional(),
  text: z.string().min(1).optional(),
  role: z.string().min(1).optional(),
  type: z.string().min(1).optional(),
  accessibilityId: z.string().min(1).optional(),
  resourceId: z.string().min(1).optional(),
  exact: z.boolean().default(false),
  visibleOnly: z.boolean().default(true),
  interactiveOnly: z.boolean().default(false),
  maxResults: z.number().int().min(1).max(200).default(50),
});

const tapParameters = z.object({
  sessionId: z.string().optional(),
  snapshotId: z.string().uuid(),
  nodeId: z.string().min(1),
  allowCoordinateFallback: z.boolean().default(false),
  captureTrace: z.boolean().default(true),
});

const pruneArtifactsParameters = z.object({
  confirm: z.boolean().default(false),
});

const logsParameters = z.object({
  sinceSequence: z.number().int().min(0).default(0),
  levels: z.array(z.string().min(1)).max(20).optional(),
  limit: z.number().int().min(1).max(500).default(200),
});

const requestsParameters = z.object({
  sinceSequence: z.number().int().min(0).default(0),
  urlContains: z.string().min(1).optional(),
  method: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(500).default(200),
});

const requestParameters = z.object({
  requestId: z.string().min(1),
  includeBody: z.boolean().default(false),
});

const stateParameters = z.object({
  provider: z.string().min(1).max(64).regex(/^[a-z0-9][a-z0-9._-]*$/),
  maxDepth: z.number().int().min(1).max(20).default(8),
  maxBytes: z.number().int().min(1_024).max(256 * 1_024).default(32 * 1_024),
});

const nativeLogsParameters = z.object({
  platform: z.enum(['ios', 'android']),
  sinceSeconds: z.number().int().min(1).max(600).default(60),
  limit: z.number().int().min(1).max(500).default(200),
});

const observabilityProbeParameters = z.object({
  marker: z.string().regex(/^wave-mobile-agent-probe-\d+$/),
});

export class WaveMobileAgentPlugin implements AppiumMcpPlugin {
  readonly name = 'wave-mobile-agent';
  readonly version = '0.1.0';
  private readonly hierarchy = new HierarchyStore();
  private readonly observability = new ObservabilityCollector(loadConfig());

  async initialize(_context: PluginContext): Promise<void> {
    await this.observability.start();
  }

  async destroy(): Promise<void> {
    await this.observability.stop();
  }

  register(registry: McpRegistry, core: AppiumMcpCore): void {
    registry.addTool({
      name: 'mobile_doctor',
      description:
        'Read-only validation of the Radon device set, Wave installation, Android ADB devices, Metro/Hermes targets, and Appium toolchain.',
      parameters: z.object({}),
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
      execute: async () => jsonResult(await runDoctor(loadConfig())),
    });

    registry.addTool({
      name: 'mobile_list_devices',
      description:
        'List Radon-managed iOS simulators and ADB-visible Android devices without changing device state.',
      parameters: z.object({}),
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
      execute: async () => {
        const report = await runDoctor(loadConfig());
        return jsonResult({
          ios: report.ios,
          android: report.android,
        });
      },
    });

    registry.addTool({
      name: 'mobile_get_capabilities',
      description:
        'Generate non-destructive Appium capabilities for the uniquely or explicitly selected Radon iOS or Android device.',
      parameters: capabilitiesParameters,
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
      execute: async (args: unknown) => {
        try {
          const { platform } = capabilitiesParameters.parse(args);
          const config = loadConfig();
          const report = await runDoctor(config);
          if (platform === 'ios' && !hasPreparedWda(config)) {
            throw new Error(
              'The generic WebDriverAgent runner has not been prepared. Call mobile_prepare_ios_wda first.',
            );
          }
          return jsonResult({
            platform,
            capabilities: capabilitiesFor(
              report,
              platform,
              platform === 'ios' ? { prebuiltWdaPath: expectedWdaAppPath(config) } : {},
            ),
          });
        } catch (error: unknown) {
          return {
            isError: true as const,
            content: [
              { type: 'text' as const, text: error instanceof Error ? error.message : String(error) },
            ],
          };
        }
      },
    });

    registry.addTool({
      name: 'mobile_prepare_ios_wda',
      description:
        'Download, checksum, and cache Appium’s official prebuilt WebDriverAgent simulator runner so XCUITest can launch it through Radon-aware simctl without asking Xcode to resolve Radon’s private simulator UUID.',
      parameters: z.object({}),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
      execute: async () => jsonResult(await ensureSimulatorWda(loadConfig())),
    });

    registry.addTool({
      name: 'mobile_get_element_tree',
      description:
        'Capture the active native iOS accessibility or Android UIAutomator hierarchy as a bounded, platform-neutral snapshot. Returns stable node IDs for follow-up find and action calls.',
      parameters: treeParameters,
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
      execute: async (args: unknown) =>
        withToolErrors('HIERARCHY_CAPTURE_FAILED', async () => {
          const parsed = treeParameters.parse(args);
          const resolved = resolveNativeDriver(core, parsed.sessionId);
          const snapshot = await this.captureHierarchy(resolved);
          return serializeHierarchy(snapshot, parsed);
        }),
    });

    registry.addTool({
      name: 'mobile_find_elements',
      description:
        'Query a normalized native hierarchy snapshot by accessible text, role, native type, accessibility ID, or Android resource ID. Captures a fresh snapshot when snapshotId is omitted.',
      parameters: findParameters,
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
      execute: async (args: unknown) =>
        withToolErrors('ELEMENT_QUERY_FAILED', async () => {
          const parsed = findParameters.parse(args);
          const snapshot = parsed.snapshotId
            ? this.requireSnapshot(parsed.snapshotId)
            : await this.captureHierarchy(resolveNativeDriver(core, parsed.sessionId));
          if (parsed.sessionId && parsed.sessionId !== snapshot.sessionId) {
            throw new MobileAgentError(
              'SESSION_MISMATCH',
              `Snapshot ${snapshot.id} belongs to session ${snapshot.sessionId}, not ${parsed.sessionId}.`,
            );
          }
          const nodes = findHierarchyNodes(snapshot, parsed);
          return {
            snapshotId: snapshot.id,
            sessionId: snapshot.sessionId,
            totalMatches: nodes.length,
            truncated: nodes.length > parsed.maxResults,
            nodes: nodes.slice(0, parsed.maxResults),
          };
        }),
    });

    registry.addTool({
      name: 'mobile_tap',
      description:
        'Tap a node from the latest normalized hierarchy snapshot. Uses a native accessibility/resource locator when unique; coordinate fallback is refused unless explicitly enabled. Captures a bounded before/after trace by default.',
      parameters: tapParameters,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
      execute: async (args: unknown) =>
        withToolErrors('TAP_FAILED', async () => {
          const parsed = tapParameters.parse(args);
          const snapshot = this.requireSnapshot(parsed.snapshotId);
          const resolved = resolveNativeDriver(core, parsed.sessionId ?? snapshot.sessionId);
          if (resolved.sessionId !== snapshot.sessionId) {
            throw new MobileAgentError(
              'SESSION_MISMATCH',
              `Snapshot ${snapshot.id} belongs to session ${snapshot.sessionId}, not ${resolved.sessionId}.`,
            );
          }
          if (!this.hierarchy.isLatest(snapshot.id, snapshot.sessionId)) {
            throw new MobileAgentError(
              'STALE_SNAPSHOT',
              `Snapshot ${snapshot.id} is stale. Capture a new tree and choose the target again.`,
            );
          }

          const node = nodeById(snapshot, parsed.nodeId);
          if (!node.visible || !node.enabled) {
            throw new MobileAgentError(
              'ELEMENT_NOT_ACTIONABLE',
              `Node ${node.id} is not both visible and enabled.`,
            );
          }
          const useNativeLocator = Boolean(
            node.locator && locatorIsUnique(snapshot, node.locator),
          );
          if (!useNativeLocator && !parsed.allowCoordinateFallback) {
            throw new MobileAgentError(
              'STABLE_LOCATOR_UNAVAILABLE',
              `Node ${node.id} has no unique native accessibility/resource locator. Coordinate fallback was not authorized.`,
              'Capture a fresh tree and select a node with an accessibilityId/resourceId, or explicitly set allowCoordinateFallback=true.',
            );
          }
          if (
            !useNativeLocator &&
            (!node.bounds || node.bounds.width <= 0 || node.bounds.height <= 0)
          ) {
            throw new MobileAgentError(
              'BOUNDS_UNAVAILABLE',
              `Node ${node.id} has no non-empty screen bounds for a coordinate tap.`,
            );
          }

          const startedAt = Date.now();
          const config = loadConfig();
          let traceContext: Awaited<ReturnType<typeof beginActionTrace>> | undefined;
          let traceWarning: string | undefined;
          if (parsed.captureTrace) {
            try {
              traceContext = await beginActionTrace(config, resolved, snapshot);
            } catch (error: unknown) {
              traceWarning = `Tap trace could not start: ${error instanceof Error ? error.message : String(error)}`;
            }
          }

          let actionResult: Record<string, unknown>;
          if (useNativeLocator && node.locator) {
            const elementId = await findNativeElementId(
              resolved.driver,
              node.locator.strategy,
              node.locator.selector,
            );
            await clickNativeElement(resolved.driver, elementId);
            actionResult = {
              ok: true,
              sessionId: resolved.sessionId,
              snapshotId: snapshot.id,
              nodeId: node.id,
              method: 'native-element',
              locator: node.locator,
            };
          } else {
            if (!node.bounds) throw new Error('Validated coordinate bounds became unavailable.');
            await tapCoordinates(resolved.driver, node.bounds);
            actionResult = {
              ok: true,
              sessionId: resolved.sessionId,
              snapshotId: snapshot.id,
              nodeId: node.id,
              method: 'coordinates',
              bounds: node.bounds,
            };
          }

          let afterSnapshot: HierarchySnapshot | undefined;
          let trace: Awaited<ReturnType<typeof completeActionTrace>> | undefined;
          if (traceContext) {
            await new Promise((resolve) => setTimeout(resolve, 250));
            try {
              afterSnapshot = await this.captureHierarchy(resolved);
            } catch (error: unknown) {
              traceContext.warnings.push(
                `After hierarchy failed: ${error instanceof Error ? error.message : String(error)}`,
              );
            }
            try {
              trace = await completeActionTrace(config, resolved, traceContext, afterSnapshot);
            } catch (error: unknown) {
              traceWarning = `Tap succeeded, but trace completion failed: ${error instanceof Error ? error.message : String(error)}`;
            }
          }
          return {
            ...actionResult,
            platform: resolved.platform,
            applicationId: resolved.platform === 'ios' ? IOS_BUNDLE_ID : ANDROID_PACKAGE,
            durationMs: Date.now() - startedAt,
            ...(afterSnapshot ? { afterSnapshotId: afterSnapshot.id } : {}),
            ...(trace ? { trace } : {}),
            ...(traceWarning ? { traceWarning } : {}),
          };
        }),
    });

    registry.addTool({
      name: 'mobile_prune_artifacts',
      description:
        'Preview or apply the configured retention policy to generated action-trace directories only. Deletion requires confirm=true.',
      parameters: pruneArtifactsParameters,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        openWorldHint: false,
      },
      execute: async (args: unknown) =>
        withToolErrors('ARTIFACT_PRUNE_FAILED', async () => {
          const { confirm } = pruneArtifactsParameters.parse(args);
          return await pruneActionTraces(loadConfig(), { dryRun: !confirm });
        }),
    });

    registry.addTool({
      name: 'mobile_observability_status',
      description:
        'Report whether the repository-local MCP is attached to Wave’s Metro/Hermes inspector and show retained log/request counts.',
      parameters: z.object({}),
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
      execute: async () =>
        withToolErrors('OBSERVABILITY_STATUS_FAILED', async () => {
          await this.observability.ensureConnected().catch(() => undefined);
          return this.observability.status();
        }),
    });

    registry.addTool({
      name: 'mobile_get_logs',
      description:
        'Read bounded, credential-redacted Hermes console/runtime logs. Use lastSequence as the next sinceSequence cursor.',
      parameters: logsParameters,
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
      execute: async (args: unknown) =>
        withToolErrors('LOG_READ_FAILED', async () => {
          const parsed = logsParameters.parse(args);
          await this.observability.ensureConnected();
          return {
            status: this.observability.status(),
            ...this.observability.getLogs(parsed),
          };
        }),
    });

    registry.addTool({
      name: 'mobile_get_network_requests',
      description:
        'Read bounded, credential-redacted Hermes network request metadata. Request and response bodies are never captured by this list operation.',
      parameters: requestsParameters,
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
      execute: async (args: unknown) =>
        withToolErrors('NETWORK_READ_FAILED', async () => {
          const parsed = requestsParameters.parse(args);
          await this.observability.ensureConnected();
          return {
            status: this.observability.status(),
            ...this.observability.getRequests(parsed),
          };
        }),
    });

    registry.addTool({
      name: 'mobile_get_network_request',
      description:
        'Read one retained Hermes network request. Response body retrieval is opt-in, limited to text/JSON under 64 KiB, and redacted before return.',
      parameters: requestParameters,
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
      execute: async (args: unknown) =>
        withToolErrors('NETWORK_REQUEST_READ_FAILED', async () => {
          const parsed = requestParameters.parse(args);
          await this.observability.ensureConnected();
          return await this.observability.getRequest(parsed.requestId, parsed.includeBody);
        }),
    });

    registry.addTool({
      name: 'mobile_clear_observability',
      description:
        'Clear only the MCP process’s in-memory log and network buffers. Does not modify the app, Metro, Radon, or device.',
      parameters: z.object({}),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
      execute: async () => {
        this.observability.clear();
        return jsonResult({ ok: true, status: this.observability.status() });
      },
    });

    registry.addTool({
      name: 'mobile_reload',
      description:
        'Request a JavaScript reload through the existing Wave Hermes inspector connection. The collector reconnects automatically when the runtime target returns.',
      parameters: z.object({}),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
      execute: async () =>
        withToolErrors('RELOAD_FAILED', async () => {
          return await this.observability.reloadApplication();
        }),
    });

    registry.addTool({
      name: 'mobile_run_observability_probe',
      description:
        'Emit one fixed local console/fetch diagnostic through the existing Hermes connection. Accepts only a generated probe marker and cannot evaluate caller-provided JavaScript or contact a non-Metro URL.',
      parameters: observabilityProbeParameters,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
      execute: async (args: unknown) =>
        withToolErrors('OBSERVABILITY_PROBE_FAILED', async () => {
          const parsed = observabilityProbeParameters.parse(args);
          await this.observability.runDiagnosticProbe(parsed.marker);
          return { ok: true, marker: parsed.marker };
        }),
    });

    registry.addTool({
      name: 'mobile_get_native_logs',
      description:
        'Read recent credential-redacted native logs for the selected Radon iOS simulator or ADB Android device, filtered to Wave’s current process ID.',
      parameters: nativeLogsParameters,
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
      execute: async (args: unknown) =>
        withToolErrors('NATIVE_LOG_READ_FAILED', async () => {
          const parsed = nativeLogsParameters.parse(args);
          return await readNativeLogs(loadConfig(), parsed.platform, parsed);
        }),
    });

    registry.addTool({
      name: 'mobile_list_state_providers',
      description:
        'List the names explicitly registered with Wave’s development-only, read-only state bridge. Does not evaluate caller-provided JavaScript.',
      parameters: z.object({}),
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
      execute: async () =>
        withToolErrors('STATE_PROVIDER_LIST_FAILED', async () => ({
          providers: await this.observability.listStateProviders(),
        })),
    });

    registry.addTool({
      name: 'mobile_read_state',
      description:
        'Read one explicitly registered development-only state provider. The result is recursively redacted and constrained by depth and byte limits; arbitrary JavaScript evaluation is not exposed.',
      parameters: stateParameters,
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
      execute: async (args: unknown) =>
        withToolErrors('STATE_READ_FAILED', async () => {
          const parsed = stateParameters.parse(args);
          const providers = await this.observability.listStateProviders();
          if (!providers.includes(parsed.provider)) {
            throw new MobileAgentError(
              'STATE_PROVIDER_NOT_REGISTERED',
              `State provider "${parsed.provider}" is not registered.`,
              `Choose one of: ${providers.join(', ') || '(none)'}.`,
            );
          }
          return {
            provider: parsed.provider,
            ...sanitizeState(await this.observability.readStateProvider(parsed.provider), parsed),
          };
        }),
    });
  }

  private async captureHierarchy(
    resolved: ReturnType<typeof resolveNativeDriver>,
  ): Promise<HierarchySnapshot> {
    const xml = await resolved.driver.getPageSource();
    if (!xml?.trim()) {
      throw new MobileAgentError('EMPTY_HIERARCHY', 'The native driver returned an empty hierarchy.');
    }
    return this.hierarchy.capture(xml, resolved.sessionId, resolved.platform);
  }

  private requireSnapshot(snapshotId: string): HierarchySnapshot {
    const snapshot = this.hierarchy.get(snapshotId);
    if (!snapshot) {
      throw new MobileAgentError(
        'SNAPSHOT_NOT_FOUND',
        `Snapshot ${snapshotId} is unavailable or expired. Capture a new element tree.`,
      );
    }
    return snapshot;
  }
}

function jsonResult(value: unknown): { content: [{ type: 'text'; text: string }] } {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  };
}

class MobileAgentError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly recovery?: string,
  ) {
    super(message);
  }
}

async function withToolErrors(
  fallbackCode: string,
  operation: () => Promise<unknown>,
): Promise<
  | { content: [{ type: 'text'; text: string }] }
  | { isError: true; content: [{ type: 'text'; text: string }] }
> {
  try {
    return jsonResult(await operation());
  } catch (error: unknown) {
    const known = error instanceof MobileAgentError;
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              ok: false,
              error: {
                code: known ? error.code : fallbackCode,
                message: error instanceof Error ? error.message : String(error),
                ...(known && error.recovery ? { recovery: error.recovery } : {}),
              },
            },
            null,
            2,
          ),
        },
      ],
    };
  }
}

function locatorIsUnique(
  snapshot: HierarchySnapshot,
  locator: NonNullable<HierarchySnapshot['nodes'][number]['locator']>,
): boolean {
  return (
    snapshot.nodes.filter(
      (node) =>
        node.locator?.strategy === locator.strategy && node.locator.selector === locator.selector,
    ).length === 1
  );
}
