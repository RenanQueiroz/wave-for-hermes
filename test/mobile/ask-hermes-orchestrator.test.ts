/**
 * Ported ask_hermes rules plus the Stage 5b active-execution correction
 * boundary: global cap, unknown tools, strict arguments, trusted binding,
 * ask coalescing/concurrency/serialization, and correction gating/races.
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

function correctionStatus(result: WaveRealtimeToolResult) {
  return 'status' in result ? result.status : undefined;
}

async function settled() {
  // Two microtask hops let the serialized queue drain.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

test('R1: refuses further tool calls past the per-call cap', async () => {
  const { delivered, orchestrator } = harness();
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

test('R6: bounds concurrent executions and reports busy beyond them', async () => {
  const releases: (() => void)[] = [];
  const { delivered, orchestrator } = harness({
    execute: (instruction) =>
      new Promise((resolve) => {
        releases.push(() =>
          resolve({
            answer: `did: ${instruction}`,
            ok: true,
            truncated: false,
          }),
        );
      }),
  });
  for (let i = 0; i < MAX_OUTSTANDING_TOOL_CALLS; i += 1) {
    orchestrator.handleToolCall({
      arguments: args(`slow ${i}`),
      callId: `slow-${i}`,
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
  // Executions are serialized (R7), so each release lets the next one start.
  for (let i = 0; i < MAX_OUTSTANDING_TOOL_CALLS; i += 1) {
    await settled();
    releases.shift()?.();
  }
  await settled();
  assert.equal(delivered.length, MAX_OUTSTANDING_TOOL_CALLS + 1);
});

test('R7: executions run one at a time in arrival order', async () => {
  const order: string[] = [];
  let running = 0;
  const { orchestrator } = harness({
    execute: async (instruction) => {
      running += 1;
      assert.equal(running, 1, 'two executions overlapped');
      order.push(instruction);
      await new Promise((resolve) => setTimeout(resolve, 1));
      running -= 1;
      return { answer: 'ok', ok: true, truncated: false };
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
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(order, ['first', 'second', 'third']);
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

test('queued corrections never retarget later queued ask work', async () => {
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
  orchestrator.handleToolCall({
    arguments: args('second distinct task'),
    callId: 'ask-second',
    name: 'ask_hermes',
  });
  await settled();
  orchestrator.handleToolCall({
    arguments: args('first change'),
    callId: 'correct-first',
    name: 'correct_hermes',
  });
  orchestrator.handleToolCall({
    arguments: args('second change'),
    callId: 'correct-second',
    name: 'correct_hermes',
  });
  await settled();
  assert.equal(correctionExecutions, 1);

  finishAsks[0]!();
  await settled();
  assert.equal(finishAsks.length, 2, 'the second ask is now the active work');
  releaseFirstCorrection();
  await settled();
  assert.equal(
    correctionExecutions,
    1,
    'the queued correction never executes against the later ask',
  );
  for (const callId of ['correct-first', 'correct-second']) {
    assert.equal(
      correctionStatus(
        delivered.find((entry) => entry.callId === callId)!.result,
      ),
      'nothing_active',
    );
  }
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
