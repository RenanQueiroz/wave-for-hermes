import {
  WaveAskHermesArgumentsSchema,
  WaveAskHermesToolResultSchema,
  WaveRealtimeSdpSchema,
  type WaveAskHermesToolResult,
  type WaveRealtimeVoiceId,
} from '@wave/contracts';
import OpenAI, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
} from 'openai';
import type { RealtimeSessionCreateRequest } from 'openai/resources/realtime/realtime';
import WebSocket from 'ws';
import { z } from 'zod';

import type { OpenAIRealtimeConfig } from '../config.ts';
import {
  RealtimeProviderError,
  type RealtimeAssistantTranscript,
  type RealtimeFunctionCall,
  type RealtimeProvider,
  type RealtimeProviderCall,
  type RealtimeSideband,
  type RealtimeUserTranscript,
} from './realtime-provider.ts';

const OPENAI_API_BASE_URL = 'https://api.openai.com/v1';
const OPENAI_REALTIME_CALL_PATH = '/realtime/calls';
const OPENAI_REALTIME_WEBSOCKET_URL = 'wss://api.openai.com/v1/realtime';
const OPENAI_CALL_ID_PATTERN = /^rtc_[A-Za-z0-9_-]{1,256}$/;
const MAX_SIDEBAND_EVENT_BYTES = 2 * 1024 * 1024;

type SidebandSocketEvent = 'close' | 'error' | 'message' | 'open';
type SidebandSocketListener = (...arguments_: unknown[]) => void;

interface SidebandSocket {
  readonly readyState: number;
  close(code?: number, reason?: string): void;
  off(event: SidebandSocketEvent, listener: SidebandSocketListener): void;
  on(event: SidebandSocketEvent, listener: SidebandSocketListener): void;
  send(data: string): void;
}

interface SidebandSocketFactoryInput {
  headers: Record<string, string>;
  timeoutMs: number;
  url: URL;
}

type SidebandSocketFactory = (
  input: SidebandSocketFactoryInput,
) => SidebandSocket;

const RealtimeFunctionCallSchema = z
  .object({
    arguments: z.string().max(64_000),
    call_id: z.string().min(1).max(300),
    name: z.string().min(1).max(100),
    type: z.literal('function_call'),
  })
  .passthrough();
const RealtimeUserItemEventSchema = z
  .object({
    item: z
      .object({
        id: z.string().min(1).max(300),
        role: z.literal('user'),
        type: z.literal('message'),
      })
      .passthrough(),
    type: z.enum(['conversation.item.added', 'conversation.item.done']),
  })
  .passthrough();
const RealtimeUserTranscriptEventSchema = z
  .object({
    item_id: z.string().min(1).max(300),
    transcript: z.string().max(128_000),
    type: z.literal('conversation.item.input_audio_transcription.completed'),
  })
  .passthrough();
const RealtimeAssistantTranscriptEventSchema = z
  .object({
    response_id: z.string().min(1).max(300),
    transcript: z.string().max(128_000),
    type: z.literal('response.output_audio_transcript.done'),
  })
  .passthrough();
const RealtimeResponseEventSchema = z
  .object({
    response: z
      .object({
        id: z.string().min(1).max(300).optional(),
        metadata: z.record(z.string(), z.string()).nullish(),
        output: z.array(z.unknown()).optional(),
        status: z.string().max(100).optional(),
      })
      .passthrough(),
    type: z.enum(['response.created', 'response.done']),
  })
  .passthrough();
const WAVE_HANDOFF_METADATA_KEY = 'wave_handoff_ids';

export class OpenAIRealtimeProvider implements RealtimeProvider {
  private readonly client: OpenAI;
  private readonly config: OpenAIRealtimeConfig;
  private readonly sidebandSocketFactory: SidebandSocketFactory;

