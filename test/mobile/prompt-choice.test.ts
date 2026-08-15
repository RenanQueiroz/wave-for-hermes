import assert from 'node:assert/strict';
import test from 'node:test';

import { promptChoicePresentation } from '../../src/features/chat/prompt-choice.ts';

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
