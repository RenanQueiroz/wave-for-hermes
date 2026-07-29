#!/usr/bin/env node

import { mkdir } from 'node:fs/promises';

import { createAppiumMcpServer, verifyAppiumMcpNames } from 'appium-mcp/core';

import { loadConfig } from './config.js';
import { WaveMobileAgentPlugin } from './mcp/plugin.js';

const config = loadConfig();
await mkdir(config.artifactsDir, { recursive: true });

process.env.NO_UI ??= '1';
process.env.SCREENSHOTS_DIR ??= config.artifactsDir;
process.env.APPIUM_MCP_EVIDENCE ??= 'true';
process.env.APPIUM_MCP_ON_CLIENT_DISCONNECT ??= 'delete_all';

const plugins = [new WaveMobileAgentPlugin()];
const verification = verifyAppiumMcpNames({ plugins });
if (!verification.ok) {
  throw new Error(`Invalid mobile-agent MCP registration: ${JSON.stringify(verification)}`);
}

const server = await createAppiumMcpServer({
  serverName: 'Wave Mobile Agent',
  serverVersion: '0.1.0',
  plugins,
  additionalInstructions:
    'Run mobile_doctor before creating a local session. Use mobile_get_capabilities and pass the complete result capabilities to appium_session_management action=create. Never erase, uninstall, clear app data, or switch devices without explicit user authorization.',
});

await server.start({ transportType: 'stdio' });
