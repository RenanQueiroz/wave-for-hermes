import assert from 'node:assert/strict';
import test from 'node:test';

import {
  appendDictationTranscript,
  inferComposerSelectionAfterTextChange,
  modelTriggerLabel,
  projectComposerDraft,
  replaceSlashSuggestion,
  resolveComposerAction,
  restoredCorrectionDraft,
  type ResolveComposerActionInput,
} from '../../src/features/chat/composer/state.ts';

const BASE: ResolveComposerActionInput = {
  activePrompt: false,
  attachmentCount: 0,
  blocked: false,
  busy: false,
  cancelling: false,
  correcting: false,
  hasRecognizedCommand: false,
  hasText: false,
  slashRunning: false,
};

test('composer action precedence stays identical across native views', () => {
  const cases: Array<{
    expected: ReturnType<typeof resolveComposerAction>['kind'];
    input: Partial<ResolveComposerActionInput>;
  }> = [
    { expected: 'live', input: {} },
    { expected: 'send', input: { hasText: true } },
    { expected: 'stop', input: { busy: true } },
    { expected: 'correct', input: { busy: true, hasText: true } },
    {
      expected: 'stop',
      input: { activePrompt: true, busy: true, hasText: true },
    },
    {
      expected: 'stop',
      input: { attachmentCount: 1, busy: true, hasText: true },
    },
    {
      expected: 'stop',
      input: { busy: true, cancelling: true, hasText: true },
    },
    {
      expected: 'correction-loading',
      input: { busy: true, correcting: true, hasText: true },
    },
    {
      expected: 'run',
      input: {
        busy: true,
        correcting: true,
        hasRecognizedCommand: true,
        hasText: true,
      },
    },
  ];

  for (const entry of cases) {
    assert.equal(
      resolveComposerAction({ ...BASE, ...entry.input }).kind,
      entry.expected,
    );
  }
});

test('composer actions carry the correct disabled and loading states', () => {
  assert.deepEqual(resolveComposerAction({ ...BASE, blocked: true }), {
    disabled: true,
    kind: 'live',
    label: 'Start live voice',
    loading: false,
  });
  assert.equal(
    resolveComposerAction({ ...BASE, blocked: true, hasText: true }).disabled,
    true,
  );
  assert.equal(
    resolveComposerAction({
      ...BASE,
      blocked: true,
      busy: true,
      hasText: true,
    }).disabled,
    true,
  );
  assert.deepEqual(
    resolveComposerAction({
      ...BASE,
      commandName: '/model',
      hasRecognizedCommand: true,
      hasText: true,
      slashRunning: true,
    }),
    {
      disabled: true,
      kind: 'run',
      label: 'Run the /model command',
      loading: true,
    },
  );
  assert.equal(
    resolveComposerAction({ ...BASE, busy: true, cancelling: true }).disabled,
    true,
  );
});

test('slash suggestion replacement clamps the caret and preserves surrounding text', () => {
  assert.deepEqual(replaceSlashSuggestion('before /mo after', 10, '/model'), {
    selection: { end: 14, start: 14 },
    text: 'before /model  after',
  });
  assert.deepEqual(replaceSlashSuggestion('/ne', 99, '/new'), {
    selection: { end: 5, start: 5 },
    text: '/new ',
  });
  assert.equal(replaceSlashSuggestion('ordinary text', 8, '/model'), undefined);
});

test('dictation and correction restoration never discard an existing draft', () => {
  assert.deepEqual(appendDictationTranscript('half typed ', 'and spoken'), {
    selection: { end: 21, start: 21 },
    text: 'half typed and spoken',
  });
  assert.equal(
    restoredCorrectionDraft('', 'failed correction'),
    'failed correction',
  );
  assert.equal(
    restoredCorrectionDraft('new draft', 'failed correction'),
    'new draft',
  );
});

test('model trigger mirrors the compact Desktop model and effort label', () => {
  assert.equal(modelTriggerLabel(undefined, undefined), 'Model');
  assert.equal(
    modelTriggerLabel('openai/gpt-5.6-sol', 'xhigh'),
    'GPT-5.6-sol · XHigh',
  );
  assert.equal(
    modelTriggerLabel('anthropic/claude-sonnet', 'medium'),
    'Sonnet · Medium',
  );
});

test('ordinary native drafts project only semantic empty state to React', () => {
  assert.equal(projectComposerDraft(''), '');
  assert.equal(projectComposerDraft('   '), '');
  assert.equal(projectComposerDraft('hello'), '\uFFFC');
  assert.equal(projectComposerDraft('hello again'), '\uFFFC');
  assert.equal(projectComposerDraft('/mo'), '/mo');
  assert.equal(projectComposerDraft('use /skill'), 'use /skill');
});

test('native text edits infer a caret when iOS omits the selection callback', () => {
  assert.deepEqual(
    inferComposerSelectionAfterTextChange('', '/mo', { end: 0, start: 0 }),
    { end: 3, start: 3 },
  );
  assert.deepEqual(
    inferComposerSelectionAfterTextChange('say /mo now', 'say /model now', {
      end: 7,
      start: 7,
    }),
    { end: 10, start: 10 },
  );
  assert.deepEqual(
    inferComposerSelectionAfterTextChange('teh ', 'the ', {
      end: 4,
      start: 4,
    }),
    { end: 4, start: 4 },
  );
  assert.deepEqual(
    inferComposerSelectionAfterTextChange('abc', 'ab', {
      end: 3,
      start: 3,
    }),
    { end: 2, start: 2 },
  );
});
