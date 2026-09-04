/**
 * The active turn's task list.
 *
 * Hermes v0.21 emits a full `todo.updated` snapshot whenever its todo tool
 * runs, regardless of the session's tool-progress display setting, because
 * task state is application data rather than tool chrome. Wave shows it while
 * a turn is running and drops it when the turn settles — a finished turn's
 * plan is not a durable record, and the transcript itself is.
 *
 * Everything here is gateway-authored untrusted text: rendered as bounded
 * plain text through PanelUI's own primitives, never as Markdown, and never
 * driving behaviour. The content bound and item count are enforced upstream
 * in the contract; this only decides how they look.
 */
import { Task, type TaskStatus } from 'panelui-native';
import { memo } from 'react';

import type { WaveTodo, WaveTodoStatus } from '@wave/contracts';

/**
 * Per-item state. `Task.Item` has no status of its own, so each row carries a
 * leading glyph instead — plain text, like the rest of the row.
 */
const ITEM_GLYPH: Record<WaveTodoStatus, string> = {
  cancelled: '✕',
  completed: '✓',
  in_progress: '▸',
  pending: '·',
};

function summarize(todos: readonly WaveTodo[]): string {
  const done = todos.filter((todo) => todo.status === 'completed').length;
  const active = todos.find((todo) => todo.status === 'in_progress');
  // Name what is happening now when there is one, because that is the line a
  // reader watching a long turn actually wants; fall back to the count.
  return active ? active.content : `${done} of ${todos.length} done`;
}

/** The list's own state: running while anything is still in flight. */
function listStatus(todos: readonly WaveTodo[]): TaskStatus {
  if (todos.some((todo) => todo.status === 'in_progress')) return 'running';
  if (todos.every((todo) => todo.status === 'completed')) return 'complete';
  return 'pending';
}

export const TurnTasks = memo(function TurnTasks({
  todos,
}: {
  todos: readonly WaveTodo[];
}) {
  if (todos.length === 0) return null;
  return (
    <Task
      // Folded by default: the summary line already says what is happening,
      // and an auto-opening panel would push the transcript on every update.
      defaultOpen={false}
      status={listStatus(todos)}
      testID="turn-tasks">
      <Task.Trigger title={summarize(todos)} />
      <Task.Content>
        {todos.map((todo) => (
          <Task.Item
            key={
              todo.id
            }>{`${ITEM_GLYPH[todo.status]}  ${todo.content}`}</Task.Item>
        ))}
      </Task.Content>
    </Task>
  );
});