  constructor(
    config: OpenAIRealtimeConfig,
    options: {
      client?: OpenAI;
      sidebandSocketFactory?: SidebandSocketFactory;
    } = {},
  ) {
    this.config = config;
    this.client =
      options.client ??
      new OpenAI({
        apiKey: config.apiKey,
        baseURL: OPENAI_API_BASE_URL,
        logLevel: 'off',
        maxRetries: 0,
        organization: null,
        project: null,
        timeout: config.requestTimeoutMs,
      });
    this.sidebandSocketFactory =
      options.sidebandSocketFactory ?? createSidebandSocket;
  }

  async createCall(input: {
    safetyIdentifier: string;
    sdpOffer: string;
    signal?: AbortSignal;
    voice: WaveRealtimeVoiceId;
  }): Promise<RealtimeProviderCall> {
    const form = new FormData();
    form.set('sdp', input.sdpOffer);
    form.set(
      'session',
      JSON.stringify(createSessionConfig(this.config, input.voice)),
    );

    let response: Response;
    try {
      response = await this.client
        .post(OPENAI_REALTIME_CALL_PATH, {
          body: form,
          headers: {
            'OpenAI-Safety-Identifier': input.safetyIdentifier,
          },
          maxRetries: 0,
          signal: input.signal,
          timeout: this.config.requestTimeoutMs,
        })
        .asResponse();
    } catch (error) {
      throw normalizeOpenAIError(error);
    }

    const providerCallId = parseProviderCallId(
      response.headers.get('location'),
    );
    let sdpAnswer: string;
    try {
      const responseContentType = response.headers
        .get('content-type')
        ?.split(';', 1)[0]
        ?.trim()
        .toLowerCase();
      if (
        response.status !== 201 ||
        (responseContentType !== 'application/sdp' &&
          responseContentType !== 'text/plain')
      ) {
        throw new RealtimeProviderError(
          'OpenAI Realtime returned an invalid call response.',
          { kind: 'protocol' },
        );
      }
      const parsed = WaveRealtimeSdpSchema.safeParse(
        await readBoundedText(response, 48_000),
      );
      if (!parsed.success) {
        throw new RealtimeProviderError(
          'OpenAI Realtime returned an invalid SDP answer.',
          { kind: 'protocol' },
        );
      }
      sdpAnswer = parsed.data;
    } catch (error) {
      await this.hangUp(providerCallId);
      throw normalizeOpenAIError(error);
    }

    let sideband: OpenAIRealtimeSideband | undefined;
    try {
      const sidebandUrl = new URL(OPENAI_REALTIME_WEBSOCKET_URL);
      sidebandUrl.searchParams.set('call_id', providerCallId);
      sideband = new OpenAIRealtimeSideband(
        this.sidebandSocketFactory({
          headers: {
            Authorization: `Bearer ${this.config.apiKey}`,
          },
          timeoutMs: this.config.sidebandConnectTimeoutMs,
          url: sidebandUrl,
        }),
      );
      await sideband.waitUntilOpen(
        this.config.sidebandConnectTimeoutMs,
        input.signal,
      );
    } catch (error) {
      sideband?.close();
      await this.hangUp(providerCallId);
      throw normalizeOpenAIError(error);
    }

    let ended = false;
    return {
      end: async () => {
        if (ended) {
          return;
        }
        ended = true;
        sideband.close();
        await this.hangUp(providerCallId);
      },
      sdpAnswer,
      sideband,
    };
  }

  private async hangUp(providerCallId: string) {
    try {
      await this.client.realtime.calls.hangup(providerCallId, {
        maxRetries: 0,
        timeout: this.config.requestTimeoutMs,
      });
    } catch {
      // Ending a call is idempotent from Wave's perspective. The peer or API may
      // already have closed it, and no upstream error detail should enter logs.
    }
  }
}

