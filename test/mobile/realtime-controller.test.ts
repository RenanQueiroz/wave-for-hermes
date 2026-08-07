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
  transport.emit({
    assistant: 0.75,
    type: 'audio_levels',
    user: 0.4,
  });
  assert.deepEqual(
    {
      assistantAudioLevel: controller.getState().assistantAudioLevel,
      assistantTranscript: controller.getState().assistantTranscript,
      phase: controller.getState().phase,
      remoteAudioTracks: controller.getState().remoteAudioTracks,
      userAudioLevel: controller.getState().userAudioLevel,
    },
    {
      assistantAudioLevel: 0.75,
      assistantTranscript: 'Hello',
      phase: 'user_speaking',
      remoteAudioTracks: 1,
      userAudioLevel: 0.4,
    },
  );

  controller.setMicrophoneEnabled(false);
  assert.equal(transport.prepared.microphoneEnabled, false);
  assert.equal(controller.getState().microphoneEnabled, false);
  assert.equal(controller.getState().userAudioLevel, 0);

  await controller.stop();
  assert.equal(transport.prepared.closed, true);
  assert.deepEqual(backend.endedCallIds, ['call-1']);
  assert.equal(controller.getState().phase, 'idle');
});

test('a final exact stop phrase ends Realtime locally without retaining it', async () => {
  const backend = new FakeRealtimeBackend();
  const transport = new FakeRealtimeTransport();
  const controller = new WaveRealtimeController({ backend, transport });

  await controller.start('session-1');
  transport.emit({
    final: true,
    role: 'user',
    text: '  Never mind! ',
    type: 'transcript',
  });
  await waitFor(() => controller.getState().phase === 'idle');
  assert.deepEqual(backend.endedCallIds, ['call-1']);
  assert.equal(controller.getState().userTranscript, '');
});

test('a final utterance containing a stop word remains conversation', async () => {
  const backend = new FakeRealtimeBackend();
  const transport = new FakeRealtimeTransport();
  const controller = new WaveRealtimeController({ backend, transport });

  await controller.start('session-1');
  transport.emit({
    final: true,
    role: 'user',
    text: 'Stop the deployment',
    type: 'transcript',
  });
  assert.equal(controller.getState().phase, 'listening');
  assert.equal(controller.getState().userTranscript, 'Stop the deployment');
  assert.deepEqual(backend.endedCallIds, []);
  await controller.stop();
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

test('a transport failure closes native resources and the backend call', async () => {
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

class ReconnectableTransport implements RealtimeTransport {
  onEvent?: (event: RealtimeTransportEvent) => void;
  readonly prepares: FakePreparedTransport[] = [];

  async prepare(options: PrepareRealtimeTransportOptions) {
    this.onEvent = options.onEvent;
    const prepared = new FakePreparedTransport();
    this.prepares.push(prepared);
    return prepared;
  }

  emit(event: RealtimeTransportEvent) {
    this.onEvent?.(event);
  }
}

class SequencedBackend implements RealtimeBackend {
  readonly endedCallIds: string[] = [];
  failStartsAfterFirst = false;
  startCalls = 0;

  async endRealtimeCall(callId: string): Promise<WaveEndRealtimeCallResponse> {
    this.endedCallIds.push(callId);
    return { apiVersion: 'v1', callId, status: 'ended' };
  }

  async startRealtimeCall(): Promise<WaveStartRealtimeCallResponse> {
    this.startCalls += 1;
    if (this.failStartsAfterFirst && this.startCalls > 1) {
      throw backendError('unreachable', 'connection', true);
    }
    return {
      apiVersion: 'v1',
      call: {
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        id: `call-${this.startCalls}`,
        sdpAnswer: 'v=0\r\nwave-answer',
      },
    };
  }
}

test('re-establishes a dropped call with a full re-offer and keeps transcripts', async () => {
  const backend = new SequencedBackend();
  const transport = new ReconnectableTransport();
  const controller = new WaveRealtimeController({ backend, transport });

  await controller.start('session-1');
  transport.emit({
    final: true,
    role: 'assistant',
    text: 'Before the drop',
    type: 'transcript',
  });
  transport.emit({ state: 'disconnected', type: 'connection' });
  assert.equal(controller.getState().phase, 'reconnecting');

  await waitFor(() => controller.getState().phase === 'listening', 5_000);
  // A second transport and a second call were established; the dead call was
  // hung up; the transcript survived the drop.
  assert.equal(transport.prepares.length, 2);
  assert.equal(backend.startCalls, 2);
  assert.deepEqual(backend.endedCallIds, ['call-1']);
  assert.equal(controller.getState().assistantTranscript, 'Before the drop');
});

test('bounded reconnect attempts end in an explicit retryable error', async () => {
  const backend = new SequencedBackend();
  backend.failStartsAfterFirst = true;
  const transport = new ReconnectableTransport();
  const controller = new WaveRealtimeController({ backend, transport });

  await controller.start('session-1');
  transport.emit({ state: 'failed', type: 'connection' });

  await waitFor(() => controller.getState().phase === 'error', 15_000);
  // 1 initial + 3 bounded attempts, then an explicit failure.
  assert.equal(backend.startCalls, 4);
  assert.equal(controller.getState().error?.retryable, true);
});

test('stopping during a reconnect wins over further attempts', async () => {
  const backend = new SequencedBackend();
  backend.failStartsAfterFirst = true;
  const transport = new ReconnectableTransport();
  const controller = new WaveRealtimeController({ backend, transport });

  await controller.start('session-1');
  transport.emit({ state: 'disconnected', type: 'connection' });
  assert.equal(controller.getState().phase, 'reconnecting');
  await controller.stop();
  assert.equal(controller.getState().phase, 'idle');
  const startsAtStop = backend.startCalls;
  await new Promise((resolve) => setTimeout(resolve, 2_500));
  assert.equal(backend.startCalls, startsAtStop);
});

test('a delta after a final transcript starts a fresh turn, never glued text', async () => {
  const backend = new FakeRealtimeBackend();
  const transport = new FakeRealtimeTransport();
  const controller = new WaveRealtimeController({ backend, transport });

  await controller.start('session-1');
  transport.emit({
    final: false,
    role: 'assistant',
    text: 'First answer',
    type: 'transcript',
  });
  transport.emit({
    final: true,
    role: 'assistant',
    text: 'First answer.',
    type: 'transcript',
  });
  assert.equal(controller.getState().assistantTranscript, 'First answer.');

  // The next turn's opening delta replaces the sealed turn instead of
  // concatenating onto its period.
  transport.emit({
    final: false,
    role: 'assistant',
    text: 'Second',
    type: 'transcript',
  });
  transport.emit({
    final: false,
    role: 'assistant',
    text: ' answer',
    type: 'transcript',
  });
  assert.equal(controller.getState().assistantTranscript, 'Second answer');
  transport.emit({
    final: true,
    role: 'assistant',
    text: 'Second answer.',
    type: 'transcript',
  });
  assert.equal(controller.getState().assistantTranscript, 'Second answer.');
  await controller.stop();
});
