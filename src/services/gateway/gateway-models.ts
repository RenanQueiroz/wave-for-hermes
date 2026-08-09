/**
 * Per-conversation model selection: normalization for the gateway's
 * `model.options` catalog and `config.set {key: 'model'}` switch result.
 *
 * The catalog is the allowlist — Wave never forwards a free-typed model id.
 * Provider administration fields (auth internals, key env names, API URLs)
 * are deliberately dropped at this boundary: choosing a model for one
 * conversation is a conversation feature, while provider/key management
 * stays out of Wave entirely (see AGENTS.md). Switches are always
 * session-scoped: the value builder emits `--session` and nothing else, and
 * rejects ids that could smuggle another flag.
 */

const MAX_PROVIDERS = 24;
const MAX_MODELS_PER_PROVIDER = 60;
const MAX_ID_CHARS = 120;
const MAX_NAME_CHARS = 80;
const MAX_PRICING_CHARS = 60;
const MAX_MESSAGE_CHARS = 500;

/** Catalog ids join a parsed argument string; keep them flag-proof. */
const SAFE_ID_PATTERN = /^[A-Za-z0-9][\w./:@-]*$/;

export interface WaveModelOption {
  /** Bounded "$in / $out per Mtok"-style display line, when the server sent one. */
  pricing?: string;
  fast?: boolean;
  featured: boolean;
  id: string;
  reasoning?: boolean;
  /** Present but not selectable (for example gated behind a paid tier). */
  unavailable: boolean;
}

export interface WaveModelProvider {
  current: boolean;
  models: WaveModelOption[];
  name: string;
  slug: string;
}

export interface WaveModelCatalog {
  currentModel?: string;
  currentProvider?: string;
  /** Session-scoped fast (priority) tier state, when the gateway reports it. */
  fastMode?: boolean;
  providers: WaveModelProvider[];
  /** Session-scoped reasoning effort ('none' = thinking off). */
  reasoningEffort?: string;
  /**
   * True when the answer reflects a real gateway session (resumed live).
   * A pending conversation reads profile-level state, and its chosen knobs
   * are queued locally for that conversation's eventual `session.create`.
   */
  sessionScoped?: boolean;
}

/** Hermes' active reasoning levels, in ascending order. */
export const WAVE_REASONING_EFFORTS = [
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultra',
] as const;
export const WAVE_REASONING_EFFORT_VALUES = [
  'none',
  ...WAVE_REASONING_EFFORTS,
] as const;
export type WaveReasoningLevel = (typeof WAVE_REASONING_EFFORTS)[number];
export type WaveReasoningEffort = (typeof WAVE_REASONING_EFFORT_VALUES)[number];

export interface WaveModelFamily {
  fastVariant?: WaveModelOption;
  option: WaveModelOption;
}

/** Collapse a provider's `model` / `model-fast` ids into one selectable row. */
export function modelFamilies(
  models: readonly WaveModelOption[],
): WaveModelFamily[] {
  const byId = new Map(models.map((model) => [model.id, model]));
  const families: WaveModelFamily[] = [];
  for (const option of models) {
    const baseId = option.id.replace(/-fast$/i, '');
    if (baseId !== option.id && byId.has(baseId)) continue;
    const fastVariant = byId.get(`${option.id}-fast`);
    families.push({ option, ...(fastVariant ? { fastVariant } : {}) });
  }
  return families;
}

export type WaveModelFastControl =
  | { kind: 'none' }
  | { enabled: boolean; kind: 'parameter' }
  | {
      baseModel: string;
      enabled: boolean;
      fastModel: string;
      kind: 'variant';
      provider: string;
    };

/** Resolve Hermes' speed parameter and `-fast` sibling mechanisms uniformly. */
export function resolveModelFastControl(
  catalog: WaveModelCatalog | undefined,
): WaveModelFastControl {
  if (!catalog?.currentModel) return { kind: 'none' };
  const provider = catalog.providers.find(
    (row) =>
      row.slug === catalog.currentProvider ||
      (!catalog.currentProvider && row.current),
  );
  if (!provider) return { kind: 'none' };

  const current = provider.models.find(
    (option) => option.id === catalog.currentModel,
  );
  const baseModel = catalog.currentModel.replace(/-fast$/i, '');
  const base = provider.models.find((option) => option.id === baseModel);
  const fastModel = `${baseModel}-fast`;
  const fastVariant = provider.models.find((option) => option.id === fastModel);

  if (base?.fast === true || current?.fast === true) {
    return { enabled: catalog.fastMode === true, kind: 'parameter' };
  }
  if (base && fastVariant) {
    return {
      baseModel,
      enabled: catalog.currentModel === fastModel,
      fastModel,
      kind: 'variant',
      provider: provider.slug,
    };
  }
  // If priority carried over from another model, keep an off switch reachable.
  return catalog.fastMode === true
    ? { enabled: true, kind: 'parameter' }
    : { kind: 'none' };
}

/** Bounded projection of `config.get {key:'reasoning'}`. */
export function normalizeReasoningValue(payload: unknown): string | undefined {
  const record =
    payload && typeof payload === 'object'
      ? (payload as Record<string, unknown>)
      : {};
  const value = boundedString(record.value, 24)?.toLowerCase();
  return value &&
    WAVE_REASONING_EFFORT_VALUES.includes(value as WaveReasoningEffort)
    ? value
    : undefined;
}

