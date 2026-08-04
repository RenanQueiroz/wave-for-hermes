import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import { AppState } from 'react-native';
import { fetch as expoFetch } from 'expo/fetch';

import { registerMobileAgentStateProvider } from '@/dev/mobile-agent-state';
import { signInWithPassword } from '@/services/gateway/gateway-auth';
import {
  GatewayClient,
  normalizeGatewayBaseUrl,
  type GatewayCompatibilityBaseline,
} from '@/services/gateway/gateway-client';
import {
  createGatewayConnectionRecord,
  type GatewayConnectionRecord,
} from '@/services/gateway/gateway-connection-record';
import { SecureGatewayConnectionStore } from '@/services/gateway/secure-gateway-store';
import { isOfflineLikeWaveError } from '@/services/query/offline-error';
import { waveQueryPersister } from '@/services/query/wave-query-cache';
import {
  ActiveSessionStore,
  ActiveSessionStoreError,
} from '@/services/sessions/active-session-store';
import { WaveBackendError } from '@/services/wave/wave-backend-error';
import type { WaveChatClient } from '@/services/wave/wave-chat-client';

export interface GatewaySignInInput {
  baseUrl: string;
  password: string;
  provider: string;
  username: string;
}

interface ConnectionError {
  kind: string;
  message: string;
  retryable: boolean;
}

/** The gateway is Wave's only production backend. */
export type WaveConnectionKind = 'gateway';

/** The non-secret identity of the signed-in gateway connection. */
export interface WaveConnectionIdentity {
  /** Stable key for connection-scoped caches and stores. */
  id: string;
  baseUrl: string;
  kind: WaveConnectionKind;
  label: string;
}

export type WaveConnectionState =
  | { phase: 'loading' }
  | { phase: 'disconnected' }
  | { phase: 'signing-in' }
  | {
      identity: WaveConnectionIdentity;
      phase: 'connected';
    }
  // A saved connection whose gateway is unreachable for connectivity-shaped
  // reasons only. The app degrades to reading cached data with the stored
  // client; authorization failures never land here.
  | {
      error: ConnectionError;
      identity: WaveConnectionIdentity;
      phase: 'offline';
    }
  | {
      error: ConnectionError;
      identity?: WaveConnectionIdentity;
      phase: 'error';
    };

interface WaveConnectionContextValue {
  /** Conversation surfaces consume the backend-neutral chat client. */
  client?: WaveChatClient;
  /** Gateway-specific capabilities (speech, prompts, Realtime execution). */
  gatewayClient?: GatewayClient;
  disconnect(): Promise<boolean>;
  forget(): Promise<boolean>;
  retry(): Promise<void>;
  signIn(input: GatewaySignInInput): Promise<void>;
  state: WaveConnectionState;
}

const WaveConnectionContext = createContext<WaveConnectionContextValue | null>(
  null,
);

