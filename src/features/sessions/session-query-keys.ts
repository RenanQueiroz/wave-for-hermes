// The list key must never be a prefix of waveTimelineQueryKey: list
// invalidations would otherwise refetch every mounted conversation timeline,
// including deleted sessions whose refetch re-arms their not-found redirect.
export function waveSessionQueryKey(connectionId: string, baseUrl: string) {
  return ['wave', connectionId, baseUrl, 'session-list'] as const;
}

export function waveSessionDataQueryKey(
  connectionId: string,
  baseUrl: string,
  sessionId: string,
) {
  return ['wave', connectionId, baseUrl, 'sessions', sessionId] as const;
}

export function waveTimelineQueryKey(
  connectionId: string,
  baseUrl: string,
  sessionId: string,
) {
  return [
    ...waveSessionDataQueryKey(connectionId, baseUrl, sessionId),
    'timeline',
  ] as const;
}
