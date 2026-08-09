/**
 * Mutable harness state: issued tokens, single-use WS tickets, sessions with
 * their stored message rows, and the consumable scenario FIFOs.
 */
import { randomUUID } from 'node:crypto';

import {
  DEFAULT_TRANSCRIPT,
  type HarnessRedirectScript,
  type HarnessScenario,
  type HarnessTurnScript,
} from './scenario.js';

export interface HarnessMessageRow {
  content: string;
  id: number;
  role: 'assistant' | 'user';
  timestamp: number;
}

export interface HarnessSession {
  liveId: string;
  messages: HarnessMessageRow[];
  pinned: boolean;
  storedId: string;
  title: string;
}

const TICKET_TTL_MS = 60_000;

export class HarnessState {
  private scenario: HarnessScenario = {};
  private readonly accessTokens = new Set<string>();
  private readonly tickets = new Map<string, number>();
  private readonly sessions = new Map<string, HarnessSession>();
  private readonly liveToStored = new Map<string, string>();
  private sessionCounter = 0;
  private messageCounter = 0;
  private tokenCounter = 0;

  loadScenario(scenario: HarnessScenario): void {
    this.scenario = scenario;
  }

  reset(): void {
    this.scenario = {};
    this.accessTokens.clear();
    this.tickets.clear();
    this.sessions.clear();
    this.liveToStored.clear();
    this.sessionCounter = 0;
    this.messageCounter = 0;
  }

  // ---- auth ---------------------------------------------------------------

  issueTokens(provider: string): {
    accessToken: string;
    provider: string;
    refreshToken: string;
  } {
    this.tokenCounter += 1;
    const accessToken = `harness-at-${this.tokenCounter}-${randomUUID()}`;
    const refreshToken = `harness-rt-${this.tokenCounter}`;
    this.accessTokens.add(accessToken);
    return { accessToken, provider, refreshToken };
  }

  isKnownAccessToken(token: string): boolean {
    return this.accessTokens.has(token);
  }

  mintTicket(): string {
    const ticket = `harness-ticket-${randomUUID()}`;
    this.tickets.set(ticket, Date.now() + TICKET_TTL_MS);
    return ticket;
  }

  consumeTicket(ticket: string): boolean {
    const expiry = this.tickets.get(ticket);
    if (expiry === undefined) return false;
    this.tickets.delete(ticket);
    return Date.now() <= expiry;
  }

  // ---- sessions -----------------------------------------------------------

  createSession(): HarnessSession {
    this.sessionCounter += 1;
    const session: HarnessSession = {
      liveId: `harness-live-${this.sessionCounter}`,
      messages: [],
      pinned: false,
      storedId: `harness-stored-${this.sessionCounter}`,
      title: `Harness conversation ${this.sessionCounter}`,
    };
    this.sessions.set(session.storedId, session);
    this.liveToStored.set(session.liveId, session.storedId);
    return session;
  }

  resolveSession(sessionId: string): HarnessSession | undefined {
    return (
      this.sessions.get(sessionId) ??
      this.sessions.get(this.liveToStored.get(sessionId) ?? '')
    );
  }

  listSessions(): HarnessSession[] {
    return [...this.sessions.values()];
  }

  deleteSession(storedId: string): boolean {
    const session = this.sessions.get(storedId);
    if (!session) return false;
    this.sessions.delete(storedId);
    this.liveToStored.delete(session.liveId);
    return true;
  }

  appendMessage(
    session: HarnessSession,
    role: HarnessMessageRow['role'],
    content: string,
  ): HarnessMessageRow {
    this.messageCounter += 1;
    const row: HarnessMessageRow = {
      content,
      id: this.messageCounter,
      role,
      timestamp: Date.now() / 1_000,
    };
    session.messages.push(row);
    return row;
  }

  // ---- scenario consumption ----------------------------------------------

  nextTranscript(): string {
    return this.scenario.transcripts?.shift() ?? DEFAULT_TRANSCRIPT;
  }

  transcribeScript(): HarnessScenario['transcribe'] {
    return this.scenario.transcribe;
  }

  nextTurnScript(): HarnessTurnScript | undefined {
    return this.scenario.turns?.shift();
  }

  nextRedirectScript(): HarnessRedirectScript {
    return this.scenario.redirects?.shift() ?? { status: 'redirected' };
  }

  audioCapabilities(): { stt: boolean; tts: boolean } {
    return this.scenario.audioCapabilities ?? { stt: true, tts: true };
  }

  speechScript(): NonNullable<HarnessScenario['speech']> {
    return this.scenario.speech ?? {};
  }
}
