/**
 * Realtime call setup directly against OpenAI with the user-owned key —
 * the stage-4 replacement for the companion's call routes. Implements the
 * same `RealtimeBackend` surface the controller already consumes: one SDP
 * exchange to start (`POST /v1/realtime/calls`, exactly the call the
 * companion made server-side), a hangup to end, and the ask_hermes sideband
 * wired to the gateway connection through the ported safety rules.
 *
 * The key travels only in Authorization headers toward api.openai.com and is
 * never logged or included in errors.
 */
import {
  WAVE_MAX_ASK_HERMES_INSTRUCTION_LENGTH,
  type WaveEndRealtimeCallResponse,
  type WaveRealtimeVoiceId,
  type WaveStartRealtimeCallResponse,
} from '@wave/contracts';
import { fetch as expoFetch } from 'expo/fetch';

import {
  AskHermesOrchestrator,
  ASK_HERMES_TOOL_NAME,
} from '@/features/realtime/ask-hermes-orchestrator';
import { OpenAiRealtimeSideband } from './openai-realtime-sideband';
import type { RealtimeBackend } from '@/features/realtime/realtime-controller';
import type { WaveAskHermesToolResult } from '@wave/contracts';

const OPENAI_CALLS_URL = 'https://api.openai.com/v1/realtime/calls';
const OPENAI_SIDEBAND_URL = 'wss://api.openai.com/v1/realtime';
export const OPENAI_REALTIME_DEFAULT_MODEL = 'gpt-realtime-2.1-mini';
const REQUEST_TIMEOUT_MS = 20_000;
const SIDEBAND_CONNECT_TIMEOUT_MS = 15_000;
const MAX_SDP_ANSWER_CHARS = 48_000;
/**
 * Client-side cap on a call's lifetime; the controller auto-stops at expiry.
 * The companion enforced the same bound server-side.
 */
const CALL_LIFETIME_MS = 30 * 60_000;

export class OpenAiRealtimeBackendError extends Error {
  readonly kind: string;
  readonly retryable: boolean;
  constructor(message: string, options: { kind: string; retryable?: boolean }) {
    super(message);
    this.name = 'OpenAiRealtimeBackendError';
    this.kind = options.kind;
    this.retryable = options.retryable ?? false;
  }
}

export interface OpenAiRealtimeBackendOptions {
  apiKey: string;
  executeAskHermes(
    instruction: string,
    signal: AbortSignal,
  ): Promise<WaveAskHermesToolResult>;
  fetchImpl?: typeof globalThis.fetch;
  model?: string;
  socketFactory?: (url: string, apiKey: string) => WebSocket;
}

interface ActiveCall {
  orchestrator: AskHermesOrchestrator;
  sideband: OpenAiRealtimeSideband;
}

export class OpenAiRealtimeBackend implements RealtimeBackend {
  private readonly apiKey: string;
  private readonly calls = new Map<string, ActiveCall>();
  private readonly executeAskHermes: OpenAiRealtimeBackendOptions['executeAskHermes'];
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly model: string;
  private readonly socketFactory: (url: string, apiKey: string) => WebSocket;

