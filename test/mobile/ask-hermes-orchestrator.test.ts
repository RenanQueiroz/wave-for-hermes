/**
 * Steer-by-default ask_hermes rules plus the active-execution correction
 * boundary: global cap, unknown tools, strict arguments, trusted binding,
 * coalescing, the turn-owner model with steer delivery and its races, and
 * correction gating.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  WaveAskHermesToolResult,
  WaveCorrectHermesToolResult,
  WaveRealtimeToolResult,
} from '@wave/contracts';

import {
  AskHermesOrchestrator,
  type HermesExecutionLifecycle,
  MAX_OUTSTANDING_CORRECTIONS,
  MAX_OUTSTANDING_TOOL_CALLS,
  MAX_PROGRESS_NOTES_PER_EXECUTION,
  MAX_TOOL_CALLS_PER_REALTIME_CALL,
} from '../../src/features/realtime/ask-hermes-orchestrator.ts';

function harness(options?: {
  authorized?: () => boolean;
  executeCorrection?: (
    instruction: string,
    signal: AbortSignal,
  ) => Promise<WaveCorrectHermesToolResult>;
  execute?: (
    instruction: string,
    signal: AbortSignal,
    lifecycle: HermesExecutionLifecycle,
  ) => Promise<WaveAskHermesToolResult>;
}) {
  const activeChanges: boolean[] = [];
  const delivered: { callId: string; result: WaveRealtimeToolResult }[] = [];
  const orchestrator = new AskHermesOrchestrator({
    deliver: (callId, result) => delivered.push({ callId, result }),
    execute:
      options?.execute ??
      (async (instruction) => ({
        answer: `did: ${instruction}`,
        ok: true,
        truncated: false,
      })),
    executeCorrection: options?.executeCorrection,
    isAuthorized: options?.authorized ?? (() => true),
    onActiveExecutionChange: (active) => activeChanges.push(active),
  });
  return { activeChanges, delivered, orchestrator };
}

const args = (instruction: string) => JSON.stringify({ instruction });

function errorCode(result: WaveRealtimeToolResult) {
  return !result.ok && 'error' in result ? result.error.code : undefined;
}

function askStatus(result: WaveRealtimeToolResult) {
  return result.ok && 'status' in result ? result.status : undefined;
}

function correctionStatus(result: WaveRealtimeToolResult) {
  return 'status' in result ? result.status : undefined;
}

async function settled() {
  // A few microtask hops let the serialized redirect chain drain.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

test('R1: refuses further tool calls past the per-call cap', async () => {
  const { delivered, orchestrator } = harness({
    executeCorrection: async () => ({ ok: true, status: 'redirected' }),
  });
  for (let i = 0; i < MAX_TOOL_CALLS_PER_REALTIME_CALL; i += 1) {
    orchestrator.handleToolCall({
      arguments: args(`task ${i}`),
      callId: `call-${i}`,
      name: 'ask_hermes',
    });
  }
  orchestrator.handleToolCall({
    arguments: args('one too many'),
    callId: 'call-over',
    name: 'ask_hermes',
  });
  await settled();
  const over = delivered.find((entry) => entry.callId === 'call-over');
  assert.equal(errorCode(over!.result), 'busy');
});

test('R2: refuses tools outside the Wave-owned Realtime surface', async () => {
  const { delivered, orchestrator } = harness();
  orchestrator.handleToolCall({
    arguments: args('irrelevant'),
    callId: 'call-1',
    name: 'delete_everything',
  });
  await settled();
  assert.equal(errorCode(delivered[0]!.result), 'unknown_tool');
});

test('R3: strict schema refuses malformed JSON, extra fields, and session ids', async () => {
  const { delivered, orchestrator } = harness();
  orchestrator.handleToolCall({
    arguments: 'not json',
    callId: 'bad-json',
    name: 'ask_hermes',
  });
  orchestrator.handleToolCall({
    // A model-controlled session id is an extra field; the strict schema
    // rejects it by construction.
    arguments: JSON.stringify({ instruction: 'hi', sessionId: 'attacker' }),
    callId: 'session-id',
    name: 'ask_hermes',
  });
  orchestrator.handleToolCall({
    arguments: JSON.stringify({ instruction: '' }),
    callId: 'empty',
    name: 'ask_hermes',
  });
  await settled();
  assert.equal(delivered.length, 3);
  for (const entry of delivered) {
    assert.equal(errorCode(entry.result), 'invalid_arguments');
  }
});

test('R4: refuses when the trusted call binding is gone', async () => {
  const { delivered, orchestrator } = harness({ authorized: () => false });
  orchestrator.handleToolCall({
    arguments: args('do something'),
    callId: 'call-1',
    name: 'ask_hermes',
  });
  await settled();
  assert.equal(errorCode(delivered[0]!.result), 'unauthorized');
});

test('R5: identical instructions in one user turn share one execution', async () => {
  let executions = 0;
  const { delivered, orchestrator } = harness({
    execute: async (instruction) => {
      executions += 1;
      return { answer: `did: ${instruction}`, ok: true, truncated: false };
    },
  });
  orchestrator.handleToolCall({
    arguments: args('check the weather'),
    callId: 'dup-1',
    name: 'ask_hermes',
    userItemId: 'item-1',
  });
  orchestrator.handleToolCall({
    arguments: args('check the weather'),
    callId: 'dup-2',
    name: 'ask_hermes',
    userItemId: 'item-1',
  });
  await settled();
  // A later user turn repeating the request deliberately re-executes.
  orchestrator.handleToolCall({
    arguments: args('check the weather'),
    callId: 'later-turn',
    name: 'ask_hermes',
    userItemId: 'item-2',
  });
  await settled();
  assert.equal(executions, 2);
  assert.equal(delivered.length, 3);
  const first = delivered.find((entry) => entry.callId === 'dup-1')!.result;
  const second = delivered.find((entry) => entry.callId === 'dup-2')!.result;
  assert.deepEqual(first, second);
});

test('S1: a busy ask steers into the running work and the owner keeps the answer', async () => {
  let finishAsk!: () => void;
  const steered: string[] = [];
  const { delivered, orchestrator } = harness({
    execute: (_instruction, _signal, lifecycle) =>
      new Promise((resolve) => {
        lifecycle.activate();
        finishAsk = () =>
          resolve({ answer: 'combined outcome', ok: true, truncated: false });
      }),
    executeCorrection: async (instruction) => {
      steered.push(instruction);
      return { ok: true, status: 'redirected' };
    },
  });
  orchestrator.handleToolCall({
    arguments: args('long job'),
    callId: 'owner',
    name: 'ask_hermes',
  });
  await settled();
  orchestrator.handleToolCall({
    arguments: args('also do this'),
    callId: 'steer',
    name: 'ask_hermes',
  });
  await settled();
  assert.deepEqual(steered, ['also do this']);
  const ack = delivered.find((entry) => entry.callId === 'steer')!.result;
  assert.equal(askStatus(ack), 'steered');
  assert.equal(
    delivered.some((entry) => entry.callId === 'owner'),
    false,
    'the owner call stays pending until the turn completes',
  );
  finishAsk();
  await settled();
  const answer = delivered.find((entry) => entry.callId === 'owner')!.result;
  assert.equal(
    answer.ok && 'answer' in answer ? answer.answer : '',
    'combined outcome',
  );
});

test('S2: a build-window redirect acknowledges as queued', async () => {
  let finishAsk!: () => void;
  const { delivered, orchestrator } = harness({
    execute: (_instruction, _signal, lifecycle) =>
      new Promise((resolve) => {
        lifecycle.activate();
        finishAsk = () =>
          resolve({ answer: 'done', ok: true, truncated: false });
      }),
    executeCorrection: async () => ({ ok: true, status: 'queued' }),
  });
  orchestrator.handleToolCall({
    arguments: args('long job'),
    callId: 'owner',
    name: 'ask_hermes',
  });
  await settled();
  orchestrator.handleToolCall({
    arguments: args('next thing'),
    callId: 'steer',
    name: 'ask_hermes',
  });
  await settled();
  assert.equal(
    askStatus(delivered.find((entry) => entry.callId === 'steer')!.result),
    'queued',
  );
  finishAsk();
  await settled();
});

test('S3: a retried steered instruction reuses the acknowledgement, never a second redirect', async () => {
  let finishAsk!: () => void;
  let redirects = 0;
  const { delivered, orchestrator } = harness({
    execute: (_instruction, _signal, lifecycle) =>
      new Promise((resolve) => {
        lifecycle.activate();
        finishAsk = () =>
          resolve({ answer: 'done', ok: true, truncated: false });
      }),
    executeCorrection: async () => {
      redirects += 1;
      return { ok: true, status: 'redirected' };
    },
  });
  orchestrator.handleToolCall({
    arguments: args('long job'),
    callId: 'owner',
    name: 'ask_hermes',
  });
  await settled();
  orchestrator.handleToolCall({
    arguments: args('extra work'),
    callId: 'steer-1',
    name: 'ask_hermes',
    userItemId: 'item-9',
  });
  await settled();
  orchestrator.handleToolCall({
    arguments: args('extra work'),
    callId: 'steer-2',
    name: 'ask_hermes',
    userItemId: 'item-9',
  });
  await settled();
  assert.equal(redirects, 1);
  const first = delivered.find((entry) => entry.callId === 'steer-1')!.result;
  const second = delivered.find((entry) => entry.callId === 'steer-2')!.result;
  assert.deepEqual(first, second);
  assert.equal(askStatus(first), 'steered');
  finishAsk();
  await settled();
});

test('S4: in-flight steer deliveries are bounded and overflow is retryable busy', async () => {
  let finishAsk!: () => void;
  const releases: (() => void)[] = [];
  const { delivered, orchestrator } = harness({
    execute: (_instruction, _signal, lifecycle) =>
      new Promise((resolve) => {
        lifecycle.activate();
        finishAsk = () =>
          resolve({ answer: 'done', ok: true, truncated: false });
      }),
    executeCorrection: () =>
      new Promise((resolve) => {
        releases.push(() => resolve({ ok: true, status: 'redirected' }));
      }),
  });
  orchestrator.handleToolCall({
    arguments: args('long job'),
    callId: 'owner',
    name: 'ask_hermes',
  });
  await settled();
  for (let i = 0; i < MAX_OUTSTANDING_TOOL_CALLS; i += 1) {
    orchestrator.handleToolCall({
      arguments: args(`steer ${i}`),
      callId: `steer-${i}`,
      name: 'ask_hermes',
    });
  }
  orchestrator.handleToolCall({
    arguments: args('overflow'),
    callId: 'overflow',
    name: 'ask_hermes',
  });
  await settled();
  const overflow = delivered.find((entry) => entry.callId === 'overflow')!;
  assert.equal(errorCode(overflow.result), 'busy');
  assert.equal(
    overflow.result.ok ? undefined : overflow.result.error.retryable,
    true,
  );
  // Steer dispatches are serialized; each release lets the next one land.
  for (let i = 0; i < MAX_OUTSTANDING_TOOL_CALLS; i += 1) {
    await settled();
    releases.shift()?.();
  }
  await settled();
  assert.equal(
    delivered.filter((entry) => askStatus(entry.result) === 'steered').length,
    MAX_OUTSTANDING_TOOL_CALLS,
  );
  finishAsk();
  await settled();
});

test('S5: a steer that loses the completion race becomes the new owner once', async () => {
  const executed: string[] = [];
  let finishFirst!: () => void;
  const { delivered, orchestrator } = harness({
    execute: (instruction, _signal, lifecycle) => {
      executed.push(instruction);
      return new Promise((resolve) => {
        if (instruction === 'first job') {
          lifecycle.activate();
          finishFirst = () =>
            resolve({ answer: 'first done', ok: true, truncated: false });
        } else {
          resolve({
            answer: `ran: ${instruction}`,
            ok: true,
            truncated: false,
          });
        }
      });
    },
    executeCorrection: async () => {
      // The redirect raced turn completion: the gateway maps it to conflict,
      // Wave maps that to nothing_active, and the turn settles in parallel.
      finishFirst();
      await new Promise((resolve) => setTimeout(resolve, 1));
      return {
        message: 'no active turn',
        ok: false,
        retryable: false,
        status: 'nothing_active',
      };
    },
  });
  orchestrator.handleToolCall({
    arguments: args('first job'),
    callId: 'owner',
    name: 'ask_hermes',
  });
  await settled();
  orchestrator.handleToolCall({
    arguments: args('second job'),
    callId: 'late',
    name: 'ask_hermes',
  });
  await settled();
  await settled();
  assert.deepEqual(executed, ['first job', 'second job']);
  const late = delivered.find((entry) => entry.callId === 'late')!.result;
  assert.equal(
    late.ok && 'answer' in late ? late.answer : '',
    'ran: second job',
  );
});

test('S6: steer attempts are bounded when redirects keep missing', async () => {
  let finishAsk!: () => void;
  let redirects = 0;
  const { delivered, orchestrator } = harness({
    execute: (_instruction, _signal, lifecycle) =>
      new Promise((resolve) => {
        lifecycle.activate();
        finishAsk = () =>
          resolve({ answer: 'done', ok: true, truncated: false });
      }),
    // The lane stays live yet every redirect reports nothing_active — a
    // degenerate upstream; the steer must settle instead of spinning.
    executeCorrection: async () => {
      redirects += 1;
      return {
        message: 'no active turn',
        ok: false,
        retryable: false,
        status: 'nothing_active',
      };
    },
  });
  orchestrator.handleToolCall({
    arguments: args('long job'),
    callId: 'owner',
    name: 'ask_hermes',
  });
  await settled();
  orchestrator.handleToolCall({
    arguments: args('doomed steer'),
    callId: 'steer',
    name: 'ask_hermes',
  });
  await settled();
  await settled();
  assert.equal(redirects, 2, 'at most two redirect dispatches per steer');
  const result = delivered.find((entry) => entry.callId === 'steer')!.result;
  assert.equal(errorCode(result), 'busy');
  assert.equal(result.ok ? undefined : result.error.retryable, true);
  finishAsk();
  await settled();
});

test('S7: owner turns never overlap — rapid asks steer instead', async () => {
  let running = 0;
  let finishAsk!: () => void;
  const steered: string[] = [];
  const { orchestrator } = harness({
    execute: (_instruction, _signal, lifecycle) => {
      running += 1;
      assert.equal(running, 1, 'two owner turns overlapped');
      lifecycle.activate();
      return new Promise((resolve) => {
        finishAsk = () => {
          running -= 1;
          resolve({ answer: 'done', ok: true, truncated: false });
        };
      });
    },
    executeCorrection: async (instruction) => {
      steered.push(instruction);
      return { ok: true, status: 'redirected' };
    },
  });
  orchestrator.handleToolCall({
    arguments: args('first'),
    callId: 'a',
    name: 'ask_hermes',
  });
  orchestrator.handleToolCall({
    arguments: args('second'),
    callId: 'b',
    name: 'ask_hermes',
  });
  orchestrator.handleToolCall({
    arguments: args('third'),
    callId: 'c',
    name: 'ask_hermes',
  });
  await settled();
  await settled();
  assert.deepEqual(steered, ['second', 'third']);
  finishAsk();
  await settled();
});

test('P1: owner progress forwards bounded notes; nothing forwards after abort', async () => {
  const notes: string[] = [];
  let capturedLifecycle!: HermesExecutionLifecycle;
  let finishAsk!: () => void;
  const delivered: { callId: string; result: WaveRealtimeToolResult }[] = [];
  const orchestrator = new AskHermesOrchestrator({
    deliver: (callId, result) => delivered.push({ callId, result }),
    execute: (_instruction, _signal, lifecycle) => {
      capturedLifecycle = lifecycle;
      lifecycle.activate();
      return new Promise((resolve) => {
        finishAsk = () =>
          resolve({ answer: 'done', ok: true, truncated: false });
      });
    },
    isAuthorized: () => true,
    onProgress: (text) => notes.push(text),
  });
  orchestrator.handleToolCall({
    arguments: args('long job'),
    callId: 'owner',
    name: 'ask_hermes',
  });
  await settled();
  for (
    let index = 0;
    index < MAX_PROGRESS_NOTES_PER_EXECUTION + 3;
    index += 1
  ) {
    capturedLifecycle.progress?.(`note ${index}`);
  }
  assert.equal(notes.length, MAX_PROGRESS_NOTES_PER_EXECUTION);
  orchestrator.abort();
  capturedLifecycle.progress?.('after abort');
  assert.equal(notes.length, MAX_PROGRESS_NOTES_PER_EXECUTION);
  finishAsk();
  await settled();
});

test('abort cancels in-flight work and stops all delivery', async () => {
  const { delivered, orchestrator } = harness({
    execute: (_instruction, signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')));
      }),
  });
  orchestrator.handleToolCall({
    arguments: args('long job'),
    callId: 'a',
    name: 'ask_hermes',
  });
  orchestrator.abort();
  await settled();
  assert.equal(delivered.length, 0);
});

test('correct_hermes is strict and targets only the live trusted execution', async () => {
  let finishAsk!: () => void;
  const corrected: string[] = [];
  const { activeChanges, delivered, orchestrator } = harness({
    execute: (_instruction, _signal, lifecycle) =>
      new Promise((resolve) => {
        lifecycle.activate();
        finishAsk = () =>
          resolve({ answer: 'done', ok: true, truncated: false });
      }),
    executeCorrection: async (instruction) => {
      corrected.push(instruction);
      return { ok: true, status: 'redirected' };
    },
  });

  orchestrator.handleToolCall({
    arguments: args('work for a while'),
    callId: 'ask-1',
    name: 'ask_hermes',
  });
  await settled();
  assert.deepEqual(activeChanges, [true]);

  for (const [callId, payload] of [
    ['injected-id', { instruction: 'change it', sessionId: 'model-session' }],
    ['injected-mode', { instruction: 'change it', mode: 'replace' }],
    ['oversized', { instruction: 'x'.repeat(8_001) }],
  ] as const) {
    orchestrator.handleToolCall({
      arguments: JSON.stringify(payload),
      callId,
      name: 'correct_hermes',
    });
  }
  orchestrator.handleToolCall({
    arguments: args('Use SQLite instead'),
    callId: 'correct-1',
    name: 'correct_hermes',
  });
  await settled();
  assert.deepEqual(corrected, ['Use SQLite instead']);
  for (const callId of ['injected-id', 'injected-mode', 'oversized']) {
    assert.equal(
      correctionStatus(
        delivered.find((entry) => entry.callId === callId)!.result,
      ),
      'rejected',
    );
  }
  assert.equal(
    correctionStatus(
      delivered.find((entry) => entry.callId === 'correct-1')!.result,
    ),
    'redirected',
  );

  finishAsk();
  await settled();
  assert.deepEqual(activeChanges, [true, false]);
});

test('correct_hermes fails closed before activation and after authorization loss', async () => {
  let authorized = true;
  let finishAsk!: () => void;
  const { delivered, orchestrator } = harness({
    authorized: () => authorized,
    execute: (_instruction, _signal, lifecycle) =>
      new Promise((resolve) => {
        lifecycle.activate();
        finishAsk = () =>
          resolve({ answer: 'done', ok: true, truncated: false });
      }),
    executeCorrection: async () => ({ ok: true, status: 'redirected' }),
  });
  orchestrator.handleToolCall({
    arguments: args('too early'),
    callId: 'before',
    name: 'correct_hermes',
  });
  assert.equal(correctionStatus(delivered[0]!.result), 'nothing_active');

  orchestrator.handleToolCall({
    arguments: args('start work'),
    callId: 'ask',
    name: 'ask_hermes',
  });
  await settled();
  authorized = false;
  orchestrator.handleToolCall({
    arguments: args('stale correction'),
    callId: 'unauthorized',
    name: 'correct_hermes',
  });
  assert.equal(
    correctionStatus(
      delivered.find((entry) => entry.callId === 'unauthorized')!.result,
    ),
    'rejected',
  );
  finishAsk();
  await settled();
});

test('corrections serialize against one active execution', async () => {
  let finishAsk!: () => void;
  let releaseFirst!: () => void;
  const started: string[] = [];
  const { delivered, orchestrator } = harness({
    execute: (_instruction, _signal, lifecycle) =>
      new Promise((resolve) => {
        lifecycle.activate();
        finishAsk = () =>
          resolve({ answer: 'done', ok: true, truncated: false });
      }),
    executeCorrection: (instruction) => {
      started.push(instruction);
      if (instruction === 'first correction') {
        return new Promise((resolve) => {
          releaseFirst = () => resolve({ ok: true, status: 'queued' });
        });
      }
      return Promise.resolve({ ok: true, status: 'redirected' });
    },
  });
  orchestrator.handleToolCall({
    arguments: args('active task'),
    callId: 'ask',
    name: 'ask_hermes',
  });
  await settled();
  for (const [callId, instruction] of [
    ['correct-a', 'first correction'],
    ['correct-b', 'second correction'],
  ]) {
    orchestrator.handleToolCall({
      arguments: args(instruction),
      callId,
      name: 'correct_hermes',
    });
  }
  await settled();
  assert.deepEqual(started, ['first correction']);
  releaseFirst();
  await settled();
  assert.deepEqual(started, ['first correction', 'second correction']);
  assert.deepEqual(
    delivered
      .filter((entry) => entry.callId.startsWith('correct-'))
      .map((entry) => correctionStatus(entry.result)),
    ['queued', 'redirected'],
  );
  finishAsk();
  await settled();
});

test('completion wins a correction race and never creates new work', async () => {
  let finishAsk!: () => void;
  let finishCorrection!: () => void;
  let asks = 0;
  const { delivered, orchestrator } = harness({
    execute: (_instruction, _signal, lifecycle) => {
      asks += 1;
      return new Promise((resolve) => {
        lifecycle.activate();
        finishAsk = () =>
          resolve({ answer: 'done', ok: true, truncated: false });
      });
    },
    executeCorrection: () =>
      new Promise((resolve) => {
        finishCorrection = () => resolve({ ok: true, status: 'redirected' });
      }),
  });
  orchestrator.handleToolCall({
    arguments: args('active task'),
    callId: 'ask',
    name: 'ask_hermes',
  });
  await settled();
  orchestrator.handleToolCall({
    arguments: args('late change'),
    callId: 'correct',
    name: 'correct_hermes',
  });
  await settled();
  finishAsk();
  await settled();
  finishCorrection();
  await settled();
  assert.equal(asks, 1);
  assert.equal(
    correctionStatus(
      delivered.find((entry) => entry.callId === 'correct')!.result,
    ),
    'nothing_active',
  );
});

test('a pending correction never retargets a later owner execution', async () => {
  const finishAsks: (() => void)[] = [];
  let releaseFirstCorrection!: () => void;
  let correctionExecutions = 0;
  const { delivered, orchestrator } = harness({
    execute: (instruction, _signal, lifecycle) =>
      new Promise((resolve) => {
        lifecycle.activate();
        finishAsks.push(() =>
          resolve({
            answer: `done: ${instruction}`,
            ok: true,
            truncated: false,
          }),
        );
      }),
    executeCorrection: () => {
      correctionExecutions += 1;
      return new Promise((resolve) => {
        releaseFirstCorrection = () =>
          resolve({ ok: true, status: 'redirected' });
      });
    },
  });
  orchestrator.handleToolCall({
    arguments: args('first task'),
    callId: 'ask-first',
    name: 'ask_hermes',
  });
  await settled();
  orchestrator.handleToolCall({
    arguments: args('first change'),
    callId: 'correct-first',
    name: 'correct_hermes',
  });
  await settled();
  assert.equal(correctionExecutions, 1);

  // The first owner completes while its correction is still in flight, and a
  // second distinct task then becomes the new owner.
  finishAsks[0]!();
  await settled();
  orchestrator.handleToolCall({
    arguments: args('second distinct task'),
    callId: 'ask-second',
    name: 'ask_hermes',
  });
  await settled();
  assert.equal(finishAsks.length, 2, 'the second ask is now the active work');
  releaseFirstCorrection();
  await settled();
  assert.equal(
    correctionExecutions,
    1,
    'the pending correction never executes against the later owner',
  );
  assert.equal(
    correctionStatus(
      delivered.find((entry) => entry.callId === 'correct-first')!.result,
    ),
    'nothing_active',
  );
  finishAsks[1]!();
  await settled();
});

test('correction failures are safe, bounded, and never retried', async () => {
  let finishAsk!: () => void;
  let attempts = 0;
  const { delivered, orchestrator } = harness({
    execute: (_instruction, _signal, lifecycle) =>
      new Promise((resolve) => {
        lifecycle.activate();
        finishAsk = () =>
          resolve({ answer: 'done', ok: true, truncated: false });
      }),
    executeCorrection: async () => {
      attempts += 1;
      throw new Error('sensitive upstream failure');
    },
  });
  orchestrator.handleToolCall({
    arguments: args('active task'),
    callId: 'ask',
    name: 'ask_hermes',
  });
  await settled();
  orchestrator.handleToolCall({
    arguments: args('one correction'),
    callId: 'correct',
    name: 'correct_hermes',
  });
  await settled();
  assert.equal(attempts, 1);
  const result = delivered.find((entry) => entry.callId === 'correct')!.result;
  assert.equal(correctionStatus(result), 'rejected');
  assert.doesNotMatch(JSON.stringify(result), /sensitive upstream/);
  finishAsk();
  await settled();
});

test('correction queue is rate bounded and call teardown stops delivery', async () => {
  let finishAsk!: () => void;
  const { delivered, orchestrator } = harness({
    execute: (_instruction, _signal, lifecycle) =>
      new Promise((resolve) => {
        lifecycle.activate();
        finishAsk = () =>
          resolve({ answer: 'done', ok: true, truncated: false });
      }),
    executeCorrection: (_instruction, signal) =>
      new Promise((resolve) => {
        signal.addEventListener('abort', () =>
          resolve({
            message: 'There is no active Hermes work to correct.',
            ok: false,
            retryable: false,
            status: 'nothing_active',
          }),
        );
      }),
  });
  orchestrator.handleToolCall({
    arguments: args('active task'),
    callId: 'ask',
    name: 'ask_hermes',
  });
  await settled();
  for (let index = 0; index < MAX_OUTSTANDING_CORRECTIONS + 1; index += 1) {
    orchestrator.handleToolCall({
      arguments: args(`correction ${index}`),
      callId: `correct-${index}`,
      name: 'correct_hermes',
    });
  }
  const overflow = delivered.find(
    (entry) => entry.callId === `correct-${MAX_OUTSTANDING_CORRECTIONS}`,
  );
  assert.equal(correctionStatus(overflow!.result), 'rejected');
  assert.equal(
    'retryable' in overflow!.result ? overflow!.result.retryable : undefined,
    true,
  );
  const deliveredBeforeAbort = delivered.length;
  orchestrator.abort();
  finishAsk();
  await settled();
  assert.equal(delivered.length, deliveredBeforeAbort);
});
