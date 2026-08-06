import assert from 'node:assert/strict';
import test from 'node:test';

import { RealtimeAudioLevelMeter } from '../../src/services/realtime/realtime-audio-level-meter.ts';

test('reduces only local-source and remote-inbound audio stats', () => {
  const meter = new RealtimeAudioLevelMeter();
  const levels = meter.read(
    new Map([
      [
        'remote-audio',
        {
          audioLevel: 0.1,
          id: 'remote-audio',
          kind: 'audio',
          type: 'inbound-rtp',
        },
      ],
      [
        'microphone',
        {
          audioLevel: 0.01,
          id: 'microphone',
          kind: 'audio',
          type: 'media-source',
        },
      ],
      [
        'remote-report',
        {
          audioLevel: 1,
          kind: 'audio',
          type: 'remote-inbound-rtp',
        },
      ],
      ['video', { audioLevel: 1, kind: 'video', type: 'inbound-rtp' }],
    ]),
  );

  assert.ok(levels.assistant !== null && levels.assistant > 0.6);
  assert.ok(levels.user !== null && levels.user > 0.3);
});

test('derives an interval RMS level from cumulative energy counters', () => {
  const meter = new RealtimeAudioLevelMeter();
  const first = meter.read(energyReport({ duration: 1, energy: 0.01 }));
  assert.deepEqual(first, { assistant: null, user: null });

  const second = meter.read(energyReport({ duration: 2, energy: 0.02 }));
  assert.ok(second.assistant !== null);
  assert.ok(Math.abs(second.assistant - 2 / 3) < 1e-12);
  assert.equal(second.user, null);
});

test('ignores malformed reports and resets cumulative baselines', () => {
  const meter = new RealtimeAudioLevelMeter();
  assert.deepEqual(meter.read({}), { assistant: null, user: null });
  meter.read(energyReport({ duration: 1, energy: 0.01 }));
  meter.reset();
  assert.deepEqual(meter.read(energyReport({ duration: 2, energy: 0.02 })), {
    assistant: null,
    user: null,
  });
});

function energyReport({
  duration,
  energy,
}: {
  duration: number;
  energy: number;
}) {
  return new Map([
    [
      'remote-audio',
      {
        id: 'remote-audio',
        kind: 'audio',
        totalAudioEnergy: energy,
        totalSamplesDuration: duration,
        type: 'inbound-rtp',
      },
    ],
  ]);
}