class OpenAIRealtimeSideband implements RealtimeSideband {
  private readonly assistantTranscriptListeners = new Set<
    (transcript: RealtimeAssistantTranscript) => void
  >();
  private closed = false;
  private readonly closeListeners = new Set<() => void>();
  private readonly errorListeners = new Set<
    (error: RealtimeProviderError) => void
  >();
  private readonly functionCallListeners = new Set<
    (call: RealtimeFunctionCall) => void
  >();
  private readonly pendingFunctionResults: {
    callId: string;
    handoffId?: string;
    output: string;
  }[] = [];
  private readonly pendingResponseHandoffIds: string[][] = [];
  private readonly responseContexts = new Map<
    string,
    { handoffIds: string[]; userItemId?: string }
  >();
  private readonly responseTranscripts = new Map<string, string>();
  private responseInProgress = false;
  private readonly socket: SidebandSocket;
  private readonly seenUserItemIds = new Set<string>();
  private readonly userItemListeners = new Set<(itemId: string) => void>();
  private readonly userTranscriptListeners = new Set<
    (transcript: RealtimeUserTranscript) => void
  >();
  private latestUserItemId?: string;
  private userSpeaking = false;

  constructor(socket: SidebandSocket) {
    this.socket = socket;
    socket.on('message', (data, isBinary) => {
      this.handleMessage(data, isBinary === true);
    });
    socket.on('close', () => {
      this.markClosed();
    });
    socket.on('error', () => {
      this.emitError(
        new RealtimeProviderError(
          'Could not maintain the OpenAI Realtime sideband connection.',
          {
            kind: 'unavailable',
            retryable: true,
          },
        ),
      );
    });
  }

  close() {
    if (!this.closed) {
      this.socket.close(1000, 'Wave call ended');
      this.markClosed();
    }
  }

  onAssistantTranscript(
    listener: (transcript: RealtimeAssistantTranscript) => void,
  ) {
    this.assistantTranscriptListeners.add(listener);
  }

  onClose(listener: () => void) {
    this.closeListeners.add(listener);
    if (this.closed) {
      queueMicrotask(listener);
    }
  }

  onError(listener: (error: RealtimeProviderError) => void) {
    this.errorListeners.add(listener);
  }

  onFunctionCall(listener: (call: RealtimeFunctionCall) => void) {
    this.functionCallListeners.add(listener);
  }

  onUserItem(listener: (itemId: string) => void) {
    this.userItemListeners.add(listener);
  }

  onUserTranscript(listener: (transcript: RealtimeUserTranscript) => void) {
    this.userTranscriptListeners.add(listener);
  }

  sendFunctionResult(
    callId: string,
    result: WaveAskHermesToolResult,
    handoffId?: string,
  ) {
    if (this.closed || this.socket.readyState !== WebSocket.OPEN) {
      return false;
    }
    const output = JSON.stringify(WaveAskHermesToolResultSchema.parse(result));
    this.pendingFunctionResults.push({
      callId,
      ...(handoffId ? { handoffId } : {}),
      output,
    });
    return this.flushFunctionResults();
  }

  async waitUntilOpen(timeoutMs: number, signal?: AbortSignal) {
    if (this.socket.readyState === WebSocket.OPEN) {
      return;
    }
    if (this.closed || this.socket.readyState === WebSocket.CLOSED) {
      throw new RealtimeProviderError(
        'OpenAI Realtime closed before the sideband connected.',
        {
          kind: 'unavailable',
          retryable: true,
        },
      );
    }

    await new Promise<void>((resolve, reject) => {
      const socket = this.socket;
      const onAbort = () => {
        cleanup();
        reject(
          new RealtimeProviderError(
            'OpenAI Realtime sideband setup was cancelled.',
            { kind: 'unavailable', retryable: true },
          ),
        );
      };
      const onClose = () => {
        cleanup();
        reject(
          new RealtimeProviderError(
            'OpenAI Realtime closed before the sideband connected.',
            { kind: 'unavailable', retryable: true },
          ),
        );
      };
      const onError = () => {
        cleanup();
        reject(
          new RealtimeProviderError(
            'Could not connect the OpenAI Realtime sideband.',
            { kind: 'unavailable', retryable: true },
          ),
        );
      };
      const onOpen = () => {
        cleanup();
        resolve();
      };
      const timeout = setTimeout(() => {
        cleanup();
        reject(
          new RealtimeProviderError(
            'OpenAI Realtime sideband setup timed out.',
            { kind: 'timeout', retryable: true },
          ),
        );
      }, timeoutMs);
      const cleanup = () => {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', onAbort);
        socket.off('close', onClose);
        socket.off('error', onError);
        socket.off('open', onOpen);
      };

      if (signal?.aborted) {
        onAbort();
        return;
      }
      signal?.addEventListener('abort', onAbort, { once: true });
      socket.on('close', onClose);
      socket.on('error', onError);
      socket.on('open', onOpen);
    });
  }

