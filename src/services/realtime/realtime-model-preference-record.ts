/**
 * App-owned Realtime model catalog.
 *
 * This is deliberately a closed list: Wave does not fetch OpenAI's model
 * catalog and never forwards a free-form model id into call setup. Removing a
 * model from this list makes an older stored preference fall back to mini.
 */
export const WAVE_REALTIME_MODEL_IDS = [
  'gpt-realtime-2.1-mini',
  'gpt-realtime-2.1',
] as const;

export type WaveRealtimeModelId = (typeof WAVE_REALTIME_MODEL_IDS)[number];

export const WAVE_REALTIME_DEFAULT_MODEL: WaveRealtimeModelId =
  'gpt-realtime-2.1-mini';

// Published OpenAI audio-token prices as of August 2026; update alongside
// any model list change.
export const WAVE_REALTIME_MODEL_OPTIONS: readonly {
  description: string;
  id: WaveRealtimeModelId;
  label: string;
  testID: string;
}[] = [
  {
    description:
      'The faster, lower-cost option. Audio $10 in / $20 out per 1M tokens',
    id: 'gpt-realtime-2.1-mini',
    label: 'GPT-Realtime-2.1 mini',
    testID: 'realtime-model-gpt-realtime-2-1-mini',
  },
  {
    description:
      'The larger-model option. Audio $32 in / $64 out per 1M tokens',
    id: 'gpt-realtime-2.1',
    label: 'GPT-Realtime-2.1',
    testID: 'realtime-model-gpt-realtime-2-1',
  },
];

export function isWaveRealtimeModelId(
  value: unknown,
): value is WaveRealtimeModelId {
  return WAVE_REALTIME_MODEL_IDS.some((model) => model === value);
}

export function parseRealtimeModelPreference(
  serialized: string,
): WaveRealtimeModelId {
  const value = JSON.parse(serialized) as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid Realtime model preference.');
  }
  const record = value as Record<string, unknown>;
  if (
    record.version !== 1 ||
    Object.keys(record).some((key) => key !== 'model' && key !== 'version') ||
    !isWaveRealtimeModelId(record.model)
  ) {
    throw new Error('Invalid Realtime model preference.');
  }
  return record.model;
}

export function serializeRealtimeModelPreference(model: WaveRealtimeModelId) {
  if (!isWaveRealtimeModelId(model)) {
    throw new Error('Invalid Realtime model preference.');
  }
  return JSON.stringify({ model, version: 1 });
}
