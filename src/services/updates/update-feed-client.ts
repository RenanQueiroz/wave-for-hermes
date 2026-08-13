/**
 * Network wrapper for the update feed. One bounded, unauthenticated request
 * to the pinned GitHub endpoint per check: no retries, no tokens, nothing
 * logged. Everything received is handed to the strict parser.
 */

import { fetch as expoFetch } from 'expo/fetch';

import {
  parseLatestReleasePayload,
  UPDATE_FEED_ERROR_COPY,
  WAVE_RELEASES_LATEST_URL,
  type WaveUpdateCheckOutcome,
} from '@/services/updates/github-release-feed';

export const UPDATE_CHECK_UNAVAILABLE_COPY =
  'Wave could not check for updates. Try again later.';

const FEED_TIMEOUT_MS = 15_000;
const MAX_FEED_CHARS = 1_000_000;

export async function fetchLatestUpdateOutcome(
  installedVersionCode: number,
): Promise<WaveUpdateCheckOutcome> {
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), FEED_TIMEOUT_MS);
  let text: string;
  try {
    const response = await expoFetch(WAVE_RELEASES_LATEST_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: abort.signal,
    });
    if (!response.ok) throw new Error(UPDATE_CHECK_UNAVAILABLE_COPY);
    text = await response.text();
  } catch {
    throw new Error(UPDATE_CHECK_UNAVAILABLE_COPY);
  } finally {
    clearTimeout(timeout);
  }

  if (text.length > MAX_FEED_CHARS) throw new Error(UPDATE_FEED_ERROR_COPY);
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(UPDATE_FEED_ERROR_COPY);
  }
  return parseLatestReleasePayload(payload, installedVersionCode);
}
