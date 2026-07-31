#!/usr/bin/env node

import { mkdir } from 'node:fs/promises';

import { loadConfig } from './config.js';
import {
  androidSdkRootFromAdbPath,
  discoverAndroid,
} from './discovery/android.js';
import { WaveMobileAgentPlugin } from './mcp/plugin.js';

const config = loadConfig();
await mkdir(config.artifactsDir, { recursive: true });

process.env.NO_UI ??= '1';
process.env.SCREENSHOTS_DIR ??= config.artifactsDir;
process.env.APPIUM_MCP_EVIDENCE ??= 'true';
process.env.APPIUM_MCP_ON_CLIENT_DISCONNECT ??= 'delete_all';
if (!process.env.ANDROID_HOME && !process.env.ANDROID_SDK_ROOT) {
  const android = await discoverAndroid(config);
  const sdkRoot = androidSdkRootFromAdbPath(android.adbPath);
  if (sdkRoot) process.env.ANDROID_HOME = sdkRoot;
}

// Appium resolves the Android SDK while its modules are loading, so discover and
// export the SDK root before importing the core package.
const { createAppiumMcpServer, verifyAppiumMcpNames } =
  await import('appium-mcp/core');

const plugins = [new WaveMobileAgentPlugin()];
const verification = verifyAppiumMcpNames({ plugins });
if (!verification.ok) {
  throw new Error(
    `Invalid mobile-agent MCP registration: ${JSON.stringify(verification)}`,
  );
}

const server = await createAppiumMcpServer({
  serverName: 'Wave Mobile Agent',
  serverVersion: '0.1.0',
  plugins,
  additionalInstructions:
    'Run mobile_doctor before creating a local session. Use mobile_get_capabilities and pass the complete result capabilities to appium_session_management action=create. Never erase, uninstall, clear app data, or switch devices without explicit user authorization.',
});

await server.start({ transportType: 'stdio' });
