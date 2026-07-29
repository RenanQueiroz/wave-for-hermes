import assert from 'node:assert/strict';
import test from 'node:test';

import { loadConfig } from '../config.js';
import { callToolText, connectMobileAgentClient } from './client.js';

test('registers the Wave and Appium tools required by architecture sections 6 through 11', async () => {
  const connection = await connectMobileAgentClient(loadConfig());
  try {
    const result = await connection.client.listTools();
    const names = new Set(result.tools.map((tool) => tool.name));
    const requiredTools = [
      'appium_app_lifecycle',
      'appium_drag_and_drop',
      'appium_gesture',
      'appium_mobile_press_key',
      'appium_screenshot',
      'appium_session_management',
      'appium_set_value',
      'mobile_clear_observability',
      'mobile_clear_text',
      'mobile_doctor',
      'mobile_drag',
      'mobile_find_elements',
      'mobile_app_lifecycle',
      'mobile_get_element_tree',
      'mobile_get_logs',
      'mobile_get_native_logs',
      'mobile_get_network_request',
      'mobile_get_network_requests',
      'mobile_list_devices',
      'mobile_list_state_providers',
      'mobile_long_press',
      'mobile_open_deep_link',
      'mobile_press_key',
      'mobile_read_state',
      'mobile_reload',
      'mobile_scroll',
      'mobile_swipe',
      'mobile_tap',
      'mobile_type_text',
    ];

    assert.deepEqual(
      requiredTools.filter((name) => !names.has(name)),
      [],
    );

    const toolsByName = new Map(result.tools.map((tool) => [tool.name, tool]));
    assert.deepEqual(
      enumValues(toolsByName.get('appium_gesture')?.inputSchema, 'action'),
      [
        'tap',
        'double_tap',
        'long_press',
        'scroll',
        'swipe',
        'pinch_zoom',
        'scroll_to_element',
        'back',
      ],
    );
    assert.deepEqual(
      enumValues(toolsByName.get('appium_app_lifecycle')?.inputSchema, 'action'),
      [
        'activate',
        'terminate',
        'install',
        'uninstall',
        'list',
        'is_installed',
        'query_state',
        'background',
        'clear',
        'deep_link',
      ],
    );
    assert.deepEqual(
      enumValues(toolsByName.get('mobile_app_lifecycle')?.inputSchema, 'action'),
      ['activate', 'terminate', 'background'],
    );
    assert.deepEqual(
      enumValues(toolsByName.get('mobile_press_key')?.inputSchema, 'key'),
      ['back', 'home'],
    );
    assert.equal(
      defaultValue(toolsByName.get('mobile_type_text')?.inputSchema, 'captureTrace'),
      false,
    );
    assert.equal(
      defaultValue(toolsByName.get('mobile_open_deep_link')?.inputSchema, 'captureTrace'),
      false,
    );
    assert.equal(names.has('mobile_install_app'), false);
    assert.equal(names.has('mobile_uninstall_app'), false);
    assert.equal(names.has('mobile_clear_app_data'), false);

    const secret = 'should-never-appear-in-action-output';
    const textFailure = await callToolText(connection.client, 'mobile_type_text', {
      snapshotId: '00000000-0000-4000-8000-000000000000',
      nodeId: 'node-missing',
      text: secret,
    });
    assert.equal(textFailure.isError, true);
    assert.equal(textFailure.text.includes(secret), false);
  } finally {
    await connection.close();
  }
});

function enumValues(
  schema: unknown,
  property: string,
): unknown[] {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return [];
  const properties = (schema as Record<string, unknown>).properties;
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return [];
  const value = (properties as Record<string, unknown>)[property];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const enumValue = (value as Record<string, unknown>).enum;
  return Array.isArray(enumValue) ? enumValue : [];
}

function defaultValue(schema: unknown, property: string): unknown {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return undefined;
  const properties = (schema as Record<string, unknown>).properties;
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return undefined;
  const value = (properties as Record<string, unknown>)[property];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return (value as Record<string, unknown>).default;
}
