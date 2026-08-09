/**
 * Voice-harness entry point: one fake gateway listener plus a localhost-only
 * control listener (scenario load, journal read, reset).
 */
import { createServer, type IncomingMessage, type Server } from 'node:http';

import {
  startGatewayServer,
  type RunningGatewayServer,
} from './gateway-server.js';
import { Journal } from './journal.js';
import { normalizeScenario } from './scenario.js';
import { HarnessState } from './state.js';

export interface VoiceHarnessOptions {
  controlPort?: number;
  gatewayPort?: number;
  host?: string;
}

export interface RunningVoiceHarness {
  activeTurnCount(): number;
  close(): Promise<void>;
  controlUrl: string;
  gatewayUrl: string;
  journal: Journal;
  state: HarnessState;
}

const MAX_CONTROL_BODY_BYTES = 1024 * 1024;

export async function startVoiceHarness(
  options: VoiceHarnessOptions = {},
): Promise<RunningVoiceHarness> {
  const host = options.host ?? '127.0.0.1';
  const journal = new Journal();
  const state = new HarnessState();

  const gateway = await startGatewayServer({
    host,
    journal,
    port: options.gatewayPort ?? 8790,
    state,
  });

  const control = createServer((request, response) => {
    void handleControl(request).then(
      ({ body, status }) => {
        response.writeHead(status, { 'content-type': 'application/json' });
        response.end(JSON.stringify(body));
      },
      () => {
        response.writeHead(500);
        response.end();
      },
    );
  });

  async function handleControl(
    request: IncomingMessage,
  ): Promise<{ body: unknown; status: number }> {
    const path = new URL(request.url ?? '/', `http://${host}`).pathname;
    const method = request.method ?? 'GET';
    if (method === 'GET' && path === '/control/journal') {
      return { body: { entries: journal.list() }, status: 200 };
    }
    if (method === 'GET' && path === '/control/status') {
      return {
        body: {
          activeTurns: gateway.activeTurnCount(),
          gatewayUrl: gateway.url,
          sessions: state.listSessions().length,
        },
        status: 200,
      };
    }
    if (method === 'POST' && path === '/control/scenario') {
      const chunks: Buffer[] = [];
      let total = 0;
      for await (const chunk of request) {
        const buffer = chunk as Buffer;
        total += buffer.byteLength;
        if (total > MAX_CONTROL_BODY_BYTES) {
          return { body: { error: 'scenario too large' }, status: 413 };
        }
        chunks.push(buffer);
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        return { body: { error: 'scenario is not JSON' }, status: 400 };
      }
      state.loadScenario(normalizeScenario(parsed));
      return { body: { ok: true }, status: 200 };
    }
    if (method === 'POST' && path === '/control/reset') {
      state.reset();
      journal.clear();
      return { body: { ok: true }, status: 200 };
    }
    return { body: { error: 'unknown control route' }, status: 404 };
  }

  await new Promise<void>((resolve, reject) => {
    control.once('error', reject);
    // The control plane stays loopback-only regardless of the gateway host.
    control.listen(options.controlPort ?? 8791, '127.0.0.1', () => {
      control.removeListener('error', reject);
      resolve();
    });
  });
  const controlAddress = control.address();
  const controlPort =
    typeof controlAddress === 'object' && controlAddress !== null
      ? controlAddress.port
      : (options.controlPort ?? 8791);

  return {
    activeTurnCount: () => gateway.activeTurnCount(),
    close: async () => {
      await gateway.close();
      await closeServer(control);
    },
    controlUrl: `http://127.0.0.1:${controlPort}`,
    gatewayUrl: gateway.url,
    journal,
    state,
  };
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

export { Journal } from './journal.js';
export { HarnessState } from './state.js';
export type { HarnessScenario } from './scenario.js';
export type { RunningGatewayServer } from './gateway-server.js';
