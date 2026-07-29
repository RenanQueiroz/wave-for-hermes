import assert from 'node:assert/strict';
import test from 'node:test';

import {
  findHierarchyNodes,
  HierarchyStore,
  nodeById,
  parseHierarchy,
  serializeHierarchy,
} from './hierarchy.js';

const IOS_XML = `<?xml version="1.0"?>
<AppiumAUT>
  <XCUIElementTypeApplication type="XCUIElementTypeApplication" name="wave" enabled="true" visible="true" x="0" y="0" width="402" height="874">
    <XCUIElementTypeButton type="XCUIElementTypeButton" name="Explore" label="Explore" enabled="true" visible="true" accessible="true" x="197" y="795" width="94" height="54" traits="Button"/>
  </XCUIElementTypeApplication>
</AppiumAUT>`;

const ANDROID_XML = `<?xml version="1.0"?>
<hierarchy>
  <android.widget.FrameLayout enabled="true" displayed="true" bounds="[0,0][1080,2400]">
    <android.widget.Button text="Continue" resource-id="com.renanqueiroz.wave:id/continue" content-desc="Continue" clickable="true" enabled="true" displayed="true" bounds="[20,100][220,180]"/>
    <android.view.View clickable="true" enabled="true" displayed="true" bounds="[20,200][220,280]">
      <android.widget.TextView text="Explore" resource-id="com.renanqueiroz.wave:id/navigation_bar_item_small_label_view" a11y-important="false" clickable="false" enabled="true" displayed="true" bounds="[40,220][200,260]"/>
    </android.view.View>
  </android.widget.FrameLayout>
</hierarchy>`;

test('normalizes iOS accessibility nodes and locators', () => {
  const snapshot = parseHierarchy(IOS_XML, 'ios-session', 'ios');
  const result = findHierarchyNodes(snapshot, { text: 'explore', interactiveOnly: true });

  assert.equal(result.length, 1);
  const [node] = result;
  assert.ok(node);
  assert.equal(node.role, 'button');
  assert.deepEqual(node.bounds, { x: 197, y: 795, width: 94, height: 54 });
  assert.deepEqual(node.locator, {
    strategy: 'accessibility id',
    selector: 'Explore',
  });
  assert.equal(nodeById(snapshot, node.id).label, 'Explore');
});

test('normalizes Android resource IDs and bounds', () => {
  const snapshot = parseHierarchy(ANDROID_XML, 'android-session', 'android');
  const result = findHierarchyNodes(snapshot, {
    resourceId: 'com.renanqueiroz.wave:id/continue',
    exact: true,
  });

  assert.equal(result.length, 1);
  const [node] = result;
  assert.ok(node);
  assert.deepEqual(node.bounds, { x: 20, y: 100, width: 200, height: 80 });
  assert.equal(node.accessibilityId, 'Continue');
  assert.equal(node.clickable, true);
});

test('labels clickable Android containers from their single descendant text', () => {
  const snapshot = parseHierarchy(ANDROID_XML, 'android-session', 'android');
  const result = findHierarchyNodes(snapshot, {
    text: 'Explore',
    exact: true,
    interactiveOnly: true,
  });

  assert.equal(result.length, 1);
  const [node] = result;
  assert.ok(node);
  assert.equal(node.role, 'button');
  assert.equal(node.label, 'Explore');
  assert.equal(node.locator, undefined);
  assert.deepEqual(node.bounds, { x: 20, y: 200, width: 200, height: 80 });
});

test('stores bounded snapshots and serializes filtered output', () => {
  const store = new HierarchyStore();
  const first = store.capture(IOS_XML, 'session', 'ios');
  const second = store.capture(IOS_XML, 'session', 'ios');

  assert.equal(store.isLatest(first.id, 'session'), false);
  assert.equal(store.isLatest(second.id, 'session'), true);
  store.invalidate('session');
  assert.equal(store.isLatest(second.id, 'session'), false);
  assert.equal(store.get(second.id)?.id, second.id);
  const serialized = serializeHierarchy(second, { interactiveOnly: true, maxNodes: 1 });
  assert.equal(serialized.returnedNodeCount, 1);
  assert.equal(serialized.nodes.at(0)?.accessibilityId, 'Explore');
});