export function WaveConnectionProvider({ children }: PropsWithChildren) {
  const queryClient = useQueryClient();
  const allowInsecureHttp = __DEV__;
  const gatewayStore = useMemo(
    () => new SecureGatewayConnectionStore({ allowInsecureHttp }),
    [allowInsecureHttp],
  );
  const activeSessionStore = useMemo(() => new ActiveSessionStore(), []);
  const [state, setState] = useState<WaveConnectionState>({
    phase: 'loading',
  });
  const [gatewayClient, setGatewayClient] = useState<
    GatewayClient | undefined
  >();
  const [compatibilityDiagnostic, setCompatibilityDiagnostic] = useState<{
    baseline: GatewayCompatibilityBaseline;
    client: GatewayClient;
  }>();
  const gatewayRecordRef = useRef<GatewayConnectionRecord | undefined>(
    undefined,
  );
  const operationRef = useRef(0);

  const buildGatewayClient = useCallback(
    (record: GatewayConnectionRecord) =>
      new GatewayClient({
        allowInsecureHttp,
        baseUrl: record.baseUrl,
        // The gateway rotates tokens on refresh; persist every rotation or
        // the stored pair ages out and silently signs the user out.
        onTokensRotated: (tokens) => {
          const next = { ...record, tokens };
          gatewayRecordRef.current = next;
          void gatewayStore.save(next).catch(() => undefined);
        },
        tokens: record.tokens,
      }),
    [allowInsecureHttp, gatewayStore],
  );

  const verifyGateway = useCallback(
    async (record: GatewayConnectionRecord, operation: number) => {
      const nextClient = buildGatewayClient(record);
      setGatewayClient(nextClient);
      gatewayRecordRef.current = record;
      const identity: WaveConnectionIdentity = {
        baseUrl: record.baseUrl,
        id: `gateway:${record.userId || record.provider}`,
        kind: 'gateway',
        label: record.userId || record.provider,
      };
      try {
        await nextClient.getIdentity();
        if (operation !== operationRef.current) return;
        setState({ identity, phase: 'connected' });
      } catch (error) {
        if (operation !== operationRef.current) return;
        if (isOfflineLikeWaveError(error)) {
          setState({
            error: toConnectionError(error),
            identity,
            phase: 'offline',
          });
          return;
        }
        setState({
          error: toConnectionError(error),
          identity,
          phase: 'error',
        });
      }
    },
    [buildGatewayClient],
  );

  // Re-verifies the saved connection without leaving the offline phase, so
  // the user keeps reading cached data while the outcome decides the phase.
  const reverifyingRef = useRef(false);
  const reverifyOffline = useCallback(async () => {
    const gatewayRecord = gatewayRecordRef.current;
    if (!gatewayRecord || reverifyingRef.current) return;
    reverifyingRef.current = true;
    try {
      const operation = ++operationRef.current;
      await verifyGateway(gatewayRecord, operation);
    } finally {
      reverifyingRef.current = false;
    }
  }, [verifyGateway]);

  const restore = useCallback(
    async (operation: number) => {
      const gatewayRecord = await gatewayStore.load().catch(() => undefined);
      if (operation !== operationRef.current) return;
      if (gatewayRecord) {
        await verifyGateway(gatewayRecord, operation);
        return;
      }
      setGatewayClient(undefined);
      gatewayRecordRef.current = undefined;
      setState({ phase: 'disconnected' });
    },
    [gatewayStore, verifyGateway],
  );

  const initialize = useCallback(async () => {
    const operation = ++operationRef.current;
    try {
      await restore(operation);
    } catch (error) {
      if (operation !== operationRef.current) return;
      setGatewayClient(undefined);
      gatewayRecordRef.current = undefined;
      setState({
        error: toConnectionError(error),
        phase: 'error',
      });
    }
  }, [restore]);

  useEffect(() => {
    const operation = ++operationRef.current;

    void restore(operation).then(
      () => undefined,
      (error: unknown) => {
        if (operation !== operationRef.current) return;
        setGatewayClient(undefined);
        gatewayRecordRef.current = undefined;
        setState({
          error: toConnectionError(error),
          phase: 'error',
        });
      },
    );

    return () => {
      if (operation === operationRef.current) {
        operationRef.current += 1;
      }
    };
  }, [restore]);

  useEffect(() => {
    if (state.phase !== 'offline') return;
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') void reverifyOffline();
    });
    return () => subscription.remove();
  }, [reverifyOffline, state.phase]);

  useEffect(() => {
    if (state.phase !== 'offline') return;
    // Any Wave read completing over the network proves the gateway is
    // reachable again, so promote (or hard-fail) the saved connection instead
    // of leaving fresh data behind an offline banner. Manual cache writes
    // prove nothing and stay ignored.
    return queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== 'updated' || event.action.type !== 'success') return;
      if (event.action.manual) return;
      const [root] = event.query.queryKey;
      if (root !== 'wave') return;
      void reverifyOffline();
    });
  }, [queryClient, reverifyOffline, state.phase]);

  useEffect(() => {
    if (!__DEV__) return;
    if (state.phase !== 'connected' || !gatewayClient) return;
    let cancelled = false;
    void gatewayClient.getCompatibilityBaseline().then(
      (baseline) => {
        if (!cancelled) {
          setCompatibilityDiagnostic({ baseline, client: gatewayClient });
        }
      },
      () => {
        if (!cancelled) {
          setCompatibilityDiagnostic({ baseline: {}, client: gatewayClient });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [gatewayClient, state.phase]);

  const compatibilityVersion =
    state.phase === 'connected' &&
    compatibilityDiagnostic &&
    compatibilityDiagnostic.client === gatewayClient
      ? compatibilityDiagnostic.baseline.version
      : undefined;

  /**
   * Sign in to a Hermes gateway. The cached reads of any previous connection
   * are purged so a new identity never inherits another's conversations.
   */
  const signIn = useCallback(
    async (input: GatewaySignInInput) => {
      const operation = ++operationRef.current;
      await queryClient.cancelQueries({ queryKey: ['wave'] });
      queryClient.removeQueries({ queryKey: ['wave'] });
      await waveQueryPersister.removeClient();
      setState({ phase: 'signing-in' });
      try {
        const baseUrl = normalizeGatewayBaseUrl(input.baseUrl, {
          allowInsecureHttp,
        });
        const tokens = await signInWithPassword(
          {
            baseUrl,
            password: input.password,
            provider: input.provider,
            username: input.username,
          },
          expoFetch as unknown as typeof globalThis.fetch,
        );
        const record = createGatewayConnectionRecord(
          {
            baseUrl,
            provider: tokens.provider,
            tokens,
            userId: input.username,
          },
          { allowInsecureHttp },
        );
        await activeSessionStore.clear();
        await gatewayStore.save(record);
        if (operation !== operationRef.current) return;
        await verifyGateway(record, operation);
      } catch (error) {
        if (operation !== operationRef.current) return;
        setState({
          error: toConnectionError(error),
          phase: 'error',
        });
      }
    },
    [
      activeSessionStore,
      allowInsecureHttp,
      gatewayStore,
      queryClient,
      verifyGateway,
    ],
  );

  const clearLocalConnection = useCallback(
    async (operation: number) => {
      await queryClient.cancelQueries({ queryKey: ['wave'] });
      queryClient.removeQueries({ queryKey: ['wave'] });
      await waveQueryPersister.removeClient();
      await activeSessionStore.clear();
      await gatewayStore.clear().catch(() => undefined);
      if (operation !== operationRef.current) return false;
      setGatewayClient(undefined);
      gatewayRecordRef.current = undefined;
      setState({ phase: 'disconnected' });
      return true;
    },
    [activeSessionStore, gatewayStore, queryClient],
  );

  // A gateway session cannot be revoked server-side: its tokens are stateless
  // and signed, so `/auth/logout` does not invalidate them. Deleting them
  // locally is the whole sign-out; the tokens expire on their own schedule.
  const disconnect = useCallback(async () => {
    const operation = ++operationRef.current;
    setState({ phase: 'loading' });
    try {
      return await clearLocalConnection(operation);
    } catch (error) {
      if (operation !== operationRef.current) return false;
      setState({
        error: toConnectionError(error),
        phase: 'error',
      });
      return false;
    }
  }, [clearLocalConnection]);

  const forget = disconnect;

  const retry = useCallback(async () => {
    const gatewayRecord = gatewayRecordRef.current;
    if (!gatewayRecord) {
      setState({ phase: 'loading' });
      await initialize();
      return;
    }
    if (state.phase === 'offline') {
      // Keep the cached-reading UI mounted while the retry decides.
      await reverifyOffline();
      return;
    }
    const operation = ++operationRef.current;
    setState({ phase: 'loading' });
    await verifyGateway(gatewayRecord, operation);
  }, [initialize, reverifyOffline, state.phase, verifyGateway]);

  useEffect(() => {
    if (!__DEV__) return;
    return registerMobileAgentStateProvider({
      name: 'wave-connection',
      read: () => ({
        phase: state.phase,
        ...(compatibilityVersion
          ? { gatewayVersion: compatibilityVersion }
          : {}),
        ...(state.phase === 'connected' ||
        state.phase === 'offline' ||
        state.phase === 'error'
          ? { kind: state.identity?.kind }
          : {}),
        ...(state.phase === 'offline' || state.phase === 'error'
          ? {
              error: {
                kind: state.error.kind,
                retryable: state.error.retryable,
              },
            }
          : {}),
      }),
    });
  }, [compatibilityVersion, state]);

  const value = useMemo<WaveConnectionContextValue>(() => {
    const usable = state.phase === 'connected' || state.phase === 'offline';
    return {
      ...(usable && gatewayClient ? { client: gatewayClient } : {}),
      ...(usable && gatewayClient ? { gatewayClient } : {}),
      disconnect,
      forget,
      retry,
      signIn,
      state,
    };
  }, [disconnect, forget, gatewayClient, retry, signIn, state]);

  return (
    <WaveConnectionContext.Provider value={value}>
      {children}
    </WaveConnectionContext.Provider>
  );
}

export function useWaveConnection() {
  const context = use(WaveConnectionContext);
  if (!context) {
    throw new Error(
      'useWaveConnection must be used inside WaveConnectionProvider.',
    );
  }
  return context;
}

/**
 * Backend errors → user-facing connection errors. Gateway errors are written
 * for the sign-in UI, so their own messages surface; kinds only adjust
 * retryability.
 */
function toConnectionError(error: unknown): ConnectionError {
  if (error instanceof ActiveSessionStoreError) {
    return {
      kind: 'secure_storage',
      message: error.message,
      retryable: true,
    };
  }
  if (error instanceof WaveBackendError) {
    switch (error.kind) {
      case 'unauthorized':
      case 'upstream_incompatible':
      case 'invalid_response':
        return { kind: error.kind, message: error.message, retryable: false };
      case 'rate_limited':
        return { kind: error.kind, message: error.message, retryable: true };
      default:
        return {
          kind: error.kind,
          message: error.message,
          retryable: error.retryable,
        };
    }
  }
  return {
    kind: 'unknown',
    message: 'Wave could not complete the connection.',
    retryable: true,
  };
}
