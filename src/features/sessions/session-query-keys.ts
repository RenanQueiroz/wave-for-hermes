export function waveSessionQueryKey(connectionId: string, baseUrl: string) {
  return ['wave', connectionId, baseUrl, 'sessions'] as const;
}

export function waveHistoryQueryKey(
  connectionId: string,
  baseUrl: string,
  sessionId: string,
) {
  return [
    'wave',
    connectionId,
    baseUrl,
    'sessions',
    sessionId,
    'history',
  ] as const;
}
