import assert from 'node:assert/strict';
import test from 'node:test';

import type { WaveSessionSummary } from '@wave/contracts';

import {
  DRAWER_COPY,
  drawerErrorMessage,
  drawerRowAccessibilityLabel,
  drawerRowGlyph,
  emptySessionFilterMessage,
  sessionTitle,
} from '../../src/features/navigation/drawer/row-model.ts';
import { WaveBackendError } from '../../src/services/wave/wave-backend-error.ts';

function session(
  id: string,
  input: Partial<WaveSessionSummary> = {},
): WaveSessionSummary {
  return {
    id,
    liveStatus: 'idle',
    pinned: false,
    source: 'chat',
    ...input,
  };
}

test('live status wins the glyph column and names the status', () => {
  for (const [status, label] of [
    ['starting', 'Starting'],
    ['working', 'Working'],
    ['waiting', 'Waiting for input'],
  ] as const) {
    const glyph = drawerRowGlyph(
      session('s1', { liveStatus: status, source: 'automation' }),
      'activity',
    );
    assert.deepEqual(glyph, { kind: 'live', label, status });
  }
});

test('idle rows show source symbols only in the activity filter', () => {
  assert.deepEqual(drawerRowGlyph(session('s1'), 'chats'), { kind: 'none' });
  assert.deepEqual(
    drawerRowGlyph(session('s2', { source: 'automation' }), 'activity'),
    { kind: 'source', label: 'Automation', source: 'automation' },
  );
  assert.deepEqual(
    drawerRowGlyph(session('s3', { source: 'external' }), 'activity'),
    { kind: 'source', label: 'External activity', source: 'external' },
  );
  // The future-compatible fallback source stays visible, never hidden.
  assert.deepEqual(
    drawerRowGlyph(session('s4', { source: 'other' }), 'activity'),
    { kind: 'source', label: 'Other activity', source: 'other' },
  );
});

test('the accessible row name carries the glyph status', () => {
  const active = session('s1', { liveStatus: 'working', title: 'Homelab' });
  assert.equal(
    drawerRowAccessibilityLabel(active, drawerRowGlyph(active, 'chats')),
    'Open conversation Homelab, Working',
  );
  const idle = session('s2');
  assert.equal(
    drawerRowAccessibilityLabel(idle, drawerRowGlyph(idle, 'chats')),
    'Open conversation Untitled chat',
  );
});

test('titles, empty copy, and error copy stay bounded and honest', () => {
  assert.equal(sessionTitle(session('s1')), 'Untitled chat');
  assert.equal(sessionTitle(session('s1', { title: 'Trip' })), 'Trip');
  assert.equal(emptySessionFilterMessage('chats'), 'No previous chats.');
  assert.equal(
    emptySessionFilterMessage('activity'),
    'No conversations from other sources.',
  );
  assert.equal(
    drawerErrorMessage(
      new WaveBackendError('Session has an active turn.', {
        kind: 'conflict',
      }),
    ),
    'Session has an active turn.',
  );
  assert.equal(
    drawerErrorMessage(new Error('socket hangup')),
    'Wave could not update the conversation.',
  );
  assert.match(
    DRAWER_COPY.deleteMessage(session('s1', { title: 'Trip' })),
    /“Trip”/,
  );
  assert.match(DRAWER_COPY.deleteMessage(undefined), /permanently deleted/);
});
