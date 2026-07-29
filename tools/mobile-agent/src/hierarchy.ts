import { createHash, randomUUID } from 'node:crypto';

import { DOMParser } from '@xmldom/xmldom';

import type { MobilePlatform } from './types.js';

export interface ElementBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ElementLocator {
  strategy: 'accessibility id' | 'id';
  selector: string;
}

export interface HierarchyNode {
  id: string;
  parentId?: string;
  path: string;
  platform: MobilePlatform;
  type: string;
  role: string;
  name?: string;
  label?: string;
  text?: string;
  value?: string;
  accessibilityId?: string;
  resourceId?: string;
  enabled: boolean;
  visible: boolean;
  accessible: boolean;
  clickable: boolean;
  selected: boolean;
  bounds?: ElementBounds;
  locator?: ElementLocator;
  childIds: string[];
}

export interface HierarchySnapshot {
  id: string;
  sessionId: string;
  platform: MobilePlatform;
  createdAt: string;
  rootIds: string[];
  nodes: HierarchyNode[];
}

export interface HierarchyQuery {
  text?: string | undefined;
  role?: string | undefined;
  type?: string | undefined;
  accessibilityId?: string | undefined;
  resourceId?: string | undefined;
  exact?: boolean;
  visibleOnly?: boolean;
  interactiveOnly?: boolean;
}

export interface SerializedHierarchy {
  snapshotId: string;
  sessionId: string;
  platform: MobilePlatform;
  createdAt: string;
  totalNodeCount: number;
  returnedNodeCount: number;
  truncated: boolean;
  nodes: HierarchyNode[];
}

const MAX_SNAPSHOTS = 12;
type XmlElement = NonNullable<ReturnType<DOMParser['parseFromString']>['documentElement']>;

export class HierarchyStore {
  private readonly snapshots = new Map<string, HierarchySnapshot>();
  private readonly latestBySession = new Map<string, string>();

  capture(xml: string, sessionId: string, platform: MobilePlatform): HierarchySnapshot {
    const snapshot = parseHierarchy(xml, sessionId, platform);
    this.snapshots.set(snapshot.id, snapshot);
    this.latestBySession.set(sessionId, snapshot.id);
    while (this.snapshots.size > MAX_SNAPSHOTS) {
      const oldestId = this.snapshots.keys().next().value as string | undefined;
      if (!oldestId) break;
      const oldest = this.snapshots.get(oldestId);
      this.snapshots.delete(oldestId);
      if (oldest && this.latestBySession.get(oldest.sessionId) === oldestId) {
        this.latestBySession.delete(oldest.sessionId);
      }
    }
    return snapshot;
  }

  get(snapshotId: string): HierarchySnapshot | undefined {
    return this.snapshots.get(snapshotId);
  }

  latest(sessionId: string): HierarchySnapshot | undefined {
    const id = this.latestBySession.get(sessionId);
    return id ? this.snapshots.get(id) : undefined;
  }

  isLatest(snapshotId: string, sessionId: string): boolean {
    return this.latestBySession.get(sessionId) === snapshotId;
  }
}

export function parseHierarchy(
  xml: string,
  sessionId: string,
  platform: MobilePlatform,
): HierarchySnapshot {
  let parseError: string | undefined;
  const document = new DOMParser({
    onError: (level, message) => {
      if (level === 'error' || level === 'fatalError') parseError = message;
    },
  }).parseFromString(xml, 'application/xml');
  if (parseError) {
    throw new Error(`Could not parse native hierarchy XML: ${parseError}`);
  }
  const documentRoot = document.documentElement;
  if (!documentRoot || documentRoot.nodeName === 'parsererror') {
    throw new Error('Could not parse native hierarchy XML: no document root.');
  }

  const nodes: HierarchyNode[] = [];
  const rootIds: string[] = [];

  visitElement(documentRoot, undefined, '0', platform, nodes, rootIds);
  if (nodes.length === 0) {
    throw new Error('The native hierarchy did not contain any elements.');
  }
  if (platform === 'android') {
    enrichAndroidInteractiveLabels(nodes);
  }

  return {
    id: randomUUID(),
    sessionId,
    platform,
    createdAt: new Date().toISOString(),
    rootIds,
    nodes,
  };
}

