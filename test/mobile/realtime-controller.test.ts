import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  WaveEndRealtimeCallResponse,
  WaveRealtimeVoiceId,
  WaveStartRealtimeCallResponse,
} from '@wave/contracts';

import {
  WaveRealtimeController,
  type RealtimeBackend,
} from '../../src/features/realtime/realtime-controller.ts';
import {
  RealtimeTransportError,
  type PrepareRealtimeTransportOptions,
  type PreparedRealtimeTransport,
  type RealtimeTransport,
  type RealtimeTransportEvent,
} from '../../src/services/realtime/realtime-transport.ts';

const EXPIRES_AT = new Date(Date.now() + 60_000).toISOString();

class FakePreparedTransport implements PreparedRealtimeTransport {
  closed = false;
  connectedAnswer?: string;
  microphoneEnabled = true;
  readonly sdpOffer = 'v=0\r\nwave-offer';

  async connect(sdpAnswer: string, signal: AbortSignal) {
    if (signal.aborted) throw new Error('aborted');
    this.connectedAnswer = sdpAnswer;
  }

  close() {
    this.closed = true;
  }

  setMicrophoneEnabled(enabled: boolean) {
    this.microphoneEnabled = enabled;
  }
}

class FakeRealtimeTransport implements RealtimeTransport {
  readonly prepared = new FakePreparedTransport();
  onEvent?: (event: RealtimeTransportEvent) => void;
  prepareSignal?: AbortSignal;

  async prepare(options: PrepareRealtimeTransportOptions) {
    this.onEvent = options.onEvent;
    this.prepareSignal = options.signal;
    return this.prepared;
  }

  emit(event: RealtimeTransportEvent) {
    this.onEvent?.(event);
  }
}

class FakeRealtimeBackend implements RealtimeBackend {
  endAttempts = 0;
  endedCallIds: string[] = [];
  failNextEnd = false;
  lastVoiceId?: WaveRealtimeVoiceId;
  startResponse = Promise.resolve(realtimeStartResponse());

  async endRealtimeCall(callId: string): Promise<WaveEndRealtimeCallResponse> {
    this.endAttempts += 1;
    if (this.failNextEnd) {
      this.failNextEnd = false;
      throw backendError(
        'Wave could not confirm cleanup.',
        'upstream_unavailable',
        true,
      );
    }
    this.endedCallIds.push(callId);
    return {
      apiVersion: 'v1',
      callId,
      status: 'ended',
    };
  }

  startRealtimeCall(
    _sessionId: string,
    _sdpOffer: string,
    voiceId?: WaveRealtimeVoiceId,
  ) {
    this.lastVoiceId = voiceId;
    return this.startResponse;
  }
}

test('connects, reduces safe activity, controls the microphone, and cleans up explicitly', async () => {
  const backend = new FakeRealtimeBackend();
  const transport = new FakeRealtimeTransport();
  const controller = new WaveRealtimeController({
    backend,
    transport,
  });

  await controller.start('session-1', 'cedar');
  assert.equal(controller.getState().phase, 'listening');
  assert.equal(backend.lastVoiceId, 'cedar');
  assert.equal(transport.prepared.connectedAnswer, 'v=0\r\nwave-answer');

  transport.emit({
    activity: 'user_speaking',
    type: 'activity',
  });
  transport.emit({
    final: false,
    role: 'assistant',
    text: 'Hello',
    type: 'transcript',
  });
  transport.emit({
    count: 1,
    type: 'remote_audio_tracks',
  });
  assert.deepEqual(
    {
      assistantTranscript: controller.getState().assistantTranscript,
      phase: controller.getState().phase,
      remoteAudioTracks: controller.getState().remoteAudioTracks,
    },
    {
      assistantTranscript: 'Hello',
      phase: 'user_speaking',
      remoteAudioTracks: 1,
    },
  );

  controller.setMicrophoneEnabled(false);
  assert.equal(transport.prepared.microphoneEnabled, false);
  assert.equal(controller.getState().microphoneEnabled, false);

  await controller.stop();
  assert.equal(transport.prepared.closed, true);
  assert.deepEqual(backend.endedCallIds, ['call-1']);
  assert.equal(controller.getState().phase, 'idle');
});

test('ends a call that resolves after local cancellation without reviving state', async () => {
  const backend = new FakeRealtimeBackend();
  const transport = new FakeRealtimeTransport();
  const pending = deferred<WaveStartRealtimeCallResponse>();
  backend.startResponse = pending.promise;
  const controller = new WaveRealtimeController({
    backend,
    transport,
  });

  const starting = controller.start('session-1');
  await waitFor(() => controller.getState().phase === 'connecting');
  await controller.stop();
  assert.equal(controller.getState().phase, 'idle');
  assert.equal(transport.prepareSignal?.aborted, true);

  pending.resolve(realtimeStartResponse());
  await starting;
  assert.deepEqual(backend.endedCallIds, ['call-1']);
  assert.equal(controller.getState().phase, 'idle');
});

test('keeps failed cleanup explicit and retries it only after another stop request', async () => {
  const backend = new FakeRealtimeBackend();
  const transport = new FakeRealtimeTransport();
  const controller = new WaveRealtimeController({
    backend,
    transport,
  });

  await controller.start('session-1');
  backend.failNextEnd = true;
  await controller.stop();
  assert.equal(controller.getState().phase, 'error');
  assert.equal(controller.getState().error?.kind, 'upstream_unavailable');
  assert.equal(controller.getState().error?.retryable, true);
  assert.equal(backend.endAttempts, 1);

  await controller.stop();
  assert.equal(backend.endAttempts, 2);
  assert.deepEqual(backend.endedCallIds, ['call-1']);
  assert.equal(controller.getState().phase, 'idle');
});

test('a transport failure closes native resources and the companion call', async () => {
  const backend = new FakeRealtimeBackend();
  const transport = new FakeRealtimeTransport();
  const controller = new WaveRealtimeController({
    backend,
    transport,
  });

  await controller.start('session-1');
  transport.emit({
    error: new RealtimeTransportError('The native data channel failed.', {
      kind: 'connection',
      retryable: true,
    }),
    type: 'error',
  });
  await waitFor(() => controller.getState().phase === 'error');

  assert.equal(transport.prepared.closed, true);
  assert.deepEqual(backend.endedCallIds, ['call-1']);
  assert.deepEqual(controller.getState().error, {
    kind: 'connection',
    message: 'The native data channel failed.',
    retryable: true,
  });
});

test('surfaces transient disconnects and returns to listening when the peer recovers', async () => {
  const backend = new FakeRealtimeBackend();
  const transport = new FakeRealtimeTransport();
  const controller = new WaveRealtimeController({
    backend,
    transport,
  });

  await controller.start('session-1');
  transport.emit({
    state: 'disconnected',
    type: 'connection',
  });
  assert.equal(controller.getState().phase, 'reconnecting');

  transport.emit({
    state: 'connected',
    type: 'connection',
  });
  assert.equal(controller.getState().phase, 'listening');

  await controller.stop();
});

function backendError(message: string, kind: string, retryable: boolean) {
  return Object.assign(new Error(message), {
    kind,
    retryable,
  });
}

function deferred<T>() {
  let resolve = (_value: T) => {};
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function realtimeStartResponse(): WaveStartRealtimeCallResponse {
  return {
    apiVersion: 'v1',
    call: {
      expiresAt: EXPIRES_AT,
      id: 'call-1',
      sdpAnswer: 'v=0\r\nwave-answer',
    },
  };
}

async function waitFor(condition: () => boolean, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail('Timed out waiting for Realtime controller state.');
}
