import assert from 'node:assert/strict';
import test from 'node:test';

import { HermesClientError } from './hermes-errors.ts';
import { HermesSseParser } from './hermes-sse.ts';

test('parses server-side fragmented UTF-8, multiple events, comments, and CRLF frames', () => {
  const parser = new HermesSseParser();
  const bytes = new TextEncoder().encode(
    ': keepalive\r\n\r\nevent: assistant.delta\r\ndata: {"delta":"olá"}\r\n\r\n' +
      'event: done\ndata: {}\n\n',
  );
  const accentIndex = bytes.indexOf(0xc3);
  const frames = [
    ...parser.push(bytes.slice(0, accentIndex + 1)),
    ...parser.push(bytes.slice(accentIndex + 1)),
    ...parser.finish(),
  ];

  assert.deepEqual(frames, [
    {
      data: '{"delta":"olá"}',
      event: 'assistant.delta',
    },
    {
      data: '{}',
      event: 'done',
    },
  ]);
});

test('joins multiline data fields and ignores unknown SSE fields', () => {
  const parser = new HermesSseParser();
  const frames = parser.push(
    'event: example\nretry: 1000\ndata: first\ndata: second\nignored: value\n\n',
  );

  assert.deepEqual(frames, [{ data: 'first\nsecond', event: 'example' }]);
  assert.deepEqual(parser.finish(), []);
});

test('rejects a stream that closes during an event', () => {
  const parser = new HermesSseParser();
  parser.push('event: assistant.delta\ndata: {"delta":"partial"}');

  assert.throws(
    () => parser.finish(),
    (error: unknown) =>
      error instanceof HermesClientError &&
      error.kind === 'protocol' &&
      error.code === 'truncated_sse_stream',
  );
});