export function serializeHierarchy(
  snapshot: HierarchySnapshot,
  options: {
    visibleOnly?: boolean;
    interactiveOnly?: boolean;
    maxDepth?: number;
    maxNodes?: number;
  } = {},
): SerializedHierarchy {
  const {
    visibleOnly = true,
    interactiveOnly = false,
    maxDepth = 40,
    maxNodes = 500,
  } = options;
  const filtered = snapshot.nodes.filter((node) => {
    if (visibleOnly && !node.visible) return false;
    if (interactiveOnly && !isInteractive(node)) return false;
    return pathDepth(node.path) <= maxDepth;
  });
  const returned = filtered.slice(0, maxNodes);
  return {
    snapshotId: snapshot.id,
    sessionId: snapshot.sessionId,
    platform: snapshot.platform,
    createdAt: snapshot.createdAt,
    totalNodeCount: snapshot.nodes.length,
    returnedNodeCount: returned.length,
    truncated: returned.length < filtered.length,
    nodes: returned,
  };
}

export function findHierarchyNodes(
  snapshot: HierarchySnapshot,
  query: HierarchyQuery,
): HierarchyNode[] {
  const exact = query.exact ?? false;
  return snapshot.nodes.filter((node) => {
    if (query.visibleOnly !== false && !node.visible) return false;
    if (query.interactiveOnly && !isInteractive(node)) return false;
    if (!matches(node.role, query.role, exact)) return false;
    if (!matches(node.type, query.type, exact)) return false;
    if (!matches(node.accessibilityId, query.accessibilityId, exact)) return false;
    if (!matches(node.resourceId, query.resourceId, exact)) return false;
    if (
      query.text &&
      ![node.name, node.label, node.text, node.value, node.accessibilityId].some((value) =>
        matches(value, query.text, exact),
      )
    ) {
      return false;
    }
    return true;
  });
}

export function nodeById(snapshot: HierarchySnapshot, nodeId: string): HierarchyNode {
  const node = snapshot.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) {
    throw new Error(`Node ${nodeId} does not exist in snapshot ${snapshot.id}.`);
  }
  return node;
}

export function isInteractive(node: HierarchyNode): boolean {
  return node.enabled && (node.clickable || node.accessible);
}

function visitElement(
  element: XmlElement,
  parentId: string | undefined,
  path: string,
  platform: MobilePlatform,
  nodes: HierarchyNode[],
  rootIds: string[],
): void {
  const attributes = readAttributes(element);
  const type = attributes.type || element.tagName;
  const id = `node-${createHash('sha256')
    .update(`${platform}:${path}:${type}:${attributes.name ?? ''}:${attributes['resource-id'] ?? ''}`)
    .digest('hex')
    .slice(0, 16)}`;
  const node = normalizeNode(id, parentId, path, type, attributes, platform);
  nodes.push(node);
  if (parentId) {
    const parent = nodes.find((candidate) => candidate.id === parentId);
    parent?.childIds.push(id);
  } else {
    rootIds.push(id);
  }

  let elementIndex = 0;
  for (let child = element.firstChild; child; child = child.nextSibling) {
    if (child.nodeType !== 1) continue;
    visitElement(
      child as XmlElement,
      id,
      `${path}.${elementIndex}`,
      platform,
      nodes,
      rootIds,
    );
    elementIndex += 1;
  }
}

function normalizeNode(
  id: string,
  parentId: string | undefined,
  path: string,
  type: string,
  attributes: Record<string, string>,
  platform: MobilePlatform,
): HierarchyNode {
  const isIos = platform === 'ios';
  const accessible = isIos
    ? booleanAttribute(attributes.accessible, false)
    : Boolean(firstNonEmpty(attributes['content-desc']));
  const accessibilityId = isIos
    ? firstNonEmpty(attributes.name, attributes.label)
    : firstNonEmpty(attributes['content-desc']);
  const resourceId = firstNonEmpty(attributes['resource-id']);
  const name = firstNonEmpty(attributes.name);
  const label = firstNonEmpty(attributes.label, attributes['content-desc']);
  const text = firstNonEmpty(attributes.text);
  const value = firstNonEmpty(attributes.value);
  const locator = accessibilityId && (!isIos || accessible || type.endsWith('Button'))
    ? { strategy: 'accessibility id' as const, selector: accessibilityId }
    : resourceId
      ? { strategy: 'id' as const, selector: resourceId }
      : undefined;
  const bounds = isIos ? iosBounds(attributes) : androidBounds(attributes.bounds);
  const role = normalizeRole(type, attributes);

  return {
    id,
    ...(parentId ? { parentId } : {}),
    path,
    platform,
    type,
    role,
    ...(name ? { name } : {}),
    ...(label ? { label } : {}),
    ...(text ? { text } : {}),
    ...(value ? { value } : {}),
    ...(accessibilityId ? { accessibilityId } : {}),
    ...(resourceId ? { resourceId } : {}),
    enabled: booleanAttribute(attributes.enabled, true),
    visible: isIos
      ? booleanAttribute(attributes.visible, true)
      : booleanAttribute(attributes.displayed, true),
    accessible,
    clickable:
      booleanAttribute(attributes.clickable, false) ||
      type.endsWith('Button') ||
      type === 'android.widget.Button',
    selected: booleanAttribute(attributes.selected, false) || /\bSelected\b/.test(attributes.traits ?? ''),
    ...(bounds ? { bounds } : {}),
    ...(locator ? { locator } : {}),
    childIds: [],
  };
}

