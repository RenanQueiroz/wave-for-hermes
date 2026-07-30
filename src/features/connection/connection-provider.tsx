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

interface ConnectionError {
  kind: string;
  message: string;
  retryable: boolean;
}

export type WaveConnectionState =
  | { phase: 'loading' }
  | { phase: 'disconnected' }
  | { phase: 'pairing' }
  | {
      compatibility: WaveCompatibilityResponse;
      phase: 'connected';
      summary: WaveConnectionSummary;
    }
  | {
      error: ConnectionError;
      phase: 'error';
      summary?: WaveConnectionSummary;
    };

interface WaveConnectionContextValue {
  client?: WaveBackendClient;
  disconnect(): Promise<void>;
  pair(input: PairWaveDeviceInput): Promise<void>;
  retry(): Promise<void>;
  state: WaveConnectionState;
}

const WaveConnectionContext =
  createContext<WaveConnectionContextValue | null>(null);

export function WaveConnectionProvider({ children }: PropsWithChildren) {
  const queryClient = useQueryClient();
  const allowInsecureHttp = __DEV__;
  const store = useMemo<WaveCredentialStore>(
    () => new SecureWaveCredentialStore({ allowInsecureHttp }),
    [allowInsecureHttp],
  );
  const activeSessionStore = useMemo(() => new ActiveSessionStore(), []);
  const [state, setState] = useState<WaveConnectionState>({
    phase: 'loading',
  });
  const [client, setClient] = useState<WaveBackendClient | undefined>();
  const recordRef = useRef<WaveConnectionRecord | undefined>(undefined);
  const operationRef = useRef(0);

  const verify = useCallback(
    async (record: WaveConnectionRecord, operation: number) => {
      const client = createMobileWaveBackendClient({
        allowInsecureHttp,
        baseUrl: record.baseUrl,
        credential: record.credential,
      });
      setClient(client);
      recordRef.current = record;
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
            phase: 'error',
            summary,
          });
          return;
        }
        setState({
          compatibility,
          phase: 'connected',
          summary,
        });
      } catch (error) {
        if (operation !== operationRef.current) return;
        setState({
          error: toConnectionError(error),
          phase: 'error',
          summary: toWaveConnectionSummary(record),
        });
      }
    },
    [allowInsecureHttp],
  );

  const initialize = useCallback(async () => {
    const operation = ++operationRef.current;
    try {
      const record = await store.load();
      if (operation !== operationRef.current) return;
      if (!record) {
        setClient(undefined);
        recordRef.current = undefined;
        setState({ phase: 'disconnected' });
        return;
      }
      await verify(record, operation);
    } catch (error) {
      if (operation !== operationRef.current) return;
      setClient(undefined);
      recordRef.current = undefined;
      setState({
        error: toConnectionError(error),
        phase: 'error',
      });
    }
  }, [store, verify]);

  useEffect(() => {
    const operation = ++operationRef.current;

    void store.load().then(
      (record) => {
        if (operation !== operationRef.current) return;
        if (!record) {
          setClient(undefined);
          recordRef.current = undefined;
          setState({ phase: 'disconnected' });
          return;
        }
        void verify(record, operation);
      },
      (error: unknown) => {
        if (operation !== operationRef.current) return;
        setClient(undefined);
        recordRef.current = undefined;
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
  }, [store, verify]);

  const pair = useCallback(
    async (input: PairWaveDeviceInput) => {
      const operation = ++operationRef.current;
      await queryClient.cancelQueries({ queryKey: ['wave'] });
      queryClient.removeQueries({ queryKey: ['wave'] });
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

  const disconnect = useCallback(async () => {
    const operation = ++operationRef.current;
    const currentRecord = recordRef.current;
    setState({ phase: 'loading' });
    try {
      await queryClient.cancelQueries({ queryKey: ['wave'] });
      queryClient.removeQueries({ queryKey: ['wave'] });
      await activeSessionStore.clear();
      await store.clear();
      if (operation !== operationRef.current) return;
      setClient(undefined);
      recordRef.current = undefined;
      setState({ phase: 'disconnected' });
    } catch (error) {
      if (operation !== operationRef.current) return;
      setState({
        error: toConnectionError(error),
        phase: 'error',
        ...(currentRecord
          ? { summary: toWaveConnectionSummary(currentRecord) }
          : {}),
      });
    }
  }, [activeSessionStore, queryClient, store]);

  const retry = useCallback(async () => {
    const record = recordRef.current;
    if (!record) {
      setState({ phase: 'loading' });
      await initialize();
      return;
    }
    const operation = ++operationRef.current;
    setState({ phase: 'loading' });
    await verify(record, operation);
  }, [initialize, verify]);

  useEffect(() => {
    if (!__DEV__) return;
    return registerMobileAgentStateProvider({
      name: 'wave-connection',
      read: () => ({
        phase: state.phase,
        ...(state.phase === 'connected' || state.phase === 'error'
          ? { summary: state.summary }
          : {}),
        ...(state.phase === 'error'
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

  const value = useMemo<WaveConnectionContextValue>(
    () => ({
      ...(state.phase === 'connected' && client ? { client } : {}),
      disconnect,
      pair,
      retry,
      state,
    }),
    [client, disconnect, pair, retry, state],
  );

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

function toConnectionError(error: unknown): ConnectionError {
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
