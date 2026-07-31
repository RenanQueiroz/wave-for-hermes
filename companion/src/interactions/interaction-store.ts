import type { WaveAskHermesToolResult } from '@wave/contracts';

export interface InteractionMessageRecord {
  content: string;
  createdAt: string;
  id: string;
  type: 'wave_message';
}

export interface InteractionHandoffRecord {
  completedAt?: string;
  createdAt: string;
  hermesAssistantMessageId?: string;
  hermesAssistantMessageTimestamp?: number;
  id: string;
  instruction: string;
  result?: WaveAskHermesToolResult;
  status: 'pending' | 'completed' | 'failed';
  type: 'handoff';
}

export type InteractionEntryRecord =
  InteractionHandoffRecord | InteractionMessageRecord;

export interface InteractionTurnRecord {
  createdAt: string;
  entries: InteractionEntryRecord[];
  id: string;
  sessionId: string;
  userTranscript?: string;
}

export interface InteractionStore {
  beginHandoff(input: {
    createdAt: string;
    eventKey: string;
    instruction: string;
    sessionId: string;
    turnId: string;
  }): string;
  beginRealtimeTurn(input: {
    createdAt: string;
    eventKey: string;
    sessionId: string;
  }): string;
  completeHandoff(input: {
    completedAt: string;
    handoffId: string;
    hermesAssistantMessageId?: string;
    hermesAssistantMessageTimestamp?: number;
    result: WaveAskHermesToolResult;
  }): void;
  deleteSession(sessionId: string): void;
  listSessionTurns(sessionId: string): InteractionTurnRecord[];
  recordUserTranscript(input: {
    transcript: string;
    turnId: string;
    updatedAt: string;
  }): void;
  recordWaveMessage(input: {
    content: string;
    createdAt: string;
    eventKey: string;
    sessionId: string;
    turnId: string;
  }): string;
}
