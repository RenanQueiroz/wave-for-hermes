import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SpeechTextFilter,
  StreamedReplyFeeder,
} from '../../src/features/voice/speech-text.ts';

/** Feed a text in the given chunking and return everything emitted. */
function filterChunks(chunks: string[]): string {
  const filter = new SpeechTextFilter();
  let output = '';
  for (const chunk of chunks) output += filter.feed(chunk);
  return output + filter.flush();
}

test('plain narration passes through unchanged', () => {
  assert.equal(
    filterChunks(['The build finished. ', 'Two tests were re-run.']),
    'The build finished. Two tests were re-run.\n',
  );
});

test('inline markers are stripped even when split across deltas', () => {
  assert.equal(
    filterChunks(['This is **impo', 'rtant** and `npm test` passed.']),
    'This is important and npm test passed.\n',
  );
  assert.equal(
    filterChunks(['Styled *a*, _b_, and ~~c~~.']),
    'Styled a, b, and c.\n',
  );
});

test('snake_case identifiers keep their underscores', () => {
  assert.equal(
    filterChunks(['The user', '_id column is set.']),
    'The user_id column is set.\n',
  );
});

test('fenced code blocks are never spoken, including their fence lines', () => {
  assert.equal(
    filterChunks(['Here:\n```python\nprint("x")\n```\nDone.']),
    'Here:\nDone.\n',
  );
});

test('a fence split across small deltas still swallows the code', () => {
  assert.equal(
    filterChunks(['``', '`js\nconst x', ' = 1\n`', '``\nAfter.']),
    'After.\n',
  );
});

test('an unclosed fence at the end of the reply stays silent', () => {
  assert.equal(filterChunks(['Look:\n```\nsecret code']), 'Look:\n');
});

test('links speak their label and drop the target', () => {
  assert.equal(
    filterChunks(['See [the docs](https://example.com/a?b=c) for more.']),
    'See the docs for more.\n',
  );
  assert.equal(
    filterChunks(['Also [ref style][anchor] works.']),
    'Also ref style works.\n',
  );
});

test('images are dropped entirely', () => {
  assert.equal(
    filterChunks(['Before ![a chart](https://example.com/c.png) after.']),
    'Before  after.\n',
  );
});

test('headings, quotes, and list markers are dropped, text kept', () => {
  assert.equal(
    filterChunks(['# Title\n> quoted words\n- item one\n2. item two\n']),
    'Title\nquoted words\nitem one\nitem two\n\n',
  );
});

test('horizontal rules and table separators are not spoken', () => {
  assert.equal(filterChunks(['above\n---\nbelow']), 'above\n\nbelow\n');
  assert.equal(
    filterChunks(['| a | b |\n|---|---|\n| c | d |\n']).replace(/[ \n]/g, ''),
    'abcd',
  );
});

test('HTML tags and autolinks are dropped while comparisons survive', () => {
  assert.equal(
    filterChunks(['Use <b>bold</b> when 3 < 5 and <https://x.test> is gone.']),
    'Use bold when 3 < 5 and  is gone.\n',
  );
});

test('hyphens and dashes inside ordinary prose survive', () => {
  assert.equal(
    filterChunks(['A well-known case — re-run on 2026-08-07.']),
    'A well-known case — re-run on 2026-08-07.\n',
  );
});

test('flush resolves a held construct without speaking syntax', () => {
  assert.equal(filterChunks(['Take the [link']), 'Take the link\n');
  assert.equal(filterChunks(['almost ~']), 'almost ~\n');
});

test('feeder speaks streamed deltas exactly once', () => {
  const spoken: string[] = [];
  const feeder = new StreamedReplyFeeder((text) => spoken.push(text));
  feeder.appendDelta('The answer ');
  feeder.appendDelta('is 42.');
  feeder.noteCompleted('The answer is 42.', false);
  feeder.finishReply();
  assert.equal(spoken.join(''), 'The answer is 42.\n');
});

test('feeder speaks only the unseen tail of a longer completion', () => {
  const spoken: string[] = [];
  const feeder = new StreamedReplyFeeder((text) => spoken.push(text));
  feeder.appendDelta('First half.');
  feeder.noteCompleted('First half. Second half.', false);
  feeder.finishReply();
  assert.equal(spoken.join(''), 'First half. Second half.\n');
});

test('feeder never re-speaks when the completion diverges from the stream', () => {
  const spoken: string[] = [];
  const feeder = new StreamedReplyFeeder((text) => spoken.push(text));
  feeder.appendDelta('Draft wording here.');
  feeder.noteCompleted('Final wording differs.', false);
  feeder.finishReply();
  assert.equal(spoken.join(''), 'Draft wording here.\n');
});

test('feeder ignores tails of interrupted completions', () => {
  const spoken: string[] = [];
  const feeder = new StreamedReplyFeeder((text) => spoken.push(text));
  feeder.appendDelta('Partial…');
  feeder.noteCompleted('Partial… never finished', true);
  feeder.finishReply();
  assert.equal(spoken.join(''), 'Partial…\n');
});

test('sealed interim segments add a break, not a repeat', () => {
  const spoken: string[] = [];
  const feeder = new StreamedReplyFeeder((text) => spoken.push(text));
  feeder.appendDelta('Checking the logs now.');
  feeder.noteInterim('Checking the logs now.');
  feeder.appendDelta('All clear.');
  feeder.noteCompleted('All clear.', false);
  feeder.finishReply();
  assert.equal(spoken.join(''), 'Checking the logs now.\n\nAll clear.\n');
});

test('an interim segment that never streamed as deltas is spoken whole', () => {
  const spoken: string[] = [];
  const feeder = new StreamedReplyFeeder((text) => spoken.push(text));
  feeder.noteInterim('Sealed narration only.');
  feeder.finishReply();
  assert.equal(spoken.join(''), 'Sealed narration only.\n\n\n');
});

test('nothing feeds after the reply is finished', () => {
  const spoken: string[] = [];
  const feeder = new StreamedReplyFeeder((text) => spoken.push(text));
  feeder.appendDelta('Done.');
  feeder.finishReply();
  feeder.appendDelta('Straggler.');
  feeder.noteCompleted('Done. Straggler.', false);
  assert.equal(spoken.join(''), 'Done.\n');
});
