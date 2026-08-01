import { focusManager, QueryClient } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { useEffect, useState, type PropsWithChildren } from 'react';
import { AppState } from 'react-native';

import { calculateBoundedRetryDelay } from '@/services/query/retry-policy';
import { waveQueryPersister } from '@/services/query/wave-query-cache';
import {
  shouldPersistWaveQuery,
  WAVE_QUERY_CACHE_BUSTER,
  WAVE_QUERY_CACHE_MAX_AGE_MS,
} from '@/services/query/wave-query-persister';
import { WaveBackendError } from '@/services/wave/wave-backend-client';

export function WaveQueryProvider({ children }: PropsWithChildren) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          mutations: {
            retry: false,
          },
          queries: {
            // gcTime must cover the persisted max age so restored session
            // and timeline reads are not collected before they can render.
            gcTime: WAVE_QUERY_CACHE_MAX_AGE_MS,
            refetchOnMount: true,
            refetchOnReconnect: true,
            refetchOnWindowFocus: true,
            retry: (failureCount, error) =>
              failureCount < 2 &&
              (!(error instanceof WaveBackendError) || error.retryable),
            retryDelay: (attemptIndex) =>
              calculateBoundedRetryDelay(attemptIndex),
            staleTime: 15_000,
          },
        },
      }),
  );

  useEffect(() => {
    focusManager.setFocused(AppState.currentState === 'active');
    const subscription = AppState.addEventListener('change', (state) => {
      focusManager.setFocused(state === 'active');
    });
    return () => {
      subscription.remove();
      focusManager.setFocused(undefined);
    };
  }, []);

  return (
    <PersistQueryClientProvider
      client={client}
      persistOptions={{
        buster: WAVE_QUERY_CACHE_BUSTER,
        dehydrateOptions: {
          shouldDehydrateQuery: (query) =>
            shouldPersistWaveQuery(query.queryKey, query.state),
        },
        maxAge: WAVE_QUERY_CACHE_MAX_AGE_MS,
        persister: waveQueryPersister,
      }}>
      {children}
    </PersistQueryClientProvider>
  );
}
