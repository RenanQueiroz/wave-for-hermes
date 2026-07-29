import type {
  AppiumMcpCore,
  AppiumMcpPlugin,
  McpRegistry,
  PluginContext,
} from 'appium-mcp/core';
import { z } from 'zod';

import {
  actionErrorEnvelope,
  identityFromDriver,
  MobileAgentError,
  performDetachedAction,
  performUnifiedAction,
  type MobileActionIdentity,
  type MobileActionName,
} from '../actions.js';
import { pruneActionTraces } from '../artifacts.js';
import { capabilitiesFor } from '../capabilities.js';
import { ANDROID_PACKAGE, IOS_BUNDLE_ID, loadConfig } from '../config.js';
import {
  activateNativeApplication,
  backgroundNativeApplication,
  clickNativeElement,
  dragPoints,
  findNativeElementId,
  getNativeElementRect,
  getNativeWindowRect,
  longPressPoint,
  openNativeDeepLink,
  pressNativeKey,
  resolveNativeDriver,
  setNativeElementValue,
  swipePoints,
  tapPoint,
  terminateNativeApplication,
  type ResolvedDriver,
} from '../driver.js';
import { runDoctor } from '../doctor.js';
import {
  findHierarchyNodes,
  HierarchyStore,
  nodeById,
  serializeHierarchy,
  type HierarchyNode,
  type HierarchySnapshot,
} from '../hierarchy.js';
import { readNativeLogs } from '../native-logs.js';
import { ObservabilityCollector, redactUrl } from '../observability.js';
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

const longPressParameters = z.object({
  sessionId: z.string().optional(),
  snapshotId: z.string().uuid(),
  nodeId: z.string().min(1),
  durationMs: z.number().int().min(500).max(10_000).default(1_000),
  allowCoordinateFallback: z.boolean().default(false),
  captureTrace: z.boolean().default(true),
});

const typeTextParameters = z.object({
  sessionId: z.string().optional(),
  snapshotId: z.string().uuid(),
  nodeId: z.string().min(1),
  text: z.string().min(1).max(16_384),
  captureTrace: z.boolean().default(false),
});

const clearTextParameters = z.object({
  sessionId: z.string().optional(),
  snapshotId: z.string().uuid(),
  nodeId: z.string().min(1),
  captureTrace: z.boolean().default(false),
});

const swipeParameters = z.object({
  sessionId: z.string().optional(),
  startX: z.number().int().min(0).max(100_000),
  startY: z.number().int().min(0).max(100_000),
  endX: z.number().int().min(0).max(100_000),
  endY: z.number().int().min(0).max(100_000),
  durationMs: z.number().int().min(50).max(5_000).default(300),
  captureTrace: z.boolean().default(true),
});

const scrollParameters = z.object({
  sessionId: z.string().optional(),
  direction: z.enum(['up', 'down', 'left', 'right']),
  distance: z.number().min(0.05).max(0.9).default(0.6),
  durationMs: z.number().int().min(100).max(5_000).default(600),
  captureTrace: z.boolean().default(true),
});

const dragParameters = z.object({
  sessionId: z.string().optional(),
  snapshotId: z.string().uuid(),
  sourceNodeId: z.string().min(1),
  targetNodeId: z.string().min(1),
  durationMs: z.number().int().min(100).max(5_000).default(1_200),
  longPressDurationMs: z.number().int().min(400).max(2_000).default(600),
  allowCoordinateFallback: z.boolean().default(false),
  captureTrace: z.boolean().default(true),
});

const pressKeyParameters = z.object({
  sessionId: z.string().optional(),
  key: z.enum(['back', 'home']),
  captureTrace: z.boolean().default(true),
});

const lifecycleParameters = z.object({
  sessionId: z.string().optional(),
  action: z.enum(['activate', 'terminate', 'background']),
  seconds: z.number().int().min(1).max(600).default(3),
  captureTrace: z.boolean().default(false),
});

const deepLinkParameters = z.object({
  sessionId: z.string().optional(),
  url: z.string().min(1).max(2_048),
  waitForLaunch: z.boolean().default(true),
  captureTrace: z.boolean().default(false),
});

