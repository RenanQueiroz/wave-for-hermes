import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createRealtimeToolSurfaceSessionUpdate,
  createRealtimeToolDefinitions,
} from '../../src/services/realtime/realtime-prompt.ts';
import {
  matchesToolSurface,
  RealtimeToolSurfaceController,
} from '../../src/services/realtime/realtime-tool-surface-controller.ts';

function parseSent(sent: string[], index: number) {
  return JSON.parse(sent[index]!) as {
    session: Record<string, unknown>;
    type: string;
  };
}

test('serializes one complete update and waits for matching acknowledgement', () => {
  const sent: string[] = [];
  const controller = new RealtimeToolSurfaceController({
    send: (event) => sent.push(event),
  });

  assert.deepEqual(controller.getSnapshot(), {
    acknowledged: 'idle',
    desired: 'idle',
    updatePending: false,
  });
  controller.request(true);
  controller.request(false);
  assert.equal(sent.length, 1, 'only one update may be in flight');
  const activation = parseSent(sent, 0);
  assert.equal(activation.type, 'session.update');
  assert.deepEqual(
    (activation.session.tools as { name: string }[]).map(({ name }) => name),
    ['ask_hermes', 'correct_hermes'],
  );
  assert.doesNotMatch(sent[0]!, /"model"|"voice"/);

  controller.handleSessionUpdated(
    createRealtimeToolSurfaceSessionUpdate('active'),
  );
  assert.equal(sent.length, 2, 'latest idle state converges after the ack');
  assert.deepEqual(parseSent(sent, 1).session.tools, [
    createRealtimeToolDefinitions('idle')[0],
  ]);
  controller.handleSessionUpdated(
    createRealtimeToolSurfaceSessionUpdate('idle'),
  );
  assert.deepEqual(controller.getSnapshot(), {
    acknowledged: 'idle',
    desired: 'idle',
    updatePending: false,
  });
});

test('coalesces rapid settle and reactivation to the latest desired state', () => {
  const sent: string[] = [];
  const controller = new RealtimeToolSurfaceController({
    send: (event) => sent.push(event),
  });
  controller.request(true);
  controller.request(false);
  controller.request(true);
  controller.handleSessionUpdated(
    createRealtimeToolSurfaceSessionUpdate('active'),
  );
  assert.equal(sent.length, 1);
  assert.deepEqual(controller.getSnapshot(), {
    acknowledged: 'active',
    desired: 'active',
    updatePending: false,
  });
});

test('a failed update stays unknown and does not retry until a later transition', () => {
  const sent: string[] = [];
  let fail = true;
  const controller = new RealtimeToolSurfaceController({
    send: (event) => {
      sent.push(event);
      if (fail) throw new Error('socket send failed');
    },
  });
  controller.request(true);
  assert.equal(sent.length, 1);
  assert.deepEqual(controller.getSnapshot(), {
    acknowledged: 'unknown',
    desired: 'active',
    updatePending: false,
  });
  controller.request(true);
  assert.equal(sent.length, 1, 'same desired state is not an automatic retry');

  fail = false;
  controller.request(false);
  assert.equal(sent.length, 2);
  controller.handleSessionUpdated(
    createRealtimeToolSurfaceSessionUpdate('idle'),
  );
  assert.equal(controller.getSnapshot().acknowledged, 'idle');
});

test('a failed removal cannot retry and a later active transition reconverges', () => {
  const sent: string[] = [];
  let fail = false;
  const controller = new RealtimeToolSurfaceController({
    send: (event) => {
      sent.push(event);
      if (fail) throw new Error('socket send failed');
    },
  });
  controller.request(true);
  controller.handleSessionUpdated(
    createRealtimeToolSurfaceSessionUpdate('active'),
  );
  fail = true;
  controller.request(false);
  assert.deepEqual(controller.getSnapshot(), {
    acknowledged: 'unknown',
    desired: 'idle',
    updatePending: false,
  });
  controller.request(false);
  assert.equal(sent.length, 2, 'failed removal is not retried');

  fail = false;
  controller.request(true);
  assert.equal(sent.length, 3);
  controller.handleSessionUpdated(
    createRealtimeToolSurfaceSessionUpdate('active'),
  );
  assert.equal(controller.getSnapshot().acknowledged, 'active');
});

test('a timed-out update ignores stale acknowledgement and teardown is safe', async () => {
  const sent: string[] = [];
  const controller = new RealtimeToolSurfaceController({
    send: (event) => sent.push(event),
    timeoutMs: 5,
  });
  controller.request(true);
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.deepEqual(controller.getSnapshot(), {
    acknowledged: 'unknown',
    desired: 'active',
    updatePending: false,
  });
  controller.handleSessionUpdated(
    createRealtimeToolSurfaceSessionUpdate('active'),
  );
  assert.equal(controller.getSnapshot().acknowledged, 'unknown');
  assert.equal(sent.length, 1);
  controller.request(false);
  assert.equal(sent.length, 2);
  controller.close();
  controller.handleSessionUpdated(
    createRealtimeToolSurfaceSessionUpdate('idle'),
  );
  controller.request(true);
  assert.equal(sent.length, 2);
});

test('acknowledgement inspection rejects incomplete or unexpected tool lists', () => {
  const active = createRealtimeToolSurfaceSessionUpdate('active');
  assert.equal(matchesToolSurface(active, 'active'), true);
  assert.equal(matchesToolSurface(active, 'idle'), false);
  assert.equal(
    matchesToolSurface(
      { ...active, model: 'unexpected-but-ignored' },
      'active',
    ),
    true,
  );
  assert.equal(matchesToolSurface({ ...active, tools: [] }, 'active'), false);
  assert.equal(
    matchesToolSurface(
      {
        ...active,
        tools: [...active.tools, { name: 'delete_everything' }],
      },
      'active',
    ),
    false,
  );
});