function enrichAndroidInteractiveLabels(nodes: HierarchyNode[]): void {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  for (const node of [...nodes].reverse()) {
    if (!node.clickable || node.name || node.label || node.text || node.value) {
      continue;
    }
    const descendants = descendantNodes(node, byId);
    const textValues = uniqueNonEmpty(descendants.map((descendant) => descendant.text));
    const semanticValues =
      textValues.length > 0
        ? textValues
        : uniqueNonEmpty(
            descendants.flatMap((descendant) => [
              descendant.label,
              descendant.name,
              descendant.accessibilityId,
            ]),
          );
    const semanticValue = semanticValues.length === 1 ? semanticValues[0] : undefined;
    if (semanticValue) {
      node.label = semanticValue;
    }
  }
}

function descendantNodes(
  root: HierarchyNode,
  byId: Map<string, HierarchyNode>,
): HierarchyNode[] {
  const result: HierarchyNode[] = [];
  const pending = [...root.childIds];
  while (pending.length > 0 && result.length < 100) {
    const id = pending.shift();
    if (!id) break;
    const node = byId.get(id);
    if (!node) continue;
    result.push(node);
    pending.push(...node.childIds);
  }
  return result;
}

function uniqueNonEmpty(values: Array<string | undefined>): string[] {
  return [
    ...new Set(
      values
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  ];
}

function readAttributes(element: XmlElement): Record<string, string> {
  const result: Record<string, string> = {};
  for (let index = 0; index < element.attributes.length; index += 1) {
    const attribute = element.attributes.item(index);
    if (attribute) result[attribute.name] = attribute.value;
  }
  return result;
}

function booleanAttribute(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value === 'true' || value === '1';
}

function iosBounds(attributes: Record<string, string>): ElementBounds | undefined {
  const values = [attributes.x, attributes.y, attributes.width, attributes.height].map(Number);
  if (values.some((value) => !Number.isFinite(value))) return undefined;
  const [x, y, width, height] = values;
  if (x === undefined || y === undefined || width === undefined || height === undefined) {
    return undefined;
  }
  return { x, y, width, height };
}

function androidBounds(value: string | undefined): ElementBounds | undefined {
  const match = value?.match(/^\[(-?\d+),(-?\d+)]\[(-?\d+),(-?\d+)]$/);
  if (!match) return undefined;
  const [, x1, y1, x2, y2] = match.map(Number);
  if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) {
    return undefined;
  }
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

function normalizeRole(type: string, attributes: Record<string, string>): string {
  const raw = type.replace(/^XCUIElementType/, '').replace(/^android\.widget\./, '');
  if (/button/i.test(raw) || booleanAttribute(attributes.clickable, false)) return 'button';
  if (/text(field|view)|edittext/i.test(raw)) return 'text-input';
  if (/statictext|textview/i.test(raw)) return 'text';
  if (/image/i.test(raw)) return 'image';
  if (/switch/i.test(raw)) return 'switch';
  if (/tabbar/i.test(raw)) return 'tab-bar';
  if (/application/i.test(raw)) return 'application';
  if (/window/i.test(raw)) return 'window';
  return raw.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase() || 'element';
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => Boolean(value?.trim()));
}

function matches(value: string | undefined, query: string | undefined, exact: boolean): boolean {
  if (query === undefined) return true;
  if (value === undefined) return false;
  return exact
    ? value.localeCompare(query, undefined, { sensitivity: 'accent' }) === 0
    : value.toLocaleLowerCase().includes(query.toLocaleLowerCase());
}

function pathDepth(path: string): number {
  return path.split('.').length - 1;
}
