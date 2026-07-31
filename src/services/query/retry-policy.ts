const BASE_RETRY_DELAY_MS = 500;
const MAX_RETRY_DELAY_MS = 8_000;
const MIN_JITTER_FACTOR = 0.75;
const JITTER_RANGE = 0.5;

export function calculateBoundedRetryDelay(
  attemptIndex: number,
  randomValue = Math.random(),
) {
  const safeAttempt = Number.isFinite(attemptIndex)
    ? Math.max(0, Math.floor(attemptIndex))
    : 0;
  const exponentialDelay = Math.min(
    BASE_RETRY_DELAY_MS * 2 ** safeAttempt,
    MAX_RETRY_DELAY_MS,
  );
  const boundedRandom = Number.isFinite(randomValue)
    ? Math.min(1, Math.max(0, randomValue))
    : 0.5;
  return Math.min(
    MAX_RETRY_DELAY_MS,
    Math.round(
      exponentialDelay * (MIN_JITTER_FACTOR + boundedRandom * JITTER_RANGE),
    ),
  );
}
