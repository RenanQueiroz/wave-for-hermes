import type { WaveCompatibilityResponse } from '@wave/contracts';
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

import { registerMobileAgentStateProvider } from '@/dev/mobile-agent-state';
import {
  createWaveConnectionRecord,
  toWaveConnectionSummary,
  type WaveConnectionRecord,
  type WaveConnectionSummary,
  type WaveCredentialStore,
  WaveCredentialStoreError,
} from '@/services/credentials/connection-record';
import { SecureWaveCredentialStore } from '@/services/credentials/secure-credential-store';
import { fetch as expoFetch } from 'expo/fetch';

import { signInWithPassword } from '@/services/gateway/gateway-auth';
import {
  GatewayClient,
  normalizeGatewayBaseUrl,
} from '@/services/gateway/gateway-client';
import {
  createGatewayConnectionRecord,
  type GatewayConnectionRecord,
} from '@/services/gateway/gateway-connection-record';
import { SecureGatewayConnectionStore } from '@/services/gateway/secure-gateway-store';
import { isOfflineLikeWaveError } from '@/services/query/offline-error';
import { waveQueryPersister } from '@/services/query/wave-query-cache';
import type { WaveChatClient } from '@/services/wave/wave-chat-client';
import {
  ActiveSessionStore,
  ActiveSessionStoreError,
} from '@/services/sessions/active-session-store';
import {
  WaveBackendClient,
  WaveBackendError,
} from '@/services/wave/wave-backend-client';
import { createMobileWaveBackendClient } from '@/services/wave/create-mobile-wave-backend-client';

export interface PairWaveDeviceInput {
  baseUrl: string;
  code: string;
  deviceName: string;
}

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

/**
 * Which backend the active connection speaks. The companion is being retired
 * (see `docs/roadmap.md`); both are supported until it is removed so an
 * existing paired device keeps working across the migration.
 */
export type WaveConnectionKind = 'companion' | 'gateway';

/**
 * The non-secret identity of a connection, whichever backend it uses. The
 * companion identifies a device; the gateway identifies a signed-in user.
 */
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
  | { phase: 'pairing' }
  | {
      compatibility?: WaveCompatibilityResponse;
      identity: WaveConnectionIdentity;
      phase: 'connected';
      summary?: WaveConnectionSummary;
    }
  // A saved connection whose backend is unreachable for connectivity-shaped
  // reasons only. The app degrades to reading cached data with the stored
  // client; authorization and compatibility failures never land here.
  | {
      error: ConnectionError;
      identity: WaveConnectionIdentity;
      phase: 'offline';
      summary?: WaveConnectionSummary;
    }
  | {
      error: ConnectionError;
      identity?: WaveConnectionIdentity;
      phase: 'error';
      summary?: WaveConnectionSummary;
    };