  private handleMessage(data: unknown, isBinary: boolean) {
    const text = readSidebandMessage(data, isBinary);
    if (text === undefined) {
      this.emitProtocolError('OpenAI Realtime sent an invalid sideband event.');
      return;
    }

    let event: unknown;
    try {
      event = JSON.parse(text);
    } catch {
      this.emitProtocolError('OpenAI Realtime sent malformed sideband JSON.');
      return;
    }
    if (!isRecord(event) || typeof event.type !== 'string') {
      this.emitProtocolError('OpenAI Realtime sent an invalid sideband event.');
      return;
    }
    if (event.type === 'error') {
      this.emitError(
        new RealtimeProviderError(
          'OpenAI Realtime reported a sideband error.',
          { kind: 'unavailable', retryable: true },
        ),
      );
      return;
    }
    if (event.type === 'input_audio_buffer.speech_started') {
      this.userSpeaking = true;
      return;
    }
    if (event.type === 'input_audio_buffer.speech_stopped') {
      this.userSpeaking = false;
      return;
    }
    if (
      event.type === 'conversation.item.added' ||
      event.type === 'conversation.item.done'
    ) {
      const parsed = RealtimeUserItemEventSchema.safeParse(event);
      if (!parsed.success) {
        return;
      }
      this.emitUserItem(parsed.data.item.id);
      return;
    }
    if (
      event.type === 'conversation.item.input_audio_transcription.completed'
    ) {
      const parsed = RealtimeUserTranscriptEventSchema.safeParse(event);
      if (!parsed.success) {
        this.emitProtocolError(
          'OpenAI Realtime sent an invalid input transcript.',
        );
        return;
      }
      this.emitUserItem(parsed.data.item_id);
      for (const listener of this.userTranscriptListeners) {
        listener({
          itemId: parsed.data.item_id,
          transcript: parsed.data.transcript,
        });
      }
      return;
    }
    if (event.type === 'response.output_audio_transcript.done') {
      const parsed = RealtimeAssistantTranscriptEventSchema.safeParse(event);
      if (!parsed.success) {
        this.emitProtocolError(
          'OpenAI Realtime sent an invalid output transcript.',
        );
        return;
      }
      this.responseTranscripts.set(
        parsed.data.response_id,
        parsed.data.transcript,
      );
      return;
    }
    if (event.type === 'response.created') {
      const parsed = RealtimeResponseEventSchema.safeParse(event);
      if (!parsed.success) {
        this.emitProtocolError('OpenAI Realtime sent an invalid response.');
        return;
      }
      this.responseInProgress = true;
      if (parsed.data.response.id) {
        const metadataHandoffIds = readHandoffMetadata(
          parsed.data.response.metadata,
        );
        const pendingHandoffIds = this.pendingResponseHandoffIds.shift() ?? [];
        this.responseContexts.set(parsed.data.response.id, {
          handoffIds:
            metadataHandoffIds.length > 0
              ? metadataHandoffIds
              : pendingHandoffIds,
          ...(this.latestUserItemId
            ? { userItemId: this.latestUserItemId }
            : {}),
        });
      }
      return;
    }
    if (event.type !== 'response.done') {
      return;
    }
    const parsedResponse = RealtimeResponseEventSchema.safeParse(event);
    if (!parsedResponse.success) {
      this.emitProtocolError(
        'OpenAI Realtime sent an invalid completed response.',
      );
      return;
    }
    const response = parsedResponse.data.response;
    const responseId = response.id;
    const context = responseId
      ? this.responseContexts.get(responseId)
      : undefined;
    const handoffIds = readHandoffMetadata(response.metadata);
    const transcript = responseId
      ? this.responseTranscripts.get(responseId)?.trim()
      : undefined;
    if (responseId && response.status === 'completed' && transcript) {
      for (const listener of this.assistantTranscriptListeners) {
        listener({
          handoffIds:
            handoffIds.length > 0 ? handoffIds : (context?.handoffIds ?? []),
          responseId,
          transcript,
          ...(context?.userItemId ? { userItemId: context.userItemId } : {}),
        });
      }
    }
    this.responseInProgress = false;
    for (const output of response.output ?? []) {
      if (!isRecord(output) || output.type !== 'function_call') {
        continue;
      }
      const parsed = RealtimeFunctionCallSchema.safeParse(output);
      if (!parsed.success) {
        this.emitProtocolError(
          'OpenAI Realtime sent an invalid function call.',
        );
        return;
      }
      for (const listener of this.functionCallListeners) {
        listener({
          arguments: parsed.data.arguments,
          callId: parsed.data.call_id,
          name: parsed.data.name,
          ...(context?.userItemId ? { userItemId: context.userItemId } : {}),
        });
      }
    }
    if (responseId) {
      this.responseContexts.delete(responseId);
      this.responseTranscripts.delete(responseId);
    }
    this.flushFunctionResults();
  }

