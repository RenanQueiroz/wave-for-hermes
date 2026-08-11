/**
 * Realtime call setup directly against OpenAI with the user-owned key.
 * Implements the `RealtimeBackend` surface the controller consumes: one SDP
 * exchange to start (`POST /v1/realtime/calls`), a hangup to end, and the
 * ask_hermes sideband wired to the gateway connection through the trusted
 * dispatch rules in `AskHermesOrchestrator`.
 *
 * The key travels only in Authorization headers toward api.openai.com and is
 * never logged or included in errors.
 */
import {
  type WaveAskHermesToolResult,
  type WaveCorrectHermesToolResult,
  type WaveEndRealtimeCallResponse,
  type WaveRealtimeVoiceId,
  type WaveStartRealtimeCallResponse,
} from '@wave/contracts';
import { fetch as expoFetch } from 'expo/fetch';

import {
  AskHermesOrchestrator,
  type HermesExecutionLifecycle,
} from '../../features/realtime/ask-hermes-orchestrator.ts';
import type { RealtimeBackend } from '../../features/realtime/realtime-controller.ts';
import {
  isWaveRealtimeModelId,
  WAVE_REALTIME_DEFAULT_MODEL,
  type WaveRealtimeModelId,
} from './realtime-model-preference-record.ts';
import { WAVE_REALTIME_DEFAULT_VOICE } from './realtime-voice-preference-record.ts';
import { createRealtimeToolSurfaceSessionUpdate } from './realtime-prompt.ts';
import { OpenAiRealtimeSideband } from './openai-realtime-sideband.ts';

const OPENAI_CALLS_URL = 'https://api.openai.com/v1/realtime/calls';
const OPENAI_SIDEBAND_URL = 'wss://api.openai.com/v1/realtime';
const REQUEST_TIMEOUT_MS = 20_000;
const SIDEBAND_CONNECT_TIMEOUT_MS = 15_000;
const MAX_SDP_ANSWER_CHARS = 48_000;
/**
 * Client-side cap on a call's lifetime; the controller auto-stops at expiry.
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
    lifecycle: HermesExecutionLifecycle,
  ): Promise<WaveAskHermesToolResult>;
  executeCorrectHermes(
    instruction: string,
    signal: AbortSignal,
  ): Promise<WaveCorrectHermesToolResult>;
  fetchImpl?: typeof globalThis.fetch;
  model?: WaveRealtimeModelId;
  /** Opt-in paid captions of the user's speech; snapshotted per call. */
  transcribeInput?: boolean;
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
  private readonly executeCorrectHermes: OpenAiRealtimeBackendOptions['executeCorrectHermes'];
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly model: WaveRealtimeModelId;
  private readonly socketFactory: (url: string, apiKey: string) => WebSocket;
  private readonly transcribeInput: boolean;

  constructor(options: OpenAiRealtimeBackendOptions) {
    this.apiKey = options.apiKey;
    this.executeAskHermes = options.executeAskHermes;
    this.executeCorrectHermes = options.executeCorrectHermes;
    this.fetchImpl =
      options.fetchImpl ?? (expoFetch as unknown as typeof globalThis.fetch);
    const model = options.model ?? WAVE_REALTIME_DEFAULT_MODEL;
    if (!isWaveRealtimeModelId(model)) {
      throw new OpenAiRealtimeBackendError(
        'Wave does not support that Realtime model.',
        { kind: 'model_unavailable' },
      );
    }
    // A backend snapshots one app-validated model for its entire lifetime.
    // Settings changes therefore apply only after a new backend/call exists.
    this.model = model;
    this.transcribeInput = options.transcribeInput === true;
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
      JSON.stringify(
        createOpenAiRealtimeSessionConfig(
          this.model,
          voiceId ?? WAVE_REALTIME_DEFAULT_VOICE,
          this.transcribeInput,
        ),
      ),
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
    if (
      response.status === 400 ||
      response.status === 404 ||
      response.status === 422
    ) {
      throw new OpenAiRealtimeBackendError(
        'OpenAI could not start Realtime with the selected model. Choose another model in Settings.',
        { kind: 'model_unavailable' },
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
      executeCorrection: this.executeCorrectHermes,
      isAuthorized: () => this.calls.has(callId),
      onActiveExecutionChange: (active) => {
        sideband.setHermesExecutionActive(active);
      },
      onProgress: (text) => {
        sideband.injectProgressNote(text);
      },
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

export function createOpenAiRealtimeSessionConfig(
  model: WaveRealtimeModelId,
  voice: WaveRealtimeVoiceId,
  transcribeInput = false,
) {
  if (!isWaveRealtimeModelId(model)) {
    throw new OpenAiRealtimeBackendError(
      'Wave does not support that Realtime model.',
      { kind: 'model_unavailable' },
    );
  }
  return {
    audio: {
      input: {
        noise_reduction: { type: 'near_field' },
        // Display-only live captions of the user's speech, opt-in from
        // Settings because transcription bills separately on the user's
        // key. gpt-transcribe transcribes each committed turn — exactly
        // the one final event Wave consumes — instead of streaming deltas
        // it would ignore. Nothing is stored; transcripts stay ephemeral.
        ...(transcribeInput
          ? { transcription: { model: 'gpt-transcribe' } }
          : {}),
        turn_detection: {
          create_response: true,
          interrupt_response: true,
          type: 'semantic_vad',
        },
      },
      output: { voice },
    },
    ...createRealtimeToolSurfaceSessionUpdate('idle'),
    max_output_tokens: 1_024,
    model,
    output_modalities: ['audio'],
    parallel_tool_calls: true,
    reasoning: { effort: 'low' },
    tracing: null,
  };
}
