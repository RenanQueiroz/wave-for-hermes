/**
 * Wire-level self-tests for the scripted OpenAI-Realtime fake: call setup,
 * dummy-bearer enforcement, session.update echo, the auto-responder, and the
 * scripted step machine.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { WebSocket } from 'ws';

import { startVoiceHarness, type RunningVoiceHarness } from './index.js';

const DUMMY_BEARER = 'Bearer sk-wave-harness-000000000000000000000';

async function startCall(harness: RunningVoiceHarness): Promise<string> {
  const form = new FormData();
  form.append('sdp', 'v=0\r\ns=offer\r\n');
  form.append(
    'session',
    JSON.stringify({
      model: 'gpt-realtime-2.1-mini',
      tools: [{ name: 'ask_hermes' }],
      type: 'realtime',
    }),
  );
  const response = await fetch(`${harness.gatewayUrl}/v1/realtime/calls`, {
    body: form,
    headers: { Authorization: DUMMY_BEARER },
    method: 'POST',
  });
  assert.equal(response.status, 201);
  const answer = await response.text();
  assert.ok(answer.startsWith('v='), 'SDP answer must start with v=');
  const location = response.headers.get('location') ?? '';
  const callId = location.split('/').at(-1) ?? '';
  assert.ok(callId.startsWith('harness-call-'));
  return callId;
}

function openSideband(harness: RunningVoiceHarness, callId: string) {
  const wsBase = harness.gatewayUrl.replace(/^http/, 'ws');
  const socket = new WebSocket(`${wsBase}/v1/realtime?call_id=${callId}`);
  const frames: Record<string, unknown>[] = [];
  const waiters: {
    predicate: (frame: Record<string, unknown>) => boolean;
    resolve: (frame: Record<string, unknown>) => void;
  }[] = [];
  socket.on('message', (data) => {
    const frame = JSON.parse(String(data)) as Record<string, unknown>;
    frames.push(frame);
    for (let index = waiters.length - 1; index >= 0; index -= 1) {
      const waiter = waiters[index];
      if (waiter && waiter.predicate(frame)) {
        waiters.splice(index, 1);
        waiter.resolve(frame);
      }
    }
  });
  return {
    close: () => socket.close(),
    frames,
    open: () =>
      new Promise<void>((resolve, reject) => {
        socket.once('open', resolve);
        socket.once('error', reject);
      }),
    send: (event: Record<string, unknown>) =>
      socket.send(JSON.stringify(event)),
    waitFor: (
      predicate: (frame: Record<string, unknown>) => boolean,
      timeoutMs = 5_000,
    ) => {
      const existing = frames.find(predicate);
      if (existing) return Promise.resolve(existing);
      return new Promise<Record<string, unknown>>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('timed out waiting for frame')),
          timeoutMs,
        );
        waiters.push({
          predicate,
          resolve: (frame) => {
            clearTimeout(timer);
            resolve(frame);
          },
        });
      });
    },
  };
}

test('call setup requires the dummy bearer and answers the SDP exchange', async () => {
  const harness = await startVoiceHarness({ controlPort: 0, gatewayPort: 0 });
  try {
    const rejected = await fetch(`${harness.gatewayUrl}/v1/realtime/calls`, {
      headers: { Authorization: 'Bearer sk-looks-like-a-real-user-key-123456' },
      method: 'POST',
    });
    assert.equal(rejected.status, 401);

    const callId = await startCall(harness);
    const hangup = await fetch(
      `${harness.gatewayUrl}/v1/realtime/calls/${callId}/hangup`,
      { headers: { Authorization: DUMMY_BEARER }, method: 'POST' },
    );
    assert.equal(hangup.status, 200);
  } finally {
    await harness.close();
  }
});

test('sideband echoes session.update and auto-answers response.create when unscripted', async () => {
  const harness = await startVoiceHarness({ controlPort: 0, gatewayPort: 0 });
  try {
    const callId = await startCall(harness);
    const sideband = openSideband(harness, callId);
    await sideband.open();
    await sideband.waitFor((frame) => frame.type === 'session.created');

    const session = {
      instructions: 'be helpful',
      tool_choice: 'auto',
      tools: [{ name: 'ask_hermes', type: 'function' }],
      type: 'realtime',
    };
    sideband.send({ session, type: 'session.update' });
    const updated = await sideband.waitFor(
      (frame) => frame.type === 'session.updated',
    );
    assert.deepEqual(updated.session, session, 'echo must be structural');

    sideband.send({ response: {}, type: 'response.create' });
    await sideband.waitFor((frame) => frame.type === 'response.created');
    await sideband.waitFor((frame) => frame.type === 'response.done');
    sideband.close();

    // An unknown call id is refused at upgrade.
    const wsBase = harness.gatewayUrl.replace(/^http/, 'ws');
    const refused = new WebSocket(`${wsBase}/v1/realtime?call_id=not-issued`);
    await new Promise<void>((resolve) => {
      refused.once('error', () => resolve());
      refused.once('unexpected-response', () => resolve());
    });
  } finally {
    await harness.close();
  }
});

test('scripted call: user speech, function call, wait for result, assistant speech', async () => {
  const harness = await startVoiceHarness({ controlPort: 0, gatewayPort: 0 });
  try {
    const scenario = await fetch(`${harness.controlUrl}/control/scenario`, {
      body: JSON.stringify({
        realtimeCalls: [
          {
            script: [
              { transcript: 'Turn off the lights', type: 'user_speech' },
              {
                arguments: { instruction: 'Turn off the lights' },
                name: 'ask_hermes',
                type: 'function_call',
              },
              { type: 'wait_function_result' },
              { text: 'Done, lights are off.', type: 'assistant_speech' },
            ],
          },
        ],
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });
    assert.equal(scenario.status, 200);

    const callId = await startCall(harness);
    const sideband = openSideband(harness, callId);
    await sideband.open();

    await sideband.waitFor(
      (frame) => frame.type === 'input_audio_buffer.speech_stopped',
    );
    await sideband.waitFor(
      (frame) =>
        frame.type === 'conversation.item.input_audio_transcription.completed',
    );
    const call = await sideband.waitFor((frame) => {
      if (frame.type !== 'response.done') return false;
      const output = (frame.response as { output?: unknown[] })?.output ?? [];
      return output.some(
        (item) => (item as { type?: string }).type === 'function_call',
      );
    });
    const output = (call.response as { output: Record<string, unknown>[] })
      .output[0];
    assert.equal(output?.name, 'ask_hermes');
    assert.equal(
      output?.arguments,
      JSON.stringify({ instruction: 'Turn off the lights' }),
    );

    // The script now waits; deliver the function result the way Wave does.
    sideband.send({
      item: {
        call_id: output?.call_id,
        output: JSON.stringify({ answer: 'ok', ok: true }),
        type: 'function_call_output',
      },
      type: 'conversation.item.create',
    });
    sideband.send({ response: {}, type: 'response.create' });

    const spoken = await sideband.waitFor(
      (frame) => frame.type === 'response.output_audio_transcript.done',
    );
    assert.equal(spoken.transcript, 'Done, lights are off.');
    await sideband.waitFor(
      (frame) => frame.type === 'output_audio_buffer.stopped',
    );
    sideband.close();
  } finally {
    await harness.close();
  }
});
