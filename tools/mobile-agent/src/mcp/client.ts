import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from '@modelcontextprotocol/sdk/client/stdio.js';
import { z } from 'zod';

import type { MobileAgentConfig } from '../config.js';

const toolResultSchema = z
  .object({
    isError: z.boolean().optional(),
    content: z
      .array(
        z
          .object({
            type: z.string(),
            text: z.string().optional(),
          })
          .passthrough(),
      )
      .default([]),
  })
  .passthrough();

export interface ToolTextResult {
  isError: boolean;
  text: string;
  raw: unknown;
}

export interface MobileAgentMcpClient {
  client: Client;
  close: () => Promise<void>;
}

export async function connectMobileAgentClient(
  config: MobileAgentConfig,
  options: { forwardStderr?: boolean; extraEnv?: Record<string, string> } = {},
): Promise<MobileAgentMcpClient> {
  const serverPath = fileURLToPath(new URL('../server.js', import.meta.url));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--enable-source-maps', serverPath],
    cwd: config.projectRoot,
    env: { ...inheritedEnvironment(config), ...options.extraEnv },
    stderr: 'pipe',
  });

  if (options.forwardStderr) {
    transport.stderr?.on('data', (chunk: Buffer | string) => {
      process.stderr.write(chunk);
    });
  }

  const client = new Client(
    {
      name: 'wave-mobile-agent-cli',
      version: '0.1.0',
    },
    {
      capabilities: {},
    },
  );
  await client.connect(transport);

  return {
    client,
    close: async () => {
      await client.close();
    },
  };
}

export async function callToolText(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
  timeout = 120_000,
): Promise<ToolTextResult> {
  const raw = await client.callTool(
    {
      name,
      arguments: args,
    },
    undefined,
    { timeout },
  );
  const parsed = toolResultSchema.parse(raw);
  return {
    isError: parsed.isError === true,
    text: parsed.content
      .filter((item) => item.type === 'text' && typeof item.text === 'string')
      .map((item) => item.text)
      .join('\n'),
    raw,
  };
}

function inheritedEnvironment(
  config: MobileAgentConfig,
): Record<string, string> {
  const env: Record<string, string> = {
    ...getDefaultEnvironment(),
    MOBILE_AGENT_PROJECT_ROOT: config.projectRoot,
    MOBILE_AGENT_IOS_DEVICE_SET: config.iosDeviceSetPath,
    MOBILE_AGENT_ARTIFACTS_DIR: config.artifactsDir,
    MOBILE_AGENT_TRACE_MAX_COUNT: String(config.traceMaxCount),
    MOBILE_AGENT_TRACE_MAX_AGE_DAYS: String(config.traceMaxAgeDays),
    NO_UI: '1',
    APPIUM_MCP_EVIDENCE: 'true',
    APPIUM_MCP_ON_CLIENT_DISCONNECT: 'delete_all',
  };
  delete env.MOBILE_AGENT_PAIRING_CODE;
  delete env.MOBILE_AGENT_PAIRING_URL;
  const optionalNames = [
    'ANDROID_HOME',
    'ANDROID_SDK_ROOT',
    'DEVELOPER_DIR',
    'JAVA_HOME',
    'MOBILE_AGENT_ANDROID_SERIAL',
    'MOBILE_AGENT_IOS_UDID',
    'MOBILE_AGENT_METRO_URL',
    'MOBILE_AGENT_OBSERVABILITY_TARGET_ID',
  ] as const;
  for (const name of optionalNames) {
    const value = process.env[name];
    if (value) {
      env[name] = value;
    }
  }
  if (config.androidSerial) {
    env.MOBILE_AGENT_ANDROID_SERIAL = config.androidSerial;
  }
  if (config.iosUdid) {
    env.MOBILE_AGENT_IOS_UDID = config.iosUdid;
  }
  return env;
}
