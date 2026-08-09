/**
 * Progress-note sanitation: bounded inert plain text, never Markdown
 * control syntax or code, explicit truncation.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  sanitizeRealtimeProgressNote,
  WAVE_MAX_REALTIME_PROGRESS_NOTE_CHARS,
} from '../../src/services/realtime/realtime-progress-note.ts';

test('strips markdown control syntax and keeps the narration', () => {
  assert.equal(
    sanitizeRealtimeProgressNote(
      '# Status\n\n> quoting\n- **Checked** the `garage` sensor\n1. next _step_',
    ),
    'Status quoting Checked the garage sensor next step',
  );
  assert.equal(
    sanitizeRealtimeProgressNote(
      'See [the dashboard](https://attacker.invalid/x) and ![shot](https://a/b.png).',
    ),
    'See the dashboard and .',
  );
});

test('fenced code vanishes whole, including an unterminated fence', () => {
  assert.equal(
    sanitizeRealtimeProgressNote('Done.\n```js\nrm -rf /\n```\nMoving on.'),
    'Done. Moving on.',
  );
  assert.equal(
    sanitizeRealtimeProgressNote('Starting\n```bash\ncurl evil'),
    'Starting',
  );
});

test('collapses to one bounded line with an explicit truncation marker', () => {
  assert.equal(sanitizeRealtimeProgressNote('a\n\n\n  b\t\tc'), 'a b c');
  const long = sanitizeRealtimeProgressNote('x'.repeat(5_000));
  assert.equal(long.length, WAVE_MAX_REALTIME_PROGRESS_NOTE_CHARS);
  assert.match(long, /\[…\]$/);
  assert.equal(sanitizeRealtimeProgressNote('```\nonly code\n```'), '');
  assert.equal(sanitizeRealtimeProgressNote('   \n \t '), '');
});
