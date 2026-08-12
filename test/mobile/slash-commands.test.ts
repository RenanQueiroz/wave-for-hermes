import assert from 'node:assert/strict';
import test from 'node:test';

import {
  busyComposerLane,
  CATALOG_UNAVAILABLE_NOTICE,
  detectSlashTrigger,
  highlightedCommandLength,
  leadingSlashToken,
  resolveSlashSubmission,
} from '../../src/features/chat/slash-commands.ts';
import { GatewayClient } from '../../src/services/gateway/gateway-client.ts';
import {
  normalizeCommandCatalog,
  normalizeCommandResult,
} from '../../src/services/gateway/gateway-commands.ts';

const CATALOG = normalizeCommandCatalog({
  canon: {
    '/compact': '/compress',
    '/compress': '/compress',
    '/q': '/queue',
    '/work': '/work',
  },
  pairs: [
    ['/compress', 'Compress the conversation context'],
    ['/usage', 'Show token usage'],
    ['/work', 'Skill: run the work loop'],
    ['/tools', 'Manage tools'],
  ],
  skills: { '/work': { origin: 'user', usage: 7 } },
});

test('catalog normalization keeps bounded entries, kinds, and canon', () => {
  assert.deepEqual(
    CATALOG.entries.map((entry) => [entry.command, entry.kind, entry.usage]),
    [
      ['/compress', 'command', 0],
      ['/usage', 'command', 0],
      ['/work', 'skill', 7],
      ['/tools', 'command', 0],
    ],
  );
  assert.equal(CATALOG.canon['/compact'], '/compress');
  assert.equal(CATALOG.canon['/usage'], '/usage');
  // Junk shapes normalize to an empty catalog rather than throwing.
  assert.deepEqual(normalizeCommandCatalog(null).entries, []);
  assert.deepEqual(
    normalizeCommandCatalog({ pairs: [['no-slash', 'x'], 42] }).entries,
    [],
  );
});

test('command results normalize output, send, prefill, and alias', () => {
  assert.deepEqual(normalizeCommandResult({ output: 'ok' }), {
    directive: { kind: 'output', output: 'ok' },
  });
  assert.deepEqual(
    normalizeCommandResult({
      display: '/work fix it',
      message: 'SCAFFOLD…',
      notice: 'Loading',
      type: 'skill',
    }),
    {
      directive: {
        display: '/work fix it',
        kind: 'send',
        message: 'SCAFFOLD…',
        notice: 'Loading',
      },
    },
  );
  assert.deepEqual(
    normalizeCommandResult({ message: 'draft', type: 'prefill' }),
    {
      directive: { kind: 'prefill', message: 'draft' },
    },
  );
  assert.deepEqual(
    normalizeCommandResult({ target: '/usage', type: 'alias' }),
    {
      aliasTarget: '/usage',
    },
  );
  // An overlong model-facing expansion is refused, never clipped.
  assert.deepEqual(
    normalizeCommandResult({ message: 'x'.repeat(70_000), type: 'send' }),
    {},
  );
});

test('slash triggers: invocation at zero, inline skills after whitespace', () => {
  assert.deepEqual(detectSlashTrigger('/'), {
    kind: 'invocation',
    query: '',
  });
  assert.deepEqual(detectSlashTrigger('/comp'), {
    kind: 'invocation',
    query: 'comp',
  });
  assert.deepEqual(detectSlashTrigger('/steer focus on t'), {
    kind: 'invocation',
    query: 'steer focus on t',
  });
  assert.deepEqual(detectSlashTrigger('please /wo'), {
    kind: 'inline',
    query: 'wo',
  });
  assert.equal(detectSlashTrigger('https://example.com/pa'), undefined);
  assert.equal(detectSlashTrigger('a/b'), undefined);
  assert.equal(detectSlashTrigger('plain text'), undefined);
});