  constructor(options: OpenAiRealtimeBackendOptions) {
    this.apiKey = options.apiKey;
    this.executeAskHermes = options.executeAskHermes;
    this.fetchImpl =
      options.fetchImpl ?? (expoFetch as unknown as typeof globalThis.fetch);
    this.model = options.model ?? OPENAI_REALTIME_DEFAULT_MODEL;
    this.socketFactory =
      options.socketFactory ??
      ((url, apiKey) => {
        // React Native's WebSocket accepts per-connection headers as a third
        // argument (absent from the DOM typings); the key never appears in
        // the URL.
        const SocketWithOptions = WebSocket as unknown as new (
          url: string,
          protocols?: string[] | null,
          options?: { headers?: Record<string, string> },
        ) => WebSocket;
        return new SocketWithOptions(url, null, {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
      });
  }

  async startRealtimeCall(
    _sessionId: string,
    sdpOffer: string,
    voiceId?: WaveRealtimeVoiceId,
    signal?: AbortSignal,
  ): Promise<WaveStartRealtimeCallResponse> {
    const form = new FormData();
    form.append('sdp', sdpOffer);
    form.append(
      'session',
      JSON.stringify(createSessionConfig(this.model, voiceId ?? 'marin')),
    );

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    let response: Response;
    try {
      response = await this.fetchImpl(OPENAI_CALLS_URL, {
        body: form as unknown as BodyInit,
        headers: { Authorization: `Bearer ${this.apiKey}` },
        method: 'POST',
        signal: controller.signal,
      });
    } catch {
      throw new OpenAiRealtimeBackendError(
        signal?.aborted
          ? 'The live call setup was cancelled.'
          : 'Wave could not reach OpenAI Realtime.',
        { kind: signal?.aborted ? 'cancelled' : 'connection', retryable: true },
      );
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }

    if (response.status === 401 || response.status === 403) {
      throw new OpenAiRealtimeBackendError(
        'OpenAI rejected the saved key. Check it in Settings.',
        { kind: 'unauthorized' },
      );
    }
    if (!response.ok) {
      throw new OpenAiRealtimeBackendError(
        'OpenAI Realtime could not start the call.',
        { kind: 'connection', retryable: response.status >= 500 },
      );
    }

    const callId = parseCallId(response.headers.get('location'));
    const sdpAnswer = (await response.text()).slice(0, MAX_SDP_ANSWER_CHARS);
    if (!callId || !sdpAnswer.startsWith('v=')) {
      throw new OpenAiRealtimeBackendError(
        'OpenAI Realtime returned an invalid call response.',
        { kind: 'protocol' },
      );
    }

    const sidebandUrl = new URL(OPENAI_SIDEBAND_URL);
    sidebandUrl.searchParams.set('call_id', callId);
    const sideband = new OpenAiRealtimeSideband(
      this.socketFactory(sidebandUrl.toString(), this.apiKey),
    );
    try {
      await sideband.waitUntilOpen(SIDEBAND_CONNECT_TIMEOUT_MS, signal);
    } catch (error) {
      sideband.close();
      await this.hangUp(callId);
      throw new OpenAiRealtimeBackendError(
        error instanceof Error
          ? error.message
          : 'Wave could not connect the Realtime sideband.',
        { kind: 'connection', retryable: true },
      );
    }

    const orchestrator = new AskHermesOrchestrator({
      deliver: (toolCallId, result) => {
        sideband.sendFunctionResult(toolCallId, result);
      },
      execute: this.executeAskHermes,
      isAuthorized: () => this.calls.has(callId),
    });
    // The session binding is trusted call state: tool calls run against the
    // conversation this call was started from, never a model-chosen session.
    this.calls.set(callId, { orchestrator, sideband });
    sideband.onFunctionCall((toolCall) =>
      orchestrator.handleToolCall(toolCall),
    );
    sideband.onClose(() => {
      const active = this.calls.get(callId);
      if (active) active.orchestrator.abort();
    });

    return {
      apiVersion: 'v1',
      call: {
        expiresAt: new Date(Date.now() + CALL_LIFETIME_MS).toISOString(),
        id: callId,
        sdpAnswer,
      },
    };
  }

  async endRealtimeCall(
    callId: string,
    _signal?: AbortSignal,
  ): Promise<WaveEndRealtimeCallResponse> {
    const active = this.calls.get(callId);
    this.calls.delete(callId);
    active?.orchestrator.abort();
    active?.sideband.close();
    await this.hangUp(callId);
    return { apiVersion: 'v1', callId, status: 'ended' };
  }

  private async hangUp(callId: string) {
    try {
      await this.fetchImpl(
        `${OPENAI_CALLS_URL}/${encodeURIComponent(callId)}/hangup`,
        {
          headers: { Authorization: `Bearer ${this.apiKey}` },
          method: 'POST',
        },
      );
    } catch {
      // Ending is idempotent from Wave's perspective; the peer or the API may
      // already have closed the call.
    }
  }
}

function parseCallId(location: string | null): string | undefined {
  if (!location) return undefined;
  const segment = location.split('/').filter(Boolean).at(-1);
  return segment && segment.length <= 200 ? segment : undefined;
}

function createSessionConfig(model: string, voice: WaveRealtimeVoiceId) {
  return {
    audio: {
      input: {
        noise_reduction: { type: 'near_field' },
        turn_detection: {
          create_response: true,
          interrupt_response: true,
          type: 'semantic_vad',
        },
      },
      output: { voice },
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
    model,
    output_modalities: ['audio'],
    parallel_tool_calls: true,
    reasoning: { effort: 'low' },
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
        name: ASK_HERMES_TOOL_NAME,
        parameters: {
          additionalProperties: false,
          properties: {
            instruction: {
              maxLength: WAVE_MAX_ASK_HERMES_INSTRUCTION_LENGTH,
              minLength: 1,
              type: 'string',
            },
          },
          required: ['instruction'],
          type: 'object',
        },
        type: 'function',
      },
    ],
    tracing: null,
    type: 'realtime',
  };
}
