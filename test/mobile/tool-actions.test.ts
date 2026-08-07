import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deriveToolAction,
  toolActionLabel,
} from '../../src/features/chat/tool-actions.ts';

function input(text: string, truncated = false) {
  return { text, truncated };
}

test('maps known tools to verb plus bounded argument', () => {
  assert.deepEqual(
    deriveToolAction({
      id: 't1',
      input: input(JSON.stringify({ path: 'src/app/index.tsx' })),
      title: 'read_file',
    }),
    { file: 'src/app/index.tsx', verb: 'Read' },
  );
  assert.deepEqual(
    deriveToolAction({
      id: 't2',
      input: input(JSON.stringify({ command: 'npm test' })),
      title: 'exec',
    }),
    { detail: 'npm test', verb: 'Ran' },
  );
  assert.deepEqual(
    deriveToolAction({
      id: 't3',
      input: input(JSON.stringify({ query: 'hermes gateway' })),
      title: 'web_search',
    }),
    { detail: 'for hermes gateway', verb: 'Searched the web' },
  );
});

test('unknown tools fall back to a generic bounded action', () => {
  assert.deepEqual(
    deriveToolAction({ id: 't4', title: 'quantum_flux_capacitor' }),
    { detail: 'Quantum flux capacitor', verb: 'Called' },
  );
});

test('malformed, truncated, or non-object input degrades to the verb', () => {
  assert.deepEqual(
    deriveToolAction({ id: 't5', input: input('{"path": "a'), title: 'read' }),
    { verb: 'Read' },
  );
  assert.deepEqual(
    deriveToolAction({
      id: 't6',
      input: input(JSON.stringify({ path: 'src/app.tsx' }), true),
      title: 'read',
    }),
    { verb: 'Read' },
  );
  assert.deepEqual(
    deriveToolAction({ id: 't7', input: input('[1,2,3]'), title: 'read' }),
    { verb: 'Read' },
  );
});

test('derived lines are single-line, control-free, and bounded', () => {
  const action = deriveToolAction({
    id: 't8',
    input: input(JSON.stringify({ command: `rm -rf /\n${'x'.repeat(500)}` })),
    title: 'bash',
  });
  assert.equal(action.verb, 'Ran');
  assert.ok(action.detail);
  assert.ok(!action.detail.includes('\n'));
  assert.ok(!/[\u0000-\u001f]/.test(action.detail)); // eslint-disable-line no-control-regex
  assert.ok(action.detail.length <= 96);
  assert.ok(action.detail.endsWith('…'));
});

test('handoffs are detected by id suffix, never by title', () => {
  assert.deepEqual(
    deriveToolAction({ id: 'h1-handoff', title: 'Hermes · check the logs' }),
    { detail: 'check the logs', verb: 'Asked Hermes' },
  );
  assert.deepEqual(
    deriveToolAction({ id: 'h2-handoff', title: 'Hermes task' }),
    {
      verb: 'Asked Hermes',
    },
  );
  // A tool trying to impersonate the handoff label stays an ordinary call.
  assert.equal(
    deriveToolAction({ id: 't9', title: 'Hermes · fake' }).verb,
    'Called',
  );
});

test('labels compose verb and remainder as plain text', () => {
  assert.equal(
    toolActionLabel({ file: 'a/b.ts', verb: 'Read' }),
    'Read a/b.ts',
  );
  assert.equal(toolActionLabel({ verb: 'Ran' }), 'Ran');
  assert.equal(
    toolActionLabel({ detail: 'npm test', verb: 'Ran' }),
    'Ran npm test',
  );
});
