import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clarifyAnswerValue,
  promptChoicePresentation,
  stageLockedClarifyAnswers,
} from '../../src/features/chat/prompt-choice.ts';

test('presents Hermes recommended choices without changing the response value', () => {
  const raw = 'Use the existing conversation (Recommended)';
  assert.deepEqual(promptChoicePresentation(raw), {
    label: 'Use the existing conversation',
    recommended: true,
  });
  // Presentation is separate from dispatch: callers retain `raw` as the
  // exact gateway choice value.
  assert.equal(raw, 'Use the existing conversation (Recommended)');
  assert.deepEqual(promptChoicePresentation('Recommended reading'), {
    label: 'Recommended reading',
    recommended: false,
  });
  assert.deepEqual(promptChoicePresentation('Alpha (RECOMMENDED)'), {
    label: 'Alpha',
    recommended: true,
  });
});

test('clarify answers encode one choice verbatim, several as a JSON list, else the draft', () => {
  assert.equal(
    clarifyAnswerValue({
      choices: ['Ship it (Recommended)'],
      draft: 'ignored',
      multiSelect: false,
    }),
    'Ship it (Recommended)',
  );
  assert.equal(
    clarifyAnswerValue({ choices: ['a', 'b'], draft: '', multiSelect: true }),
    '["a","b"]',
  );
  assert.equal(
    clarifyAnswerValue({ choices: [], draft: '  typed  ', multiSelect: true }),
    'typed',
  );
  assert.equal(
    clarifyAnswerValue({ choices: [], draft: '   ', multiSelect: false }),
    undefined,
  );
});

test('replayed batch answers re-select a matching choice or seed the draft', () => {
  assert.deepEqual(
    stageLockedClarifyAnswers([
      {
        answer: 'beta',
        choices: ['alpha', 'beta'],
        multiSelect: false,
        question: 'Which?',
        questionId: 'q0',
      },
      {
        answer: 'free text',
        choices: ['alpha'],
        multiSelect: false,
        question: 'Other?',
        questionId: 'q1',
      },
      {
        choices: [],
        multiSelect: false,
        question: 'Unanswered',
        questionId: 'q2',
      },
    ]),
    {
      q0: { choices: ['beta'], draft: '' },
      q1: { choices: [], draft: 'free text' },
    },
  );
});