interface WaveConnectionContextValue {
  /** Conversation surfaces: whichever backend is active. */
  client?: WaveChatClient;
  /**
   * Companion-only capabilities (Realtime setup, diagnostics, scheduled jobs,
   * device revocation). Absent on a gateway connection; those screens degrade
   * rather than pretending the capability exists.
   */
  companionClient?: WaveBackendClient;
  /**
   * Speech capabilities (dictation, playback, gateway voice) live on the
   * gateway. Absent on a companion connection, where those affordances hide.
   */
  gatewayClient?: GatewayClient;
  disconnect(): Promise<boolean>;
  forget(): Promise<boolean>;
  pair(input: PairWaveDeviceInput): Promise<void>;
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
  const store = useMemo<WaveCredentialStore>(
    () => new SecureWaveCredentialStore({ allowInsecureHttp }),
    [allowInsecureHttp],
  );
  const gatewayStore = useMemo(
    () => new SecureGatewayConnectionStore({ allowInsecureHttp }),
    [allowInsecureHttp],
  );
  const activeSessionStore = useMemo(() => new ActiveSessionStore(), []);
  const [state, setState] = useState<WaveConnectionState>({
    phase: 'loading',
  });
  const [client, setClient] = useState<WaveBackendClient | undefined>();
  const [gatewayClient, setGatewayClient] = useState<
    GatewayClient | undefined
  >();
  const recordRef = useRef<WaveConnectionRecord | undefined>(undefined);
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
      setClient(undefined);
      gatewayRecordRef.current = record;
      recordRef.current = undefined;
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
            error: toConnectionError(error, 'gateway'),
            identity,
            phase: 'offline',
          });
          return;
        }
        setState({
          error: toConnectionError(error, 'gateway'),
          identity,
          phase: 'error',
        });
      }
    },
    [buildGatewayClient],
  );

  const verify = useCallback(
    async (record: WaveConnectionRecord, operation: number) => {
      const client = createMobileWaveBackendClient({
        allowInsecureHttp,
        baseUrl: record.baseUrl,
        credential: record.credential,
      });
      setClient(client);
      setGatewayClient(undefined);
      recordRef.current = record;
      gatewayRecordRef.current = undefined;
      const identity: WaveConnectionIdentity = {
        baseUrl: record.baseUrl,
        id: record.device.id,
        kind: 'companion',
        label: record.device.name,
      };
      try {
        const compatibility = await client.getCompatibility();
        if (operation !== operationRef.current) return;
        const summary = toWaveConnectionSummary(record);
        if (!compatibility.compatible) {
          setState({
            error: {
              kind: 'upstream_incompatible',
              message:
                'This Hermes server is not compatible with the current Wave Companion.',
              retryable: false,
            },
            identity,
            phase: 'error',
            summary,
          });
          return;
        }
        setState({
          compatibility,
          identity,
          phase: 'connected',
          summary,
        });
      } catch (error) {
        if (operation !== operationRef.current) return;
        const summary = toWaveConnectionSummary(record);
        if (isOfflineLikeWaveError(error)) {
          setState({
            error: toConnectionError(error),
            identity,
            phase: 'offline',
            summary,
          });
          return;
        }
        setState({
          error: toConnectionError(error),
          identity,
          phase: 'error',
          summary,
        });
      }
    },
    [allowInsecureHttp],
  );

  // Re-verifies the saved pairing without leaving the offline phase, so the
  // user keeps reading cached data while the outcome decides the next phase.
  const reverifyingRef = useRef(false);
  const reverifyOffline = useCallback(async () => {
    const gatewayRecord = gatewayRecordRef.current;
    const record = recordRef.current;
    if ((!record && !gatewayRecord) || reverifyingRef.current) return;
    reverifyingRef.current = true;
    try {
      const operation = ++operationRef.current;
      if (gatewayRecord) {
        await verifyGateway(gatewayRecord, operation);
      } else if (record) {
        await verify(record, operation);
      }
    } finally {
      reverifyingRef.current = false;
    }
  }, [verify, verifyGateway]);

  /**
   * Restore whichever connection is saved. A gateway session wins when both
   * exist: it is the newer path, and pairing is only kept for devices that
   * have not migrated yet.
   */
  const restore = useCallback(
    async (operation: number) => {
      const gatewayRecord = await gatewayStore.load().catch(() => undefined);
      if (operation !== operationRef.current) return;
      if (gatewayRecord) {
        await verifyGateway(gatewayRecord, operation);
        return;
      }
      const record = await store.load();
      if (operation !== operationRef.current) return;
      if (!record) {
        setClient(undefined);
        setGatewayClient(undefined);
        recordRef.current = undefined;
        gatewayRecordRef.current = undefined;
        setState({ phase: 'disconnected' });
        return;
      }
      await verify(record, operation);
    },
    [gatewayStore, store, verify, verifyGateway],
  );

  const initialize = useCallback(async () => {
    const operation = ++operationRef.current;
    try {
      await restore(operation);
    } catch (error) {
      if (operation !== operationRef.current) return;
      setClient(undefined);
      setGatewayClient(undefined);
      recordRef.current = undefined;
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
        setClient(undefined);
        setGatewayClient(undefined);
        recordRef.current = undefined;
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
    // Any Wave read completing over the network proves the companion is
    // reachable again, so promote (or hard-fail) the saved pairing instead of
    // leaving fresh data behind an offline banner. Manual cache writes prove
    // nothing and stay ignored.
    return queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== 'updated' || event.action.type !== 'success') return;
      if (event.action.manual) return;
      const [root] = event.query.queryKey;
      if (root !== 'wave') return;
      void reverifyOffline();
    });
  }, [queryClient, reverifyOffline, state.phase]);

  const pair = useCallback(
    async (input: PairWaveDeviceInput) => {
      const operation = ++operationRef.current;
      await queryClient.cancelQueries({ queryKey: ['wave'] });
      queryClient.removeQueries({ queryKey: ['wave'] });
      await waveQueryPersister.removeClient();
      setState({ phase: 'pairing' });
      try {
        const publicClient = createMobileWaveBackendClient({
          allowInsecureHttp,
          baseUrl: input.baseUrl,
        });
        const status = await publicClient.getStatus();
        if (!status.features.pairing || !status.features.chat) {
          throw new WaveBackendError(
            'This Wave Companion does not support mobile pairing and chat.',
            {
              kind: 'upstream_incompatible',
            },
          );
        }
        const paired = await publicClient.redeemPairing({
          code: input.code,
          deviceName: input.deviceName,
        });
        const record = createWaveConnectionRecord(
          {
            baseUrl: publicClient.baseUrl,
            credential: paired.credential,
            device: paired.device,
          },
          { allowInsecureHttp },
        );
        await activeSessionStore.clear();
        await store.save(record);
        if (operation !== operationRef.current) return;
        await verify(record, operation);
      } catch (error) {
        if (operation !== operationRef.current) return;
        setState({
          error: toConnectionError(error),
          phase: 'error',
        });
      }
    },
    [activeSessionStore, allowInsecureHttp, queryClient, store, verify],
  );

  /**
   * Sign in to a Hermes gateway directly. Replaces pairing for gateway
   * connections; the cached reads of any previous connection are purged so a
   * new identity never inherits another's conversations.
   */
  const signIn = useCallback(
    async (input: GatewaySignInInput) => {
      const operation = ++operationRef.current;
      await queryClient.cancelQueries({ queryKey: ['wave'] });
      queryClient.removeQueries({ queryKey: ['wave'] });
      await waveQueryPersister.removeClient();
      setState({ phase: 'pairing' });
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
        await store.clear().catch(() => undefined);
        await gatewayStore.save(record);
        if (operation !== operationRef.current) return;
        await verifyGateway(record, operation);
      } catch (error) {
        if (operation !== operationRef.current) return;
        setState({
          error: toConnectionError(error, 'gateway'),
          phase: 'error',
        });
      }
    },
    [
      activeSessionStore,
      allowInsecureHttp,
      gatewayStore,
      queryClient,
      store,
      verifyGateway,
    ],
  );

  const clearLocalConnection = useCallback(
    async (operation: number) => {
      await queryClient.cancelQueries({ queryKey: ['wave'] });
      queryClient.removeQueries({ queryKey: ['wave'] });
      await waveQueryPersister.removeClient();
      await activeSessionStore.clear();
      await store.clear().catch(() => undefined);
      await gatewayStore.clear().catch(() => undefined);
      if (operation !== operationRef.current) return false;
      setClient(undefined);
      setGatewayClient(undefined);
      recordRef.current = undefined;
      gatewayRecordRef.current = undefined;
      setState({ phase: 'disconnected' });
      return true;
    },
    [activeSessionStore, gatewayStore, queryClient, store],
  );

  const disconnect = useCallback(async () => {
    const operation = ++operationRef.current;
    const currentRecord = recordRef.current;
    setState({ phase: 'loading' });
    try {
      // A gateway session cannot be revoked server-side: its tokens are
      // stateless and signed, so `/auth/logout` does not invalidate them
      // (verified in the stage 1 spike). Deleting them locally is the whole
      // sign-out; the tokens expire on their own schedule.
      if (gatewayRecordRef.current) {
        return await clearLocalConnection(operation);
      }
      if (currentRecord) {
        const revocationClient = createMobileWaveBackendClient({
          allowInsecureHttp,
          baseUrl: currentRecord.baseUrl,
          credential: currentRecord.credential,
        });
        try {
          await revocationClient.revokeCurrentDevice();
        } catch (error) {
          if (
            !(error instanceof WaveBackendError) ||
            error.kind !== 'unauthorized'
          ) {
            throw error;
          }
        }
      }
      return await clearLocalConnection(operation);
    } catch (error) {
      if (operation !== operationRef.current) return false;
      setState({
        error: toConnectionError(error),
        phase: 'error',
        ...(currentRecord
          ? { summary: toWaveConnectionSummary(currentRecord) }
          : {}),
      });
      return false;
    }
  }, [allowInsecureHttp, clearLocalConnection]);

  const forget = useCallback(async () => {
    const operation = ++operationRef.current;
    const currentRecord = recordRef.current;
    setState({ phase: 'loading' });
    try {
      return await clearLocalConnection(operation);
    } catch (error) {
      if (operation !== operationRef.current) return false;
      setState({
        error: toConnectionError(error),
        phase: 'error',
        ...(currentRecord
          ? { summary: toWaveConnectionSummary(currentRecord) }
          : {}),
      });
      return false;
    }
  }, [clearLocalConnection]);

  const retry = useCallback(async () => {
    const record = recordRef.current;
    const gatewayRecord = gatewayRecordRef.current;
    if (!record && !gatewayRecord) {
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
    if (gatewayRecord) {
      await verifyGateway(gatewayRecord, operation);
    } else if (record) {
      await verify(record, operation);
    }
  }, [initialize, reverifyOffline, state.phase, verify, verifyGateway]);

  useEffect(() => {
    if (!__DEV__) return;
    return registerMobileAgentStateProvider({
      name: 'wave-connection',
      read: () => ({
        phase: state.phase,
        ...(state.phase === 'connected' ||
        state.phase === 'offline' ||
        state.phase === 'error'
          ? { kind: state.identity?.kind, summary: state.summary }
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
  }, [state]);

  const value = useMemo<WaveConnectionContextValue>(() => {
    const usable = state.phase === 'connected' || state.phase === 'offline';
    const activeClient: WaveChatClient | undefined = gatewayClient ?? client;
    return {
      ...(usable && activeClient ? { client: activeClient } : {}),
      ...(usable && client ? { companionClient: client } : {}),
      ...(usable && gatewayClient ? { gatewayClient } : {}),
      disconnect,
      forget,
      pair,
      retry,
      signIn,
      state,
    };
  }, [client, disconnect, forget, gatewayClient, pair, retry, signIn, state]);

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
 * Backend errors → user-facing connection errors. The flavor matters: the
 * companion's fixed copy translates its device-credential model ("pair
 * again"), but gateway errors are already written for the sign-in UI — a
 * gateway 401 is "wrong username or password", never a revoked pairing, so
 * rewriting it with companion copy sent users chasing the wrong problem.
 */
function toConnectionError(
  error: unknown,
  flavor: 'companion' | 'gateway' = 'companion',
): ConnectionError {
  if (
    error instanceof WaveCredentialStoreError ||
    error instanceof ActiveSessionStoreError
  ) {
    return {
      kind: 'secure_storage',
      message: error.message,
      retryable: true,
    };
  }
  if (error instanceof WaveBackendError) {
    if (flavor === 'gateway') {
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
    switch (error.kind) {
      case 'unauthorized':
        return {
          kind: error.kind,
          message:
            'This device no longer has access. Disconnect it, then pair again.',
          retryable: false,
        };
      case 'rate_limited':
        return {
          kind: error.kind,
          message: 'Too many pairing attempts. Wait a moment and try again.',
          retryable: true,
        };
      case 'upstream_incompatible':
      case 'invalid_response':
        return {
          kind: error.kind,
          message:
            'This Wave Companion is not compatible with the current app.',
          retryable: false,
        };
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
