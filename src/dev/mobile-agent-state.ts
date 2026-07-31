export interface MobileAgentStateProvider {
  name: string;
  read: () => unknown;
}

interface MobileAgentStateBridge {
  version: 1;
  list: () => string[];
  read: (name: string) => unknown;
}

declare global {
  // This property is installed only in development bundles.
  var __WAVE_MOBILE_AGENT_STATE__: MobileAgentStateBridge | undefined;
}

const providers = new Map<string, MobileAgentStateProvider>();
const validProviderName = /^[a-z0-9][a-z0-9._-]{0,63}$/;

if (__DEV__) {
  const bridge: MobileAgentStateBridge = {
    version: 1,
    list: () => [...providers.keys()].sort(),
    read: (name) => {
      const provider = providers.get(name);
      if (!provider) {
        throw new Error(
          `Mobile-agent state provider "${name}" is not registered.`,
        );
      }
      const serialized = JSON.stringify(provider.read());
      if (serialized === undefined) {
        throw new Error(
          `Mobile-agent state provider "${name}" returned a non-serializable value.`,
        );
      }
      return JSON.parse(serialized) as unknown;
    },
  };

  Object.defineProperty(globalThis, '__WAVE_MOBILE_AGENT_STATE__', {
    configurable: true,
    enumerable: false,
    value: bridge,
  });
}

export function registerMobileAgentStateProvider(
  provider: MobileAgentStateProvider,
): () => void {
  if (!__DEV__) return () => undefined;
  if (!validProviderName.test(provider.name)) {
    throw new Error(
      `Invalid mobile-agent state provider name "${provider.name}". Use 1-64 lowercase letters, numbers, dots, underscores, or hyphens.`,
    );
  }
  providers.set(provider.name, provider);
  return () => {
    if (providers.get(provider.name) === provider) {
      providers.delete(provider.name);
    }
  };
}
