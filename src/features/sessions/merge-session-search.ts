/**
 * Conversation search results: local titles + server message content.
 *
 * The gateway's `/api/sessions/search` indexes message CONTENT and session
 * ids, but NOT titles (verified live on 0.19.0: a renamed session does not
 * match its own new title). Wave therefore searches titles itself over the
 * loaded session list and merges the server's content hits underneath, so a
 * user finds a chat by what it is called OR by something said in it.
 *
 * Pure module: the screen owns fetching, this owns the merge.
 */
import type { WaveSessionSummary } from '@wave/contracts';

export interface SessionSearchResult {
  /** Where the match came from, so the row can say so honestly. */
  matchedOn: 'content' | 'title';
  session: WaveSessionSummary;
  /** The server's bounded snippet for a content match. */
  snippet?: string;
}

/**
 * The row's second line: an honest "Message match" for content hits (the
 * snippet is gateway-authored untrusted text — bounded, inert, never
 * markdown), the stored preview otherwise.
 */
export function sessionSearchRowDescription(
  result: SessionSearchResult,
): string {
  if (result.matchedOn === 'content') {
    return `Message match: ${result.snippet ?? 'found in this conversation'}`;
  }
  return result.session.preview ?? 'Hermes conversation';
}

export function matchesSessionTitle(
  session: WaveSessionSummary,
  normalizedQuery: string,
): boolean {
  return (session.title ?? 'Untitled chat')
    .toLocaleLowerCase()
    .includes(normalizedQuery);
}

/**
 * Title matches first (the user's own naming is the strongest signal), then
 * content matches for sessions the title pass did not already surface. A
 * content hit for a session missing from the loaded list still shows, using
 * whatever the server knew about it.
 */
export function mergeSessionSearchResults({
  contentMatches,
  normalizedQuery,
  sessions,
}: {
  contentMatches: readonly { sessionId: string; snippet?: string }[];
  normalizedQuery: string;
  sessions: readonly WaveSessionSummary[];
}): SessionSearchResult[] {
  if (!normalizedQuery) {
    return sessions.map((session) => ({ matchedOn: 'title', session }));
  }

  const byId = new Map(sessions.map((session) => [session.id, session]));
  const results: SessionSearchResult[] = [];
  const claimed = new Set<string>();

  for (const session of sessions) {
    if (!matchesSessionTitle(session, normalizedQuery)) continue;
    claimed.add(session.id);
    results.push({ matchedOn: 'title', session });
  }

  for (const match of contentMatches) {
    if (claimed.has(match.sessionId)) continue;
    claimed.add(match.sessionId);
    results.push({
      matchedOn: 'content',
      session: byId.get(match.sessionId) ?? {
        id: match.sessionId,
        liveStatus: 'idle',
        pinned: false,
        source: 'chat',
        unread: false,
      },
      ...(match.snippet ? { snippet: match.snippet } : {}),
    });
  }

  return results;
}