/** Bounded projection of `config.get`/`config.set` `{key:'fast'}`. */
export function normalizeFastValue(payload: unknown): boolean | undefined {
  const record =
    payload && typeof payload === 'object'
      ? (payload as Record<string, unknown>)
      : {};
  if (record.value === 'fast') return true;
  if (record.value === 'normal') return false;
  return undefined;
}

export type WaveSessionModelSwitch =
  | { model: string; outcome: 'applied'; warning?: string }
  | { model: string; outcome: 'deferred'; warning?: string }
  | { message: string; outcome: 'confirm-required' };

export interface WaveModelSelection {
  model: string;
  provider: string;
}

function boundedString(value: unknown, cap: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > cap) return undefined;
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return undefined;
  return trimmed;
}

function safeId(value: unknown): string | undefined {
  const bounded = boundedString(value, MAX_ID_CHARS);
  return bounded && SAFE_ID_PATTERN.test(bounded) ? bounded : undefined;
}

/** Format the server's per-model pricing rows into one bounded line. */
function pricingLine(value: unknown): string | undefined {
  if (typeof value === 'string') return boundedString(value, MAX_PRICING_CHARS);
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const input = record.input ?? record.prompt;
  const output = record.output ?? record.completion;
  if (typeof input === 'number' && typeof output === 'number') {
    return `$${input} in / $${output} out per Mtok`;
  }
  return undefined;
}

export function normalizeModelCatalog(payload: unknown): WaveModelCatalog {
  const record =
    payload && typeof payload === 'object'
      ? (payload as Record<string, unknown>)
      : {};
  const currentModel = safeId(record.model);
  const currentProvider = safeId(record.provider);
  const rows = Array.isArray(record.providers) ? record.providers : [];

  const providers: WaveModelProvider[] = [];
  for (const row of rows) {
    if (providers.length >= MAX_PROVIDERS) break;
    if (!row || typeof row !== 'object') continue;
    const provider = row as Record<string, unknown>;
    const slug = safeId(provider.slug);
    if (!slug) continue;
    // Rows the user cannot run models on are provider onboarding surface,
    // which Wave deliberately does not offer.
    if (provider.authenticated === false) continue;

    const featured = new Set(
      Array.isArray(provider.featured_models)
        ? provider.featured_models.flatMap((id) => safeId(id) ?? [])
        : [],
    );
    const unavailable = new Set(
      Array.isArray(provider.unavailable_models)
        ? provider.unavailable_models.flatMap((id) => safeId(id) ?? [])
        : [],
    );
    const pricing =
      provider.pricing && typeof provider.pricing === 'object'
        ? (provider.pricing as Record<string, unknown>)
        : {};
    const capabilities =
      provider.capabilities && typeof provider.capabilities === 'object'
        ? (provider.capabilities as Record<string, unknown>)
        : {};

    const models: WaveModelOption[] = [];
    const modelIds = Array.isArray(provider.models) ? provider.models : [];
    for (const rawId of modelIds) {
      if (models.length >= MAX_MODELS_PER_PROVIDER) break;
      const id = safeId(rawId);
      if (!id) continue;
      const capability =
        capabilities[id] && typeof capabilities[id] === 'object'
          ? (capabilities[id] as Record<string, unknown>)
          : undefined;
      const price = pricingLine(pricing[id]);
      models.push({
        featured: featured.has(id),
        id,
        unavailable: unavailable.has(id),
        ...(price ? { pricing: price } : {}),
        ...(capability && typeof capability.fast === 'boolean'
          ? { fast: capability.fast }
          : {}),
        ...(capability && typeof capability.reasoning === 'boolean'
          ? { reasoning: capability.reasoning }
          : {}),
      });
    }
    if (models.length === 0) continue;

    providers.push({
      current: provider.is_current === true || slug === currentProvider,
      models,
      name: boundedString(provider.name, MAX_NAME_CHARS) ?? slug,
      slug,
    });
  }

  return {
    ...(currentModel ? { currentModel } : {}),
    ...(currentProvider ? { currentProvider } : {}),
    providers,
  };
}

/**
 * The `config.set` value. Only catalog-validated ids may reach this; the
 * pattern check makes flag smuggling (`--global`, `--once`) structurally
 * impossible, and `--session` keeps every switch scoped to this conversation.
 */
export function buildModelSwitchValue(selection: WaveModelSelection): string {
  if (
    !SAFE_ID_PATTERN.test(selection.model) ||
    selection.model.length > MAX_ID_CHARS
  ) {
    throw new Error('Choose a model from the list.');
  }
  if (
    !SAFE_ID_PATTERN.test(selection.provider) ||
    selection.provider.length > MAX_ID_CHARS
  ) {
    throw new Error('Choose a model from the list.');
  }
  return `${selection.model} --provider ${selection.provider} --session`;
}

export function normalizeModelSwitch(
  payload: unknown,
  selection: WaveModelSelection,
): WaveSessionModelSwitch {
  const record =
    payload && typeof payload === 'object'
      ? (payload as Record<string, unknown>)
      : {};
  if (record.confirm_required === true) {
    return {
      message:
        boundedString(record.confirm_message, MAX_MESSAGE_CHARS) ??
        boundedString(record.warning, MAX_MESSAGE_CHARS) ??
        'This model may be expensive. Switch anyway?',
      outcome: 'confirm-required',
    };
  }
  const model = safeId(record.value) ?? selection.model;
  const warning = boundedString(record.warning, MAX_MESSAGE_CHARS);
  return {
    model,
    outcome: record.deferred === true ? 'deferred' : 'applied',
    ...(warning ? { warning } : {}),
  };
}