  private flushFunctionResults() {
    if (this.closed || this.responseInProgress || this.userSpeaking) {
      return !this.closed;
    }
    if (this.pendingFunctionResults.length === 0) {
      return true;
    }
    try {
      const handoffIds = this.pendingFunctionResults.flatMap((result) =>
        result.handoffId ? [result.handoffId] : [],
      );
      for (const result of this.pendingFunctionResults) {
        this.socket.send(
          JSON.stringify({
            item: {
              call_id: result.callId,
              output: result.output,
              type: 'function_call_output',
            },
            type: 'conversation.item.create',
          }),
        );
      }
      this.pendingFunctionResults.length = 0;
      this.pendingResponseHandoffIds.push(handoffIds);
      this.socket.send(
        JSON.stringify({
          response: {
            metadata: {
              [WAVE_HANDOFF_METADATA_KEY]: JSON.stringify(handoffIds),
            },
          },
          type: 'response.create',
        }),
      );
      // Treat the request as active immediately so two fast tool completions
      // cannot race before the corresponding response.created event arrives.
      this.responseInProgress = true;
      return true;
    } catch {
      this.emitError(
        new RealtimeProviderError(
          'Could not send the Hermes result to OpenAI Realtime.',
          { kind: 'unavailable', retryable: true },
        ),
      );
      this.close();
      return false;
    }
  }

  private emitProtocolError(message: string) {
    this.emitError(new RealtimeProviderError(message, { kind: 'protocol' }));
    this.close();
  }

  private emitUserItem(itemId: string) {
    if (this.seenUserItemIds.has(itemId)) {
      return;
    }
    this.seenUserItemIds.add(itemId);
    this.latestUserItemId = itemId;
    for (const listener of this.userItemListeners) {
      listener(itemId);
    }
  }

  private emitError(error: RealtimeProviderError) {
    for (const listener of this.errorListeners) {
      listener(error);
    }
  }

  private markClosed() {
    if (this.closed) {
      return;
    }
    this.closed = true;
    for (const listener of this.closeListeners) {
      listener();
    }
  }
}

