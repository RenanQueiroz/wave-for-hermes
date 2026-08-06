import { linearPcmLevelToAudioLevel } from '../audio/audio-level.ts';

export interface RealtimeAudioLevels {
  assistant: number | null;
  user: number | null;
}

interface AudioEnergySnapshot {
  energy: number;
  duration: number;
}

type AudioDirection = keyof RealtimeAudioLevels;

/**
 * Reduces the native WebRTC stats map to bounded Wave-owned audio levels.
 * Provider identifiers and the underlying report never cross this boundary.
 */
export class RealtimeAudioLevelMeter {
  private readonly previousEnergy = new Map<string, AudioEnergySnapshot>();

  read(report: unknown): RealtimeAudioLevels {
    const levels: RealtimeAudioLevels = { assistant: null, user: null };
    if (!(report instanceof Map)) return levels;

    for (const [entryId, value] of report) {
      if (!isRecord(value)) continue;
      const direction = audioDirection(value);
      if (!direction) continue;

      const id =
        typeof value.id === 'string' && value.id ? value.id : String(entryId);
      const linearLevel = this.readLinearLevel(id, value);
      if (linearLevel === undefined) continue;
      const normalized = linearPcmLevelToAudioLevel(linearLevel);
      levels[direction] = Math.max(levels[direction] ?? 0, normalized);
    }

    return levels;
  }

  reset() {
    this.previousEnergy.clear();
  }

  private readLinearLevel(id: string, value: Record<string, unknown>) {
    const direct = finiteNonNegative(value.audioLevel);
    const energy = finiteNonNegative(value.totalAudioEnergy);
    const duration = finiteNonNegative(value.totalSamplesDuration);

    let intervalLevel: number | undefined;
    if (energy !== undefined && duration !== undefined) {
      const previous = this.previousEnergy.get(id);
      this.previousEnergy.set(id, { duration, energy });
      if (
        previous &&
        energy >= previous.energy &&
        duration > previous.duration
      ) {
        intervalLevel = Math.sqrt(
          (energy - previous.energy) / (duration - previous.duration),
        );
      }
    }

    // `audioLevel` is already a short-window RMS value when the native
    // implementation supplies it. Counter deltas are the standards-defined
    // fallback when it does not.
    return direct ?? intervalLevel;
  }
}

function audioDirection(
  value: Record<string, unknown>,
): AudioDirection | undefined {
  const kind = value.kind ?? value.mediaType;
  if (kind !== 'audio') return undefined;
  if (value.type === 'inbound-rtp') return 'assistant';
  if (value.type === 'media-source' || value.type === 'outbound-rtp') {
    return 'user';
  }
  return undefined;
}

function finiteNonNegative(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
