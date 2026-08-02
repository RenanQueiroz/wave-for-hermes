/**
 * The client surface conversation screens depend on.
 *
 * Both backends implement it: `WaveBackendClient` (companion, being retired)
 * and `GatewayClient` (direct Hermes gateway). Screens depend on this type
 * rather than either implementation, so the migration is a provider-level
 * swap rather than a rewrite of every surface.
 *
 * Companion-only capabilities (Realtime call setup, diagnostics, scheduled
 * jobs, device revocation) are deliberately absent: those screens ask the
 * connection for the companion client explicitly and degrade when it is not
 * the active backend.
 */
import type {
  WaveActiveTurnResponse,
  WaveCancelTurnResponse,
  WaveDeleteSessionResponse,
  WaveSessionHistoryResponse,
  WaveSessionListResponse,
  WaveSessionResponse,
  WaveTimelineResponse,
  WaveTurnEvent,
  WaveTurnInput,
} from '@wave/contracts';

/**
 * One page of conversations. The companion's `apiVersion` envelope field is
 * deliberately not part of it — screens must not depend on a companion-only
 * field that the gateway has no equivalent for.
 */
export interface WaveSessionPage {
  hasMore: boolean;
  limit: number;
  offset: number;
  sessions: WaveSessionListResponse['sessions'];
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
    | { activeTurn: { latestSequence: number; turnId: string } | null }
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
  ): AsyncGenerator<WaveTurnEvent>;
  updateSession(
    sessionId: string,
    input: { title: string },
    signal?: AbortSignal,
  ): Promise<WaveSessionResponse | { session: { id: string; title?: string } }>;
}
