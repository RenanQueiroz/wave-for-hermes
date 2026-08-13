import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatToolDetailText,
  toolDetailSections,
} from '../../src/features/chat/tool-detail-sheet.shared.ts';

function detail(text: string, truncated = false) {
  return { text, truncated };
}

test('pretty-prints complete JSON objects and arrays', () => {
  assert.equal(
    formatToolDetailText(detail('{"path":"a.ts","limit":2}')),
    '{\n  "path": "a.ts",\n  "limit": 2\n}',
  );
  assert.equal(formatToolDetailText(detail('[1,2]')), '[\n  1,\n  2\n]');
});

test('leaves non-JSON and truncated payloads exactly as they crossed', () => {
  assert.equal(
    formatToolDetailText(detail('<result kind="xml"/>')),
    '<result kind="xml"/>',
  );
  assert.equal(formatToolDetailText(detail('plain text')), 'plain text');
  // Truncated JSON no longer parses; re-indenting must not be attempted.
  const truncated = '{"path":"a.ts","lim';
  assert.equal(formatToolDetailText(detail(truncated, true)), truncated);
  const malformed = '{"path": nope}';
  assert.equal(formatToolDetailText(detail(malformed)), malformed);
});

test('builds sections only for present, non-empty details', () => {
  assert.deepEqual(
    toolDetailSections({
      outputIsPreview: false,
      status: 'complete',
      title: 'Read file',
    }),
    [],
  );
  assert.deepEqual(
    toolDetailSections({
      input: detail('{"a":1}'),
      output: detail('   '),
      outputIsPreview: false,
      status: 'complete',
      title: 'Read file',
    }).map((section) => section.key),
    ['input'],
  );
});

test('labels preview and in-flight output as partial', () => {
  const base = {
    input: detail('{"a":1}'),
    output: detail('chunk', true),
    title: 'Run command',
  };
  assert.deepEqual(
    toolDetailSections({
      ...base,
      outputIsPreview: true,
      status: 'complete',
    }).map((section) => [section.label, section.truncated]),
    [
      ['Input', false],
      ['Output so far', true],
    ],
  );
  assert.equal(
    toolDetailSections({ ...base, outputIsPreview: false, status: 'running' })
      .map((section) => section.label)
      .at(-1),
    'Output so far',
  );
  assert.equal(
    toolDetailSections({ ...base, outputIsPreview: false, status: 'complete' })
      .map((section) => section.label)
      .at(-1),
    'Output',
  );
});