function readHandoffMetadata(
  metadata: Record<string, string> | null | undefined,
) {
  const value = metadata?.[WAVE_HANDOFF_METADATA_KEY];
  if (!value) {
    return [];
  }
  try {
    const parsed = z
      .array(z.string().uuid())
      .max(8)
      .safeParse(JSON.parse(value) as unknown);
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

function createSidebandSocket(
  input: SidebandSocketFactoryInput,
): SidebandSocket {
  return new WebSocket(input.url, {
    handshakeTimeout: input.timeoutMs,
    headers: input.headers,
    maxPayload: MAX_SIDEBAND_EVENT_BYTES,
    perMessageDeflate: false,
  }) as unknown as SidebandSocket;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readSidebandMessage(
  data: unknown,
  isBinary: boolean,
): string | undefined {
  if (isBinary) {
    return undefined;
  }
  if (typeof data === 'string') {
    return Buffer.byteLength(data, 'utf8') <= MAX_SIDEBAND_EVENT_BYTES
      ? data
      : undefined;
  }
  if (Buffer.isBuffer(data)) {
    return data.byteLength <= MAX_SIDEBAND_EVENT_BYTES
      ? data.toString('utf8')
      : undefined;
  }
  if (data instanceof ArrayBuffer) {
    return data.byteLength <= MAX_SIDEBAND_EVENT_BYTES
      ? Buffer.from(data).toString('utf8')
      : undefined;
  }
  if (ArrayBuffer.isView(data)) {
    return data.byteLength <= MAX_SIDEBAND_EVENT_BYTES
      ? Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString(
          'utf8',
        )
      : undefined;
  }
  if (Array.isArray(data) && data.every(Buffer.isBuffer)) {
    const byteLength = data.reduce(
      (total, chunk) => total + chunk.byteLength,
      0,
    );
    return byteLength <= MAX_SIDEBAND_EVENT_BYTES
      ? Buffer.concat(data).toString('utf8')
      : undefined;
  }
  return undefined;
}

function createSessionConfig(
  config: OpenAIRealtimeConfig,
  voice: WaveRealtimeVoiceId,
): RealtimeSessionCreateRequest {
  return {
    audio: {
      input: {
        noise_reduction: {
          type: 'near_field',
        },
        turn_detection: {
          create_response: true,
          interrupt_response: true,
          type: 'semantic_vad',
        },
      },
      output: {
        voice,
      },
    },
    instructions: `# Role
You are Wave, the user's concise live voice assistant. Speak and act as one assistant. Hermes is your execution and reasoning backend; the user never needs to mention Hermes or ask you to delegate.

# Direct replies and delegation
Answer greetings, lightweight conversation, clarification, and simple computations directly.
Use ask_hermes automatically when a request needs external or current information, private or user-specific context, device or service control, durable work, or substantial reasoning.
When the request is sufficiently specified, do not ask for confirmation solely because ask_hermes is needed. If missing information would materially change the requested action, ask one concise clarifying question first.

# Tool instructions
Translate the user's request into a clear, self-contained instruction optimized for Hermes. Preserve the user's intent, scope, constraints, identifiers, quoted text, and literal values. You may rephrase or organize the instruction, but never broaden the requested action, add side effects, or invent missing details.
Before a tool call that may take noticeable time, say at most one short, neutral preamble such as "I'll take care of that" or "Let me check." Do not mention Hermes or imply success in the preamble. Then call the tool immediately.
Hermes requests continue in the background, so remain available for conversational follow-ups while waiting and do not treat an interruption of your speech as cancelling Hermes.
When the user makes another distinct request that needs Hermes while earlier Hermes work is still running, call ask_hermes for the new request immediately; Wave will queue it safely in arrival order. Do not wait for the earlier result or claim that another Hermes request cannot be queued.
Call ask_hermes once per distinct user request and do not retry an identical instruction. Never invent a session identifier.

# Results
After a successful tool result, answer naturally as Wave and summarize or confirm the outcome in speech-first language. Do not say "Hermes said" by default. Never claim an action succeeded until the tool result explicitly confirms it, and do not add facts beyond the result.
Explain tool failures briefly without claiming success, and let the user retry.`,
    max_output_tokens: 1_024,
    model: config.model,
    output_modalities: ['audio'],
    parallel_tool_calls: true,
    reasoning: {
      effort: 'low',
    },
    tool_choice: 'auto',
    tools: [
      {
        description:
          "Delegate work to the user's already-authorized Hermes execution and reasoning backend. " +
          'Use for external or current information, private or user-specific context, device or ' +
          'service control, durable work, or substantial reasoning. Do not use for greetings, ' +
          'lightweight conversation, clarification, or simple computations. Provide a clear, ' +
          "self-contained instruction that preserves the user's intent, scope, constraints, " +
          'identifiers, quoted text, and literal values without broadening the action or inventing ' +
          'details. Submit each distinct request once, including new requests made while earlier ' +
          'work is still running; Wave queues them safely.',
        name: 'ask_hermes',
        parameters: z.toJSONSchema(WaveAskHermesArgumentsSchema),
        type: 'function',
      },
    ],
    tracing: null,
    type: 'realtime',
  };
}

function normalizeOpenAIError(error: unknown) {
  if (error instanceof RealtimeProviderError) {
    return error;
  }
  if (error instanceof APIConnectionTimeoutError) {
    return new RealtimeProviderError(
      'OpenAI Realtime did not respond before the timeout.',
      {
        cause: error,
        kind: 'timeout',
        retryable: true,
      },
    );
  }
  if (error instanceof APIConnectionError) {
    return new RealtimeProviderError('Could not reach OpenAI Realtime.', {
      cause: error,
      kind: 'unavailable',
      retryable: true,
    });
  }
  if (error instanceof APIError) {
    if (error.status === 401 || error.status === 403) {
      return new RealtimeProviderError(
        'OpenAI Realtime rejected the server credential.',
        {
          cause: error,
          kind: 'authentication',
        },
      );
    }
    if (error.status === 429) {
      return new RealtimeProviderError('OpenAI Realtime is rate limited.', {
        cause: error,
        kind: 'rate_limited',
        retryable: true,
      });
    }
    return new RealtimeProviderError(
      'OpenAI Realtime could not create the call.',
      {
        cause: error,
        kind: 'unavailable',
        retryable: typeof error.status !== 'number' || error.status >= 500,
      },
    );
  }
  return new RealtimeProviderError(
    'OpenAI Realtime returned an invalid response.',
    {
      cause: error,
      kind: 'protocol',
    },
  );
}

function parseProviderCallId(location: string | null) {
  if (!location) {
    throw new RealtimeProviderError(
      'OpenAI Realtime omitted the call identifier.',
      { kind: 'protocol' },
    );
  }
  let url: URL;
  try {
    url = new URL(location, OPENAI_API_BASE_URL);
  } catch (error) {
    throw new RealtimeProviderError(
      'OpenAI Realtime returned an invalid call identifier.',
      { cause: error, kind: 'protocol' },
    );
  }
  const segments = url.pathname.split('/').filter(Boolean);
  const callId = segments.at(-1);
  if (
    url.search ||
    url.hash ||
    segments.slice(-3, -1).join('/') !== 'realtime/calls' ||
    !callId ||
    !OPENAI_CALL_ID_PATTERN.test(callId)
  ) {
    throw new RealtimeProviderError(
      'OpenAI Realtime returned an invalid call identifier.',
      { kind: 'protocol' },
    );
  }
  return callId;
}

async function readBoundedText(response: Response, maxBytes: number) {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new RealtimeProviderError(
      'OpenAI Realtime returned an oversized SDP answer.',
      { kind: 'protocol' },
    );
  }
  if (!response.body?.getReader) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength <= maxBytes) {
      return text;
    }
    throw oversizedSdpError();
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let byteLength = 0;
  let text = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      byteLength += chunk.value.byteLength;
      if (byteLength > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw oversizedSdpError();
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

function oversizedSdpError() {
  return new RealtimeProviderError(
    'OpenAI Realtime returned an oversized SDP answer.',
    { kind: 'protocol' },
  );
}
