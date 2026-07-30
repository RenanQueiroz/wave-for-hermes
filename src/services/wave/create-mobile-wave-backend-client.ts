import { fetch as expoFetch } from 'expo/fetch';

import {
  WaveBackendClient,
  type WaveBackendClientOptions,
  type WaveFetch,
} from './wave-backend-client';

export function createMobileWaveBackendClient(
  options: Omit<WaveBackendClientOptions, 'fetch'>,
) {
  return new WaveBackendClient({
    ...options,
    fetch: expoFetch as unknown as WaveFetch,
  });
}