const reloadParameters = z.object({
  sessionId: z.string().optional(),
  platform: z.enum(['ios', 'android']).optional(),
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

type ActionToolContext = {
  identity?: MobileActionIdentity;
  target?: Record<string, unknown>;
};

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
        withActionErrors('tap', 'TAP_FAILED', async (context) => {
          const parsed = tapParameters.parse(args);
          const { snapshot, resolved } = this.resolveActionSnapshot(
            core,
            parsed.snapshotId,
            parsed.sessionId,
            context,
          );
          const node = requireActionableNode(snapshot, parsed.nodeId);
          const useNativeLocator = hasUniqueLocator(snapshot, node);
          requireNodeActionMethod(node, useNativeLocator, parsed.allowCoordinateFallback);
          const target = nodeActionTarget(snapshot, node, useNativeLocator);
          context.identity = identityFromDriver(resolved);
          context.target = target;
          return await performUnifiedAction({
            config: loadConfig(),
            resolved,
            action: 'tap',
            target,
            captureTrace: parsed.captureTrace,
            beforeSnapshot: snapshot,
            captureHierarchy: async () => await this.captureHierarchy(resolved),
            invalidateHierarchy: () => this.hierarchy.invalidate(resolved.sessionId),
            operation: async () => {
              if (useNativeLocator && node.locator) {
                const elementId = await findNativeElementId(
                  resolved.driver,
                  node.locator.strategy,
                  node.locator.selector,
                );
                await clickNativeElement(resolved.driver, elementId);
                return { method: 'native-element', locator: node.locator };
              }
              if (!node.bounds) throw new Error('Validated coordinate bounds became unavailable.');
              const point = center(node.bounds);
              await tapPoint(resolved.driver, point.x, point.y);
              return { method: 'snapshot-coordinates', bounds: node.bounds };
            },
          });
        }),
    });

    registry.addTool({
      name: 'mobile_long_press',
      description:
        'Long-press a node from the latest normalized hierarchy. A unique native locator is preferred; bounds require explicit coordinate-fallback authorization.',
      parameters: longPressParameters,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
      execute: async (args: unknown) =>
        withActionErrors('long_press', 'LONG_PRESS_FAILED', async (context) => {
          const parsed = longPressParameters.parse(args);
          const { snapshot, resolved } = this.resolveActionSnapshot(
            core,
            parsed.snapshotId,
            parsed.sessionId,
            context,
          );
          const node = requireActionableNode(snapshot, parsed.nodeId);
          const point = await resolveNodePoint(
            resolved,
            snapshot,
            node,
            parsed.allowCoordinateFallback,
          );
          const target = {
            ...nodeActionTarget(snapshot, node, point.method === 'native-element'),
            durationMs: parsed.durationMs,
          };
          context.identity = identityFromDriver(resolved);
          context.target = target;
          return await performUnifiedAction({
            config: loadConfig(),
            resolved,
            action: 'long_press',
            target,
            captureTrace: parsed.captureTrace,
            beforeSnapshot: snapshot,
            captureHierarchy: async () => await this.captureHierarchy(resolved),
            invalidateHierarchy: () => this.hierarchy.invalidate(resolved.sessionId),
            operation: async () => {
              await longPressPoint(
                resolved.driver,
                point.x,
                point.y,
                parsed.durationMs,
              );
              return { method: point.method };
            },
          });
        }),
    });

    registry.addTool({
      name: 'mobile_type_text',
      description:
        'Replace the value of a node selected from the latest hierarchy through a unique native locator. Text is never echoed in the response, and trace capture defaults off for privacy.',
      parameters: typeTextParameters,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
      execute: async (args: unknown) =>
        withActionErrors('type_text', 'TYPE_TEXT_FAILED', async (context) => {
          const parsed = typeTextParameters.parse(args);
          const { snapshot, resolved } = this.resolveActionSnapshot(
            core,
            parsed.snapshotId,
            parsed.sessionId,
            context,
          );
          const node = requireActionableNode(snapshot, parsed.nodeId);
          const locator = requireUniqueLocator(snapshot, node);
          const target = {
            snapshotId: snapshot.id,
            nodeId: node.id,
            method: 'native-element',
            locator,
            textLength: parsed.text.length,
          };
          context.identity = identityFromDriver(resolved);
          context.target = target;
          return await performUnifiedAction({
            config: loadConfig(),
            resolved,
            action: 'type_text',
            target,
            captureTrace: parsed.captureTrace,
            beforeSnapshot: snapshot,
            captureHierarchy: async () => await this.captureHierarchy(resolved),
            invalidateHierarchy: () => this.hierarchy.invalidate(resolved.sessionId),
            operation: async () => {
              const elementId = await findNativeElementId(
                resolved.driver,
                locator.strategy,
                locator.selector,
              );
              await setNativeElementValue(resolved.driver, elementId, parsed.text);
              return { method: 'native-element', charactersWritten: parsed.text.length };
            },
          });
        }),
    });

    registry.addTool({
      name: 'mobile_clear_text',
      description:
        'Clear a text node selected from the latest hierarchy through a unique native locator. Trace capture defaults off for privacy.',
      parameters: clearTextParameters,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
      execute: async (args: unknown) =>
        withActionErrors('clear_text', 'CLEAR_TEXT_FAILED', async (context) => {
          const parsed = clearTextParameters.parse(args);
          const { snapshot, resolved } = this.resolveActionSnapshot(
            core,
            parsed.snapshotId,
            parsed.sessionId,
            context,
          );
          const node = requireActionableNode(snapshot, parsed.nodeId);
          const locator = requireUniqueLocator(snapshot, node);
          const target = {
            snapshotId: snapshot.id,
            nodeId: node.id,
            method: 'native-element',
            locator,
          };
          context.identity = identityFromDriver(resolved);
          context.target = target;
          return await performUnifiedAction({
            config: loadConfig(),
            resolved,
            action: 'clear_text',
            target,
            captureTrace: parsed.captureTrace,
            beforeSnapshot: snapshot,
            captureHierarchy: async () => await this.captureHierarchy(resolved),
            invalidateHierarchy: () => this.hierarchy.invalidate(resolved.sessionId),
            operation: async () => {
              const elementId = await findNativeElementId(
                resolved.driver,
                locator.strategy,
                locator.selector,
              );
              await setNativeElementValue(resolved.driver, elementId, '');
              return { method: 'native-element' };
            },
          });
        }),
    });

    registry.addTool({
      name: 'mobile_swipe',
      description:
        'Swipe between explicit viewport coordinates after validating both points against the active native window. Captures a before/after trace by default.',
      parameters: swipeParameters,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
      execute: async (args: unknown) =>
        withActionErrors('swipe', 'SWIPE_FAILED', async (context) => {
          const parsed = swipeParameters.parse(args);
          const resolved = resolveNativeDriver(core, parsed.sessionId);
          context.identity = identityFromDriver(resolved);
          const rect = await getNativeWindowRect(resolved.driver);
          const source = { x: parsed.startX, y: parsed.startY };
          const targetPoint = { x: parsed.endX, y: parsed.endY };
          requirePointInWindow(source, rect, 'Swipe start');
          requirePointInWindow(targetPoint, rect, 'Swipe end');
          const target = {
            source,
            destination: targetPoint,
            durationMs: parsed.durationMs,
            coordinateSpace: 'viewport',
          };
          context.target = target;
          return await performUnifiedAction({
            config: loadConfig(),
            resolved,
            action: 'swipe',
            target,
            captureTrace: parsed.captureTrace,
            captureHierarchy: async () => await this.captureHierarchy(resolved),
            invalidateHierarchy: () => this.hierarchy.invalidate(resolved.sessionId),
            operation: async () => {
              await swipePoints(
                resolved.driver,
                source,
                targetPoint,
                parsed.durationMs,
              );
              return { method: 'w3c-touch-actions' };
            },
          });
        }),
    });

    registry.addTool({
      name: 'mobile_scroll',
      description:
        'Scroll in a named direction across a bounded fraction of the active native window. Captures a before/after trace by default.',
      parameters: scrollParameters,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
      execute: async (args: unknown) =>
        withActionErrors('scroll', 'SCROLL_FAILED', async (context) => {
          const parsed = scrollParameters.parse(args);
          const resolved = resolveNativeDriver(core, parsed.sessionId);
          context.identity = identityFromDriver(resolved);
          const rect = await getNativeWindowRect(resolved.driver);
          const points = scrollPoints(rect, parsed.direction, parsed.distance);
          const target = {
            direction: parsed.direction,
            distance: parsed.distance,
            durationMs: parsed.durationMs,
            coordinateSpace: 'viewport',
          };
          context.target = target;
          return await performUnifiedAction({
            config: loadConfig(),
            resolved,
            action: 'scroll',
            target,
            captureTrace: parsed.captureTrace,
            captureHierarchy: async () => await this.captureHierarchy(resolved),
            invalidateHierarchy: () => this.hierarchy.invalidate(resolved.sessionId),
            operation: async () => {
              await swipePoints(
                resolved.driver,
                points.source,
                points.destination,
                parsed.durationMs,
              );
              return {
                method: 'w3c-touch-actions',
                source: points.source,
                destination: points.destination,
              };
            },
          });
        }),
    });

    registry.addTool({
      name: 'mobile_drag',
      description:
        'Drag from one node to another in the latest hierarchy. Unique native locators are preferred; any bounds-based fallback must be explicitly authorized.',
      parameters: dragParameters,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
      execute: async (args: unknown) =>
        withActionErrors('drag', 'DRAG_FAILED', async (context) => {
          const parsed = dragParameters.parse(args);
          const { snapshot, resolved } = this.resolveActionSnapshot(
            core,
            parsed.snapshotId,
            parsed.sessionId,
            context,
          );
          const sourceNode = requireActionableNode(snapshot, parsed.sourceNodeId);
          const targetNode = requireActionableNode(snapshot, parsed.targetNodeId);
          const source = await resolveNodePoint(
            resolved,
            snapshot,
            sourceNode,
            parsed.allowCoordinateFallback,
          );
          const destination = await resolveNodePoint(
            resolved,
            snapshot,
            targetNode,
            parsed.allowCoordinateFallback,
          );
          const target = {
            snapshotId: snapshot.id,
            sourceNodeId: sourceNode.id,
            targetNodeId: targetNode.id,
            sourceMethod: source.method,
            targetMethod: destination.method,
            durationMs: parsed.durationMs,
            longPressDurationMs: parsed.longPressDurationMs,
          };
          context.identity = identityFromDriver(resolved);
          context.target = target;
          return await performUnifiedAction({
            config: loadConfig(),
            resolved,
            action: 'drag',
            target,
            captureTrace: parsed.captureTrace,
            beforeSnapshot: snapshot,
            captureHierarchy: async () => await this.captureHierarchy(resolved),
            invalidateHierarchy: () => this.hierarchy.invalidate(resolved.sessionId),
            operation: async () => {
              await dragPoints(
                resolved.driver,
                source,
                destination,
                parsed.durationMs,
                parsed.longPressDurationMs,
              );
              return { method: 'w3c-touch-actions' };
            },
          });
        }),
    });

    registry.addTool({
      name: 'mobile_press_key',
      description:
        'Press only the safe platform navigation keys back or home through the active native driver.',
      parameters: pressKeyParameters,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
      execute: async (args: unknown) =>
        withActionErrors('press_key', 'PRESS_KEY_FAILED', async (context) => {
          const parsed = pressKeyParameters.parse(args);
          const resolved = resolveNativeDriver(core, parsed.sessionId);
          const target = { key: parsed.key };
          context.identity = identityFromDriver(resolved);
          context.target = target;
          return await performUnifiedAction({
            config: loadConfig(),
            resolved,
            action: 'press_key',
            target,
            captureTrace: parsed.captureTrace,
            captureHierarchy: async () => await this.captureHierarchy(resolved),
            invalidateHierarchy: () => this.hierarchy.invalidate(resolved.sessionId),
            operation: async () => {
              await pressNativeKey(resolved, parsed.key);
              return { method: 'native-driver' };
            },
          });
        }),
    });

    registry.addTool({
      name: 'mobile_app_lifecycle',
      description:
        'Activate, terminate, or briefly background Wave through the active native driver. Install, uninstall, and app-data clearing are intentionally excluded.',
      parameters: lifecycleParameters,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
      execute: async (args: unknown) =>
        withActionErrors(
          lifecycleActionName(args),
          'APP_LIFECYCLE_FAILED',
          async (context) => {
            const parsed = lifecycleParameters.parse(args);
            const resolved = resolveNativeDriver(core, parsed.sessionId);
            const target = {
              lifecycleAction: parsed.action,
              ...(parsed.action === 'background' ? { seconds: parsed.seconds } : {}),
            };
            context.identity = identityFromDriver(resolved);
            context.target = target;
            return await performUnifiedAction({
              config: loadConfig(),
              resolved,
              action: parsed.action,
              target,
              captureTrace: parsed.captureTrace,
              captureHierarchy: async () => await this.captureHierarchy(resolved),
              invalidateHierarchy: () => this.hierarchy.invalidate(resolved.sessionId),
              operation: async () => {
                switch (parsed.action) {
                  case 'activate':
                    await activateNativeApplication(resolved);
                    break;
                  case 'terminate':
                    await terminateNativeApplication(resolved);
                    break;
                  case 'background':
                    await backgroundNativeApplication(resolved, parsed.seconds);
                    break;
                }
                return { method: 'native-driver' };
              },
            });
          },
        ),
    });

    registry.addTool({
      name: 'mobile_open_deep_link',
      description:
        'Open one URL in Wave through the active native driver. Sensitive query values are redacted in results, and trace capture defaults off for privacy.',
      parameters: deepLinkParameters,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
      execute: async (args: unknown) =>
        withActionErrors('deep_link', 'DEEP_LINK_FAILED', async (context) => {
          const parsed = deepLinkParameters.parse(args);
          validateDeepLink(parsed.url);
          const resolved = resolveNativeDriver(core, parsed.sessionId);
          const target = {
            url: redactUrl(parsed.url),
            waitForLaunch: parsed.waitForLaunch,
          };
          context.identity = identityFromDriver(resolved);
          context.target = target;
          return await performUnifiedAction({
            config: loadConfig(),
            resolved,
            action: 'deep_link',
            target,
            captureTrace: parsed.captureTrace,
            captureHierarchy: async () => await this.captureHierarchy(resolved),
            invalidateHierarchy: () => this.hierarchy.invalidate(resolved.sessionId),
            operation: async () => {
              await openNativeDeepLink(
                resolved,
                parsed.url,
                parsed.waitForLaunch,
              );
              return { method: 'native-driver' };
            },
          });
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
        'Request a JavaScript reload through the existing Wave Hermes inspector connection. Returns the same action envelope as native tools and reconnects automatically when the runtime target returns.',
      parameters: reloadParameters,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
      execute: async (args: unknown) =>
        withActionErrors('reload', 'RELOAD_FAILED', async (context) => {
          const parsed = reloadParameters.parse(args);
          const identity = await resolveReloadIdentity(core, parsed);
          const target = { runtime: 'hermes' };
          context.identity = identity;
          context.target = target;
          return await performDetachedAction({
            identity,
            action: 'reload',
            target,
            operation: async () => {
              const result = await this.observability.reloadApplication();
              return {
                targetId: result.targetId,
                reconnecting: result.reconnecting,
                method: 'hermes-cdp',
              };
            },
          });
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

  private resolveActionSnapshot(
    core: AppiumMcpCore,
    snapshotId: string,
    requestedSessionId?: string,
    context?: ActionToolContext,
  ): {
    snapshot: HierarchySnapshot;
    resolved: ResolvedDriver;
  } {
    const snapshot = this.requireSnapshot(snapshotId);
    const resolved = resolveNativeDriver(core, requestedSessionId ?? snapshot.sessionId);
    if (context) {
      context.identity = identityFromDriver(resolved);
      context.target = { snapshotId: snapshot.id };
    }
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
    return { snapshot, resolved };
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

async function withActionErrors(
  action: MobileActionName,
  fallbackCode: string,
  operation: (context: ActionToolContext) => Promise<unknown>,
): Promise<
  | { content: [{ type: 'text'; text: string }] }
  | { isError: true; content: [{ type: 'text'; text: string }] }
> {
  const startedAtMs = Date.now();
  const context: ActionToolContext = {};
  try {
    return jsonResult(await operation(context));
  } catch (error: unknown) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            actionErrorEnvelope(action, fallbackCode, error, startedAtMs, context),
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

function hasUniqueLocator(snapshot: HierarchySnapshot, node: HierarchyNode): boolean {
  return Boolean(node.locator && locatorIsUnique(snapshot, node.locator));
}

function requireActionableNode(
  snapshot: HierarchySnapshot,
  nodeId: string,
): HierarchyNode {
  let node: HierarchyNode;
  try {
    node = nodeById(snapshot, nodeId);
  } catch (error: unknown) {
    throw new MobileAgentError(
      'NODE_NOT_FOUND',
      error instanceof Error ? error.message : String(error),
      'Capture a fresh tree and choose a returned node ID.',
    );
  }
  if (!node.visible || !node.enabled) {
    throw new MobileAgentError(
      'ELEMENT_NOT_ACTIONABLE',
      `Node ${node.id} is not both visible and enabled.`,
    );
  }
  return node;
}

function requireNodeActionMethod(
  node: HierarchyNode,
  useNativeLocator: boolean,
  allowCoordinateFallback: boolean,
): void {
  if (!useNativeLocator && !allowCoordinateFallback) {
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
      `Node ${node.id} has no non-empty screen bounds for a coordinate action.`,
    );
  }
}

function requireUniqueLocator(
  snapshot: HierarchySnapshot,
  node: HierarchyNode,
): NonNullable<HierarchyNode['locator']> {
  if (!node.locator || !locatorIsUnique(snapshot, node.locator)) {
    throw new MobileAgentError(
      'STABLE_LOCATOR_UNAVAILABLE',
      `Node ${node.id} has no unique native accessibility/resource locator.`,
      'Capture a fresh tree and select a node with a unique accessibilityId or resourceId.',
    );
  }
  return node.locator;
}

function nodeActionTarget(
  snapshot: HierarchySnapshot,
  node: HierarchyNode,
  useNativeLocator: boolean,
): Record<string, unknown> {
  return {
    snapshotId: snapshot.id,
    nodeId: node.id,
    method: useNativeLocator ? 'native-element' : 'snapshot-coordinates',
    ...(useNativeLocator && node.locator ? { locator: node.locator } : {}),
    ...(!useNativeLocator && node.bounds ? { bounds: node.bounds } : {}),
  };
}

async function resolveNodePoint(
  resolved: ResolvedDriver,
  snapshot: HierarchySnapshot,
  node: HierarchyNode,
  allowCoordinateFallback: boolean,
): Promise<{ x: number; y: number; method: 'native-element' | 'snapshot-coordinates' }> {
  const useNativeLocator = hasUniqueLocator(snapshot, node);
  requireNodeActionMethod(node, useNativeLocator, allowCoordinateFallback);
  if (useNativeLocator && node.locator) {
    const elementId = await findNativeElementId(
      resolved.driver,
      node.locator.strategy,
      node.locator.selector,
    );
    const rect = await getNativeElementRect(resolved.driver, elementId);
    return { ...center(rect), method: 'native-element' };
  }
  if (!node.bounds) throw new Error('Validated coordinate bounds became unavailable.');
  return { ...center(node.bounds), method: 'snapshot-coordinates' };
}

function center(rect: { x: number; y: number; width: number; height: number }): {
  x: number;
  y: number;
} {
  return {
    x: Math.round(rect.x + rect.width / 2),
    y: Math.round(rect.y + rect.height / 2),
  };
}

function requirePointInWindow(
  point: { x: number; y: number },
  rect: { x: number; y: number; width: number; height: number },
  label: string,
): void {
  if (
    point.x < rect.x ||
    point.x >= rect.x + rect.width ||
    point.y < rect.y ||
    point.y >= rect.y + rect.height
  ) {
    throw new MobileAgentError(
      'COORDINATES_OUT_OF_BOUNDS',
      `${label} (${point.x}, ${point.y}) is outside the native window (${rect.x}, ${rect.y}, ${rect.width}x${rect.height}).`,
    );
  }
}

function scrollPoints(
  rect: { x: number; y: number; width: number; height: number },
  direction: 'up' | 'down' | 'left' | 'right',
  distance: number,
): {
  source: { x: number; y: number };
  destination: { x: number; y: number };
} {
  const centerX = Math.round(rect.x + rect.width / 2);
  const centerY = Math.round(rect.y + rect.height / 2);
  const horizontalSpan = Math.round((rect.width * distance) / 2);
  const verticalSpan = Math.round((rect.height * distance) / 2);
  switch (direction) {
    case 'up':
      return {
        source: { x: centerX, y: centerY + verticalSpan },
        destination: { x: centerX, y: centerY - verticalSpan },
      };
    case 'down':
      return {
        source: { x: centerX, y: centerY - verticalSpan },
        destination: { x: centerX, y: centerY + verticalSpan },
      };
    case 'left':
      return {
        source: { x: centerX + horizontalSpan, y: centerY },
        destination: { x: centerX - horizontalSpan, y: centerY },
      };
    case 'right':
      return {
        source: { x: centerX - horizontalSpan, y: centerY },
        destination: { x: centerX + horizontalSpan, y: centerY },
      };
  }
}

function lifecycleActionName(args: unknown): MobileActionName {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return 'app_lifecycle';
  const action = (args as Record<string, unknown>).action;
  return action === 'activate' || action === 'terminate' || action === 'background'
    ? action
    : 'app_lifecycle';
}

function validateDeepLink(value: string): void {
  try {
    const url = new URL(value);
    if (!url.protocol || url.protocol === ':') throw new Error('missing protocol');
  } catch {
    throw new MobileAgentError(
      'INVALID_DEEP_LINK',
      'Deep-link URL must be an absolute URL with a scheme.',
    );
  }
}

async function resolveReloadIdentity(
  core: AppiumMcpCore,
  options: {
    sessionId?: string | undefined;
    platform?: 'ios' | 'android' | undefined;
  },
): Promise<MobileActionIdentity> {
  const sessionId = options.sessionId ?? core.getSessionId() ?? undefined;
  if (sessionId) {
    const resolved = resolveNativeDriver(core, sessionId);
    if (options.platform && options.platform !== resolved.platform) {
      throw new MobileAgentError(
        'PLATFORM_MISMATCH',
        `Session ${resolved.sessionId} targets ${resolved.platform}, not ${options.platform}.`,
      );
    }
    return identityFromDriver(resolved);
  }

  const report = await runDoctor(loadConfig());
  const platform =
    options.platform ??
    (report.readyPlatforms.length === 1 ? report.readyPlatforms[0] : undefined);
  if (!platform) {
    throw new MobileAgentError(
      'PLATFORM_REQUIRED',
      'Reload target is ambiguous because no Appium session is active.',
      'Pass platform=ios or platform=android, or create an Appium session first.',
    );
  }
  if (!report.readyPlatforms.includes(platform)) {
    throw new MobileAgentError(
      'DEVICE_NOT_READY',
      `The selected ${platform} device is not ready for Wave automation.`,
      'Run mobile_doctor and resolve the selected platform diagnostics.',
    );
  }
  const deviceId =
    platform === 'ios' ? report.ios.selected?.udid : report.android.selected?.serial;
  if (!deviceId) {
    throw new MobileAgentError(
      'DEVICE_NOT_FOUND',
      `No selected ${platform} device is available.`,
    );
  }
  return {
    platform,
    deviceId,
    applicationId: platform === 'ios' ? IOS_BUNDLE_ID : ANDROID_PACKAGE,
  };
}
