/**
 * Wave's Android self-update feed is the GitHub Releases API for this
 * repository. Release payloads are untrusted external data even though CI
 * authors them: parsing is strict and bounded, download URLs must carry the
 * pinned repository prefix, and release notes cross only as truncated inert
 * plain text. The authenticity gate for the update itself stays with
 * Android, which refuses to install any package whose signing certificate
 * differs from the installed app's.
 */

export const WAVE_RELEASES_LATEST_URL =
  'https://api.github.com/repos/RenanQueiroz/wave-for-hermes/releases/latest';
export const WAVE_RELEASE_DOWNLOAD_PREFIX =
  'https://github.com/RenanQueiroz/wave-for-hermes/releases/download/';

/** Matches the CI release tag shape: v<versionName>-<versionCode>. */
const RELEASE_TAG_PATTERN = /^v(\d+\.\d+\.\d+)-([1-9]\d{0,9})$/;

const MAX_VERSION_CODE = 2_100_000_000;
const MAX_ASSETS_SCANNED = 30;
const MAX_APK_BYTES = 300 * 1024 * 1024;
const MAX_NOTES_CHARS = 4_000;

export const UPDATE_FEED_ERROR_COPY =
  'The latest release did not look like a Wave update.';

export interface WaveAppUpdate {
  apkSizeBytes: number;
  apkUrl: string;
  /** Bounded inert plain text; never rendered as markdown. */
  notes: string;
  md5Url?: string;
  versionCode: number;
  versionName: string;
}

export type WaveUpdateCheckOutcome =
  { kind: 'up-to-date' } | { kind: 'update'; update: WaveAppUpdate };

/**
 * Interprets a `releases/latest` payload against the installed versionCode.
 * Throws with user-safe copy on anything malformed; never partially trusts
 * a release.
 */
export function parseLatestReleasePayload(
  payload: unknown,
  installedVersionCode: number,
): WaveUpdateCheckOutcome {
  if (!Number.isSafeInteger(installedVersionCode) || installedVersionCode < 1) {
    throw new Error(UPDATE_FEED_ERROR_COPY);
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error(UPDATE_FEED_ERROR_COPY);
  }
  const release = payload as Record<string, unknown>;
  // releases/latest never returns drafts or prereleases; seeing one means
  // the response is not what Wave asked for.
  if (release.draft === true || release.prerelease === true) {
    throw new Error(UPDATE_FEED_ERROR_COPY);
  }

  const tagMatch =
    typeof release.tag_name === 'string'
      ? RELEASE_TAG_PATTERN.exec(release.tag_name)
      : null;
  if (!tagMatch) throw new Error(UPDATE_FEED_ERROR_COPY);
  const versionName = tagMatch[1];
  const versionCode = Number(tagMatch[2]);
  if (!Number.isSafeInteger(versionCode) || versionCode > MAX_VERSION_CODE) {
    throw new Error(UPDATE_FEED_ERROR_COPY);
  }

  if (versionCode <= installedVersionCode) return { kind: 'up-to-date' };

  const apkName = `wave-${versionName}.apk`;
  const assets = Array.isArray(release.assets)
    ? release.assets.slice(0, MAX_ASSETS_SCANNED)
    : [];
  const apk = findAsset(assets, apkName);
  if (!apk) throw new Error(UPDATE_FEED_ERROR_COPY);
  if (
    !Number.isSafeInteger(apk.size) ||
    apk.size < 1 ||
    apk.size > MAX_APK_BYTES
  ) {
    throw new Error(UPDATE_FEED_ERROR_COPY);
  }
  const md5 = findAsset(assets, `${apkName}.md5`);

  return {
    kind: 'update',
    update: {
      apkSizeBytes: apk.size,
      apkUrl: apk.url,
      notes: sanitizeNotes(release.body),
      ...(md5 ? { md5Url: md5.url } : {}),
      versionCode,
      versionName,
    },
  };
}

function findAsset(
  assets: unknown[],
  name: string,
): { size: number; url: string } | undefined {
  for (const entry of assets) {
    if (!entry || typeof entry !== 'object') continue;
    const asset = entry as Record<string, unknown>;
    if (asset.name !== name) continue;
    const url = asset.browser_download_url;
    if (
      typeof url !== 'string' ||
      !url.startsWith(WAVE_RELEASE_DOWNLOAD_PREFIX)
    ) {
      // A right-named asset pointing somewhere else is hostile, not usable.
      return undefined;
    }
    return {
      size: typeof asset.size === 'number' ? asset.size : Number.NaN,
      url,
    };
  }
  return undefined;
}

function sanitizeNotes(body: unknown): string {
  if (typeof body !== 'string' || body.length === 0) return '';
  let notes = body.replace(/\r\n?/g, '\n');
  // Strip control characters except newline and tab.
  notes = notes.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '');
  notes = notes.trim();
  if (notes.length > MAX_NOTES_CHARS) {
    notes = `${notes.slice(0, MAX_NOTES_CHARS)}…`;
  }
  return notes;
}
