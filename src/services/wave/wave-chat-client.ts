/**
 * The client surface conversation screens depend on.
 *
 * `GatewayClient` is its only implementation, but screens still depend on
 * this type rather than the concrete client: it is the reviewed contract of
 * what conversation surfaces may do, and gateway-specific capabilities
 * (speech, prompts, Realtime execution) stay behind an explicit
 * `gatewayClient` ask on the connection.
 */
import type {
  WaveActiveTurnResponse,
  WaveCancelTurnResponse,
  WaveDeleteSessionResponse,
  WaveRedirectTurnResponse,
  WaveSessionHistoryResponse,
  WaveSessionListResponse,
  WaveSessionResponse,
  WaveTimelineResponse,
  WaveTurnEvent,
  WaveTurnInput,
} from '@wave/contracts';

/**
 * The local placeholder id `createSession` mints before the first send. A
 * pending id is not yet a Hermes conversation: the gateway session is
 * created when the first turn dispatches. Screens may use this to
 * distinguish a brand-new chat from an existing conversation that happens
 * to have no messages.
 */
export const PENDING_SESSION_PREFIX = 'wave-pending-';

export function isPendingSessionId(sessionId: string): boolean {
  return sessionId.startsWith(PENDING_SESSION_PREFIX);
}

/**
 * One page of conversations, without transport envelope fields — screens
 * must not depend on anything the normalized Wave contract does not carry.
 */
export interface WaveSessionPage {
  hasMore: boolean;
  limit: number;
  offset: number;
  sessions: WaveSessionListResponse['sessions'];
}

/** Fresh durable ids for user rows that survived a Hermes history rewrite. */
export type WaveTruncationSurvivorRowIds = readonly (number | null)[];

export interface WaveStreamTurnOptions {
  /** Apply fresh durable ids after Hermes rewrites the surviving prefix. */
  onTruncationCommitted?: (
    survivorUserRowIds: WaveTruncationSurvivorRowIds,
  ) => void;
  /** Regenerate: truncate before this visible user ordinal, then replay. */
  truncateBeforeUserOrdinal?: number;
  /** Preferred durable address for that same visible user turn. */
  truncateBeforeRowId?: number;
}

export interface WaveChatClient {
  readonly baseUrl: string;
  cancelTurn(
    sessionId: string,
    turnId: string,
    signal?: AbortSignal,
  ): Promise<WaveCancelTurnResponse | { turnId: string }>;
  createSession(
    input?: { title?: string },
    signal?: AbortSignal,
  ): Promise<WaveSessionResponse | { session: { id: string } }>;
  deleteSession(
    sessionId: string,
    signal?: AbortSignal,
  ): Promise<WaveDeleteSessionResponse | { sessionId: string }>;
  getActiveTurn(
    sessionId: string,
    signal?: AbortSignal,
  ): Promise<
    | WaveActiveTurnResponse
    | {
        activeTurn: { latestSequence: number; turnId: string } | null;
        lastActiveAt?: string;
        liveStatus?: 'idle' | 'starting' | 'waiting' | 'working';
      }
  >;
  getSessionHistory(
    sessionId: string,
    signal?: AbortSignal,
  ): Promise<WaveSessionHistoryResponse | { messages: unknown[] }>;
  getSessionTimeline(
    sessionId: string,
    input?: { before?: string; limit?: number },
    signal?: AbortSignal,
  ): Promise<WaveTimelineResponse>;
  listSessions(
    input?: { limit?: number; offset?: number },
    signal?: AbortSignal,
  ): Promise<WaveSessionPage>;
  setSessionPinned(
    sessionId: string,
    pinned: boolean,
    signal?: AbortSignal,
  ): Promise<
    WaveSessionResponse | { session: { id: string; pinned: boolean } }
  >;
  /** Move the conversation's server-owned read watermark (mark read/unread). */
  setSessionUnread(
    sessionId: string,
    unread: boolean,
    signal?: AbortSignal,
  ): Promise<
    WaveSessionResponse | { session: { id: string; unread: boolean } }
  >;
  redirectTurn(
    sessionId: string,
    text: string,
  ): Promise<WaveRedirectTurnResponse>;
  resumeTurnStream(
    sessionId: string,
    turnId: string,
    after: number,
    signal?: AbortSignal,
  ): AsyncGenerator<WaveTurnEvent>;
  streamTurn(
    sessionId: string,
    input: WaveTurnInput,
    signal?: AbortSignal,
    options?: WaveStreamTurnOptions,
  ): AsyncGenerator<WaveTurnEvent>;
  updateSession(
    sessionId: string,
    input: { title: string },
    signal?: AbortSignal,
  ): Promise<WaveSessionResponse | { session: { id: string; title?: string } }>;
}
