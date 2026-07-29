import { HermesClientError } from './hermes-errors.ts';
import type {
  HermesCapabilities,
  HermesCapabilityReport,
  HermesEndpointCapability,
  HermesFeatureValue,
} from './hermes-types.ts';

export const REQUIRED_HERMES_FEATURES = [
  'run_stop',
  'session_chat',
  'session_chat_streaming',
  'session_resources',
  'tool_progress_events',
] as const;

export const REQUIRED_HERMES_ENDPOINTS = [
  'run_stop',
  'session_chat_stream',
  'session_create',
  'session_messages',
  'sessions',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseEndpoints(value: unknown) {
  if (!isRecord(value)) {
    throw new HermesClientError('Hermes returned invalid endpoint capabilities.', {
      code: 'invalid_capabilities',
      kind: 'protocol',
    });
  }

  const endpoints: Record<string, HermesEndpointCapability> = {};
  for (const [name, endpoint] of Object.entries(value)) {
    if (
      isRecord(endpoint) &&
      typeof endpoint.method === 'string' &&
      typeof endpoint.path === 'string'
    ) {
      endpoints[name] = {
        method: endpoint.method.toUpperCase(),
        path: endpoint.path,
      };
    }
  }
  return endpoints;
}

function parseFeatures(value: unknown) {
  if (!isRecord(value)) {
    throw new HermesClientError('Hermes returned invalid feature capabilities.', {
      code: 'invalid_capabilities',
      kind: 'protocol',
    });
  }

  const features: Record<string, HermesFeatureValue> = {};
  for (const [name, feature] of Object.entries(value)) {
    if (
      feature === null ||
      typeof feature === 'boolean' ||
      typeof feature === 'number' ||
      typeof feature === 'string'
    ) {
      features[name] = feature;
    }
  }
  return features;
}

export function parseHermesCapabilities(value: unknown): HermesCapabilities {
  if (
    !isRecord(value) ||
    value.object !== 'hermes.api_server.capabilities' ||
    value.platform !== 'hermes-agent' ||
    typeof value.model !== 'string' ||
    !isRecord(value.auth) ||
    typeof value.auth.type !== 'string' ||
    typeof value.auth.required !== 'boolean'
  ) {
    throw new HermesClientError('Hermes returned an invalid capability response.', {
      code: 'invalid_capabilities',
      kind: 'protocol',
    });
  }

  return {
    auth: {
      required: value.auth.required,
      type: value.auth.type,
    },
    endpoints: parseEndpoints(value.endpoints),
    features: parseFeatures(value.features),
    model: value.model,
    object: value.object,
    platform: value.platform,
  };
}

export function reportHermesCapabilities(
  capabilities: HermesCapabilities,
): HermesCapabilityReport {
  const missingFeatures: string[] = REQUIRED_HERMES_FEATURES.filter(
    (feature) => capabilities.features[feature] !== true,
  );
  const missingEndpoints: string[] = REQUIRED_HERMES_ENDPOINTS.filter(
    (endpoint) => capabilities.endpoints[endpoint] === undefined,
  );

  if (capabilities.auth.type !== 'bearer' || capabilities.auth.required !== true) {
    missingFeatures.push('bearer_authentication');
  }

  return {
    capabilities,
    missingEndpoints,
    missingFeatures,
    supported: missingEndpoints.length === 0 && missingFeatures.length === 0,
  };
}
