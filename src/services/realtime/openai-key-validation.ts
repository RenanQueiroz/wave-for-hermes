/**
 * Cheap validation for a user-supplied OpenAI key: one authenticated list
 * call, no SDK (AGENTS.md keeps the OpenAI SDK out of the app). The
 * outcome never contains key material.
 */

const OPENAI_MODELS_URL = 'https://api.openai.com/v1/models';
const VALIDATION_TIMEOUT_MS = 15_000;

export type OpenAiKeyCheck = 'invalid' | 'unreachable' | 'valid';

export async function checkOpenAiKey(
  key: string,
  fetchImpl: typeof globalThis.fetch,
  signal?: AbortSignal,
): Promise<OpenAiKeyCheck> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VALIDATION_TIMEOUT_MS);
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const response = await fetchImpl(OPENAI_MODELS_URL, {
      headers: { Authorization: `Bearer ${key}` },
      signal: controller.signal,
    });
    if (response.ok) return 'valid';
    if (response.status === 401 || response.status === 403) return 'invalid';
    return 'unreachable';
  } catch {
    return 'unreachable';
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}
