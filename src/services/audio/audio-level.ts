const AUDIO_LEVEL_FLOOR_DBFS = -60;

/**
 * Convert a linear PCM amplitude into the bounded 0-1 scale used by Wave's
 * meters. The logarithmic mapping keeps ordinary speech visible without
 * turning digital silence into motion.
 */
export function linearPcmLevelToAudioLevel(level: number) {
  if (!Number.isFinite(level) || level <= 0) return 0;
  const dbfs = 20 * Math.log10(Math.min(1, level));
  return dbfsToAudioLevel(dbfs);
}

/** Convert a recorder-provided dBFS value into Wave's bounded meter scale. */
export function dbfsToAudioLevel(dbfs: number) {
  if (!Number.isFinite(dbfs) || dbfs <= AUDIO_LEVEL_FLOOR_DBFS) return 0;
  if (dbfs >= 0) return 1;
  return (dbfs - AUDIO_LEVEL_FLOOR_DBFS) / -AUDIO_LEVEL_FLOOR_DBFS;
}

/** Calculate one RMS level across normalized PCM channels. */
export function pcmChannelsToAudioLevel(
  channels: readonly ArrayLike<number>[],
) {
  let sampleCount = 0;
  let sumSquares = 0;

  for (const channel of channels) {
    for (let index = 0; index < channel.length; index += 1) {
      const sample = channel[index];
      if (!Number.isFinite(sample)) continue;
      const bounded = Math.max(-1, Math.min(1, sample));
      sumSquares += bounded * bounded;
      sampleCount += 1;
    }
  }

  if (sampleCount === 0) return 0;
  return linearPcmLevelToAudioLevel(Math.sqrt(sumSquares / sampleCount));
}
