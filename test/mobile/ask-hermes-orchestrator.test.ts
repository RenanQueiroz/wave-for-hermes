/**
 * One test per ported ask_hermes contract rule (stage 4). The rule numbers
 * mirror the orchestrator's doc comment: R1 tool-call cap, R2 unknown tool,
 * R3 strict arguments (incl. no model-controlled session ids), R4 trusted
 * binding, R5 exact-instruction coalescing, R6 concurrency bound,
 * R7 serialization.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { WaveAskHermesToolResult } from '@wave/contracts';

import {
  AskHermesOrchestrator,
  MAX_OUTSTANDING_TOOL_CALLS,
  MAX_TOOL_CALLS_PER_REALTIME_CALL,
} from '../../src/features/realtime/ask-hermes-orchestrator.ts';

function harness(options?: {
  authorized?: () => boolean;
  execute?: (
    instruction: string,
    signal: AbortSignal,
  ) => Promise<WaveAskHermesToolResult>;
}) {
  const delivered: { callId: string; result: WaveAskHermesToolResult }[] = [];
  const orchestrator = new AskHermesOrchestrator({
    deliver: (callId, result) => delivered.push({ callId, result }),
    execute:
      options?.execute ??
      (async (instruction) => ({
        answer: `did: ${instruction}`,
        ok: true,
        truncated: false,
      })),
    isAuthorized: options?.authorized ?? (() => true),
  });
  return { delivered, orchestrator };
}

const args = (instruction: string) => JSON.stringify({ instruction });

function errorCode(result: WaveAskHermesToolResult) {
  return result.ok ? undefined : result.error.code;
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

test('R2: refuses tools other than ask_hermes', async () => {
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
