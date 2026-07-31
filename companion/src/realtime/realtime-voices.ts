import {
  WAVE_REALTIME_VOICE_IDS,
  WaveRealtimeVoiceOptionSchema,
  type WaveRealtimeVoiceOption,
} from '@wave/contracts';

const VOICE_COPY: Record<
  (typeof WAVE_REALTIME_VOICE_IDS)[number],
  Omit<WaveRealtimeVoiceOption, 'id'>
> = {
  alloy: {
    description: 'Balanced and adaptable for everyday conversation.',
    label: 'Alloy',
  },
  ash: {
    description: 'Warm and animated with an easy conversational pace.',
    label: 'Ash',
  },
  ballad: {
    description: 'Expressive and melodic for a more emotive delivery.',
    label: 'Ballad',
  },
  cedar: {
    description: 'Clear and grounded with a steady presence.',
    label: 'Cedar',
  },
  coral: {
    description: 'Friendly and conversational with a warm tone.',
    label: 'Coral',
  },
  echo: {
    description: 'Calm and resonant with an even delivery.',
    label: 'Echo',
  },
  marin: {
    description: 'Natural and expressive for a polished voice experience.',
    label: 'Marin',
  },
  sage: {
    description: 'Measured and thoughtful with a composed tone.',
    label: 'Sage',
  },
  shimmer: {
    description: 'Bright and energetic with a lively delivery.',
    label: 'Shimmer',
  },
  verse: {
    description: 'Smooth and articulate with a relaxed cadence.',
    label: 'Verse',
  },
};

export const WAVE_REALTIME_VOICE_OPTIONS = WAVE_REALTIME_VOICE_IDS.map((id) =>
  WaveRealtimeVoiceOptionSchema.parse({
    id,
    ...VOICE_COPY[id],
  }),
);
