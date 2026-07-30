/** Configuration owned only by the Wave Companion process. */
export interface HermesConnectionConfig {
  allowInsecureHttp?: boolean;
  baseUrl: string;
  bearerToken: string;
}

export interface HermesEndpointCapability {
  method: string;
  path: string;
}

export type HermesFeatureValue = boolean | number | string | null;

export interface HermesCapabilities {
  auth: {
    required: boolean;
    type: string;
  };
  endpoints: Record<string, HermesEndpointCapability>;
  features: Record<string, HermesFeatureValue>;
  model: string;
  object: 'hermes.api_server.capabilities';
  platform: 'hermes-agent';
}

export interface HermesCapabilityReport {
  capabilities: HermesCapabilities;
  missingEndpoints: string[];
  missingFeatures: string[];
  supported: boolean;
}

export interface HermesSessionSummary {
  endReason?: string;
  endedAt?: number;
  id: string;
  lastActive?: number;
  messageCount?: number;
  model?: string;
  parentSessionId?: string;
  preview?: string;
  source?: string;
  startedAt?: number;
  title?: string;
  toolCallCount?: number;
}

export type HermesMessageRole = 'assistant' | 'system' | 'tool' | 'unknown' | 'user';

export interface HermesToolCall {
  arguments?: string;
  id: string;
  name?: string;
}

export interface HermesConversationMessage {
  content: string;
  id?: string;
  role: HermesMessageRole;
  sessionId: string;
  timestamp?: number;
  toolCallId?: string;
  toolCalls?: HermesToolCall[];
  toolName?: string;
}

interface HermesStreamEventBase {
  runId: string;
  sequence: number;
  sessionId: string;
  timestamp: number;
}

export interface HermesRunStartedEvent extends HermesStreamEventBase {
  type: 'run.started';
}

export interface HermesMessageStartedEvent extends HermesStreamEventBase {
  messageId: string;
  type: 'message.started';
}

export interface HermesAssistantDeltaEvent extends HermesStreamEventBase {
  delta: string;
  messageId: string;
  type: 'assistant.delta';
}

export interface HermesToolEvent extends HermesStreamEventBase {
  messageId?: string;
  status: 'completed' | 'failed' | 'progress' | 'started';
  toolInput?: string;
  toolName?: string;
  toolOutput?: string;
  toolOutputIsPreview?: boolean;
  type: 'tool';
}

export interface HermesAssistantCompletedEvent extends HermesStreamEventBase {
  content: string;
  interrupted: boolean;
  messageId: string;
  partial: boolean;
  type: 'assistant.completed';
}

export interface HermesRunCompletedEvent extends HermesStreamEventBase {
  completed: boolean;
  messageId?: string;
  type: 'run.completed';
}

export interface HermesStreamErrorEvent extends HermesStreamEventBase {
  message: string;
  type: 'error';
}

export interface HermesStreamDoneEvent extends HermesStreamEventBase {
  type: 'done';
}

export type HermesStreamEvent =
  | HermesAssistantCompletedEvent
  | HermesAssistantDeltaEvent
  | HermesMessageStartedEvent
  | HermesRunCompletedEvent
  | HermesRunStartedEvent
  | HermesStreamDoneEvent
  | HermesStreamErrorEvent
  | HermesToolEvent;

export interface HermesListSessionsOptions {
  includeChildren?: boolean;
  limit?: number;
  offset?: number;
  signal?: AbortSignal;
  source?: string;
}

export interface HermesCreateSessionInput {
  id?: string;
  model?: string;
  signal?: AbortSignal;
  title?: string;
}

export interface HermesStreamChatInput {
  input: string;
  instructions?: string;
  signal?: AbortSignal;
}

export interface HermesRequestOptions {
  signal?: AbortSignal;
}

export interface HermesClient {
  createSession(input?: HermesCreateSessionInput): Promise<HermesSessionSummary>;
  getSessionMessages(
    sessionId: string,
    options?: HermesRequestOptions,
  ): Promise<HermesConversationMessage[]>;
  listSessions(options?: HermesListSessionsOptions): Promise<HermesSessionSummary[]>;
  probeCapabilities(options?: HermesRequestOptions): Promise<HermesCapabilityReport>;
  stopRun(runId: string, options?: HermesRequestOptions): Promise<void>;
  streamChat(sessionId: string, input: HermesStreamChatInput): AsyncGenerator<HermesStreamEvent>;
}
