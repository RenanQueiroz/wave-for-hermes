/**
 * Wave-authored headings for a failed turn.
 *
 * Hermes v0.21 reports which part of the stack failed as a structured
 * `{layer, code, retryable}` descriptor on the terminal error frame. The
 * layer only ever selects a heading here — it never drives a retry, and the
 * gateway's own message is shown as the description beneath it, unchanged.
 *
 * The copy stays in Wave's single-assistant voice: it names the model
 * provider (a third party the user may need to act on) or Hermes (the agent),
 * and never asks the user to reason about Wave and Hermes as two products.
 * An absent or unrecognised layer falls back to the generic heading, which is
 * what every pre-v0.21 gateway produces.
 */
import type { WaveErrorLayer } from '@wave/contracts';

const GENERIC_TURN_ERROR_TITLE = 'Turn interrupted';

const TURN_ERROR_TITLES: Record<WaveErrorLayer, string> = {
  auth: 'The model provider rejected its credentials',
  billing: 'The model provider reported a billing limit',
  disk: 'Hermes ran out of disk space',
  endpoint: 'That model endpoint could not be reached',
  gateway: 'Hermes hit an internal error',
  provider: 'The model provider failed',
  runtime: 'Hermes could not start the agent',
  streaming: 'The model connection dropped mid-reply',
};

export function turnErrorTitle(layer?: WaveErrorLayer): string {
  return layer ? TURN_ERROR_TITLES[layer] : GENERIC_TURN_ERROR_TITLE;
}