test('submission routing follows the approved registry', () => {
  assert.equal(resolveSlashSubmission('hello there', CATALOG), undefined);
  assert.deepEqual(resolveSlashSubmission('/model', CATALOG), {
    arg: '',
    name: 'model',
    surface: { action: 'model', kind: 'local' },
  });
  assert.deepEqual(resolveSlashSubmission('/compact', CATALOG), {
    arg: '',
    name: 'compress',
    surface: { kind: 'compress' },
  });
  assert.deepEqual(resolveSlashSubmission('/title Fix the tests', CATALOG), {
    arg: 'Fix the tests',
    name: 'title',
    surface: { kind: 'title' },
  });
  assert.deepEqual(resolveSlashSubmission('/steer focus on X', CATALOG), {
    arg: 'focus on X',
    name: 'steer',
    surface: { kind: 'execute' },
  });
  // Cataloged skills execute on the gateway.
  assert.deepEqual(resolveSlashSubmission('/work fix it', CATALOG), {
    arg: 'fix it',
    name: 'work',
    surface: { kind: 'execute' },
  });
  // Administration surface is refused with honest copy, not chatted.
  const tools = resolveSlashSubmission('/tools', CATALOG);
  assert.equal(tools?.surface.kind, 'unavailable');
  // A name neither Wave nor the catalog knows stays ordinary text.
  assert.equal(resolveSlashSubmission('/shrug', CATALOG), undefined);
  assert.equal(resolveSlashSubmission('/shrug', undefined), undefined);
});

test('a gateway without a catalog degrades to an honest notice', () => {
  // Unknown leading-slash text is refused, never silently chatted: Wave
  // cannot tell command from prose without a catalog.
  const degraded = resolveSlashSubmission('/shrug it off', undefined, true);
  assert.equal(degraded?.surface.kind, 'unavailable');
  assert.equal(
    degraded?.surface.kind === 'unavailable'
      ? degraded.surface.reason
      : undefined,
    CATALOG_UNAVAILABLE_NOTICE,
  );
  // Registry commands still resolve without any catalog.
  assert.deepEqual(resolveSlashSubmission('/usage', undefined, true), {
    arg: '',
    name: 'usage',
    surface: { kind: 'execute' },
  });
  assert.equal(
    resolveSlashSubmission('/model', undefined, true)?.surface.kind,
    'local',
  );
  // Ordinary prose is unaffected, and a loaded catalog keeps the
  // stays-ordinary-text rule for unknown names.
  assert.equal(
    resolveSlashSubmission('hello there', undefined, true),
    undefined,
  );
  assert.equal(resolveSlashSubmission('/shrug', CATALOG, true), undefined);
  // The busy lane keeps refused text off the correction/redirect path.
  assert.equal(busyComposerLane('/shrug it off', undefined, true), 'command');
});

test('busy lane and highlight follow submission recognition', () => {
  assert.equal(busyComposerLane('/usage', CATALOG), 'command');
  assert.equal(busyComposerLane('/shrug it off', CATALOG), 'correction');
  assert.equal(busyComposerLane('use the /work skill', CATALOG), 'correction');
  assert.equal(
    highlightedCommandLength('/steer focus', CATALOG),
    '/steer'.length,
  );
  assert.equal(highlightedCommandLength('plain', CATALOG), 0);
  assert.equal(highlightedCommandLength('/shrug', CATALOG), 0);
});

test('token parsing keeps arguments and rejects non-commands', () => {
  assert.deepEqual(leadingSlashToken('/queue do the thing'), {
    arg: 'do the thing',
    name: 'queue',
  });
  assert.equal(leadingSlashToken('//weird'), undefined);
  assert.equal(leadingSlashToken('not /a command'), undefined);
});

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status: 200,
  });
}

function createRpcFake(handlers: {
  onCall(
    method: string,
    params: Record<string, unknown>,
  ): { error?: { code: number; message: string }; result?: unknown };
}) {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  class FakeSocket {
    onopen?: () => void;
    onmessage?: (message: { data: string }) => void;
    onerror?: () => void;
    onclose?: () => void;
    constructor() {
      setTimeout(() => this.onopen?.(), 0);
    }
    send(data: string): void {
      const frame = JSON.parse(data) as {
        id: number;
        method: string;
        params: Record<string, unknown>;
      };
      calls.push({ method: frame.method, params: frame.params });
      const outcome = handlers.onCall(frame.method, frame.params);
      setTimeout(() => {
        this.onmessage?.({
          data: JSON.stringify({
            id: frame.id,
            jsonrpc: '2.0',
            ...(outcome.error
              ? { error: outcome.error }
              : { result: outcome.result ?? {} }),
          }),
        });
      }, 0);
    }
    close(): void {
      // No-op for the fake.
    }
  }
  const fetchImpl = (async (url: string | URL) => {
    if (String(url).endsWith('/api/auth/ws-ticket')) {
      return jsonResponse({ ticket: 't-1' });
    }
    throw new Error(`unexpected request: ${String(url)}`);
  }) as unknown as typeof globalThis.fetch;
  const client = new GatewayClient({
    baseUrl: 'http://localhost:9119',
    fetch: fetchImpl,
    socketFactory: () => new FakeSocket() as unknown as WebSocket,
    tokens: { accessToken: 'a', provider: 'basic', refreshToken: 'r' },
  });
  return { calls, client };
}

