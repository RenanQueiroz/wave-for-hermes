export function waveSessionQueryKey(connectionId: string, baseUrl: string) {
  return ['wave', connectionId, baseUrl, 'sessions'] as const;
}

export function waveTimelineQueryKey(
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
    'timeline',
  ] as const;
}