test('executeSlashCommand resumes, runs slash.exec, and normalizes output', async () => {
  const { calls, client } = createRpcFake({
    onCall: (method) => {
      if (method === 'session.resume')
        return { result: { session_id: 'live-3' } };
      if (method === 'slash.exec') return { result: { output: 'tokens: 12k' } };
      return { result: {} };
    },
  });
  const directive = await client.executeSlashCommand('20260807_s', '/usage');
  assert.deepEqual(directive, { kind: 'output', output: 'tokens: 12k' });
  assert.deepEqual(calls[1], {
    method: 'slash.exec',
    params: { command: '/usage', session_id: 'live-3' },
  });
});

test('a slash.exec refusal falls back to one command.dispatch', async () => {
  const { calls, client } = createRpcFake({
    onCall: (method) => {
      if (method === 'session.resume')
        return { result: { session_id: 'live-3' } };
      if (method === 'slash.exec') {
        return { error: { code: 4018, message: 'use command.dispatch' } };
      }
      if (method === 'command.dispatch') {
        return {
          result: { display: '/work go', message: 'SCAFFOLD', type: 'skill' },
        };
      }
      return { result: {} };
    },
  });
  const directive = await client.executeSlashCommand('20260807_s', '/work go');
  assert.deepEqual(directive, {
    display: '/work go',
    kind: 'send',
    message: 'SCAFFOLD',
  });
  const dispatch = calls.find((call) => call.method === 'command.dispatch');
  assert.deepEqual(dispatch?.params, {
    arg: 'go',
    name: 'work',
    session_id: 'live-3',
  });
});

test('a quick-command alias re-dispatches exactly once', async () => {
  const slashCommands: string[] = [];
  const { client } = createRpcFake({
    onCall: (method, params) => {
      if (method === 'session.resume')
        return { result: { session_id: 'live-3' } };
      if (method === 'slash.exec') {
        slashCommands.push(String(params.command));
        return slashCommands.length === 1
          ? { result: { target: '/usage', type: 'alias' } }
          : { result: { output: 'usage output' } };
      }
      return { result: {} };
    },
  });
  const directive = await client.executeSlashCommand('20260807_s', '/u');
  assert.deepEqual(directive, { kind: 'output', output: 'usage output' });
  assert.deepEqual(slashCommands, ['/u', '/usage']);
});

test('compressSession maps the dedicated RPC and its aborted answer', async () => {
  const { calls, client } = createRpcFake({
    onCall: (method) => {
      if (method === 'session.resume')
        return { result: { session_id: 'live-3' } };
      if (method === 'session.compress') {
        return { result: { status: 'aborted', summary: { aborted: true } } };
      }
      return { result: {} };
    },
  });
  const result = await client.compressSession('20260807_s');
  assert.deepEqual(result, { aborted: true });
  assert.equal(
    calls.find((call) => call.method === 'session.compress')?.params.session_id,
    'live-3',
  );
});

test('the catalog read normalizes over one socket call', async () => {
  const { client } = createRpcFake({
    onCall: (method) => {
      if (method === 'commands.catalog') {
        return {
          result: {
            canon: { '/usage': '/usage' },
            pairs: [['/usage', 'Show usage']],
            skills: {},
          },
        };
      }
      return { result: {} };
    },
  });
  const catalog = await client.getCommandCatalog();
  assert.deepEqual(catalog.entries, [
    { command: '/usage', description: 'Show usage', kind: 'command', usage: 0 },
  ]);
});
