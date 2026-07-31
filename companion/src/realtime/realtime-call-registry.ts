import { createHash, randomUUID } from 'node:crypto';

import {
  WAVE_MAX_ASK_HERMES_ANSWER_LENGTH,
  WaveAskHermesArgumentsSchema,
  WaveAskHermesToolResultSchema,
  WaveRealtimeVoiceIdSchema,
  type WaveAskHermesToolErrorCode,
  type WaveAskHermesToolResult,
  type WaveRealtimeVoiceId,
} from '@wave/contracts';

import type { DeviceStore } from '../auth/device-store.ts';
import type { HermesClient } from '../hermes/hermes-types.ts';
import { WaveHttpError } from '../http/errors.ts';
import type { InteractionStore } from '../interactions/interaction-store.ts';
import {
  RealtimeProviderError,
  type RealtimeAssistantTranscript,
  type RealtimeFunctionCall,
  type RealtimeProvider,
  type RealtimeProviderCall,
  type RealtimeUserTranscript,
} from './realtime-provider.ts';
import { WAVE_REALTIME_VOICE_OPTIONS } from './realtime-voices.ts';

const ASK_HERMES_TOOL_NAME = 'ask_hermes';
const MAX_TOOL_CALLS_PER_REALTIME_CALL = 128;
const MAX_OUTSTANDING_TOOL_CALLS_PER_REALTIME_CALL = 8;

interface ActiveRealtimeTool {
  callId: string;
  controller: AbortController;
}

interface RealtimeToolExecution {
  callIds: Set<string>;
  handoffId: string;
  instruction: string;
  primaryCallId: string;
  result?: WaveAskHermesToolResult;
  turnId: string;
}

interface HermesExecutionOutcome {
  hermesAssistantMessageId?: string;
  hermesAssistantMessageTimestamp?: number;
  result: WaveAskHermesToolResult;
}

interface RealtimeCallState {
  activeTool?: ActiveRealtimeTool;
  deviceId: string;
  expiresAt: Date;
  handoffTurnIds: Map<string, string>;
  handledToolCallIds: Set<string>;
  latestTurnId?: string;
  outstandingToolCalls: number;
  providerItemTurnIds: Map<string, string>;
  providerCall: RealtimeProviderCall;
  sessionId: string;
  timer: NodeJS.Timeout;
  toolQueue: Promise<void>;
  toolExecutionsByKey: Map<string, RealtimeToolExecution>;
  waveCallId: string;
}

export interface RealtimeCallRegistryConfig {
  callTtlMs: number;
  defaultVoiceId: WaveRealtimeVoiceId;
  maxActiveCalls: number;
  toolTimeoutMs: number;
}

export interface StartedRealtimeCall {
  expiresAt: string;
  id: string;
  sdpAnswer: string;
}

export class RealtimeCallRegistry {
  private readonly calls = new Map<string, RealtimeCallState>();
  private readonly config: RealtimeCallRegistryConfig;
  private readonly deletingSessionIds = new Set<string>();
  private readonly options: {
    createId?: () => string;
    now?: () => Date;
  };
  private readonly reservedDeviceIds = new Set<string>();
  private readonly reservedSessionIds = new Set<string>();
  private readonly services: {
    deviceStore: DeviceStore;
    hermesClient: HermesClient;
    interactionStore: InteractionStore;
    provider: RealtimeProvider;
  };

  constructor(
    config: RealtimeCallRegistryConfig,
    services: {
      deviceStore: DeviceStore;
      hermesClient: HermesClient;
      interactionStore: InteractionStore;
      provider: RealtimeProvider;
    },
    options: {
      createId?: () => string;
      now?: () => Date;
    } = {},
  ) {
    this.config = config;
    this.options = options;
    this.services = services;
  }

  async abortAll() {
    const calls = [...this.calls.values()];
    await Promise.allSettled(calls.map((call) => this.release(call, true)));
  }

  async abortDevice(deviceId: string) {
    const calls = [...this.calls.values()].filter(
      (call) => call.deviceId === deviceId,
    );
    await Promise.allSettled(calls.map((call) => this.release(call, true)));
  }

  async end(deviceId: string, waveCallId: string) {
    const call = this.calls.get(waveCallId);
    if (!call || call.deviceId !== deviceId) {
      throw new WaveHttpError('The active Wave Realtime call was not found.', {
        code: 'not_found',
        statusCode: 404,
      });
    }
    await this.release(call, true);
  }

  hasSession(sessionId: string) {
    if (this.reservedSessionIds.has(sessionId)) return true;
    for (const call of this.calls.values()) {
      if (call.sessionId === sessionId) return true;
    }
    return false;
  }

  getVoiceCatalog() {
    return {
      defaultVoiceId: this.config.defaultVoiceId,
      voices: WAVE_REALTIME_VOICE_OPTIONS,
    };
  }

  releaseSessionDeletion(sessionId: string) {
    this.deletingSessionIds.delete(sessionId);
  }

  reserveSessionDeletion(sessionId: string) {
    if (this.deletingSessionIds.has(sessionId) || this.hasSession(sessionId)) {
      return false;
    }
    this.deletingSessionIds.add(sessionId);
    return true;
  }

  async start(input: {
    deviceId: string;
    sdpOffer: string;
    sessionId: string;
    signal?: AbortSignal;
    voiceId?: WaveRealtimeVoiceId;
  }): Promise<StartedRealtimeCall> {
    if (this.deletingSessionIds.has(input.sessionId)) {
      throw new WaveHttpError('This Hermes session is being deleted.', {
        code: 'conflict',
        statusCode: 409,
      });
    }
    await this.requireAuthorizedSession(input.deviceId, input.sessionId);
    if (this.deletingSessionIds.has(input.sessionId)) {
      throw new WaveHttpError('This Hermes session is being deleted.', {
        code: 'conflict',
        statusCode: 409,
      });
    }
    this.reserve(input.deviceId, input.sessionId);

    let providerCall: RealtimeProviderCall;
    try {
      providerCall = await this.services.provider.createCall({
        safetyIdentifier: createSafetyIdentifier(input.deviceId),
        sdpOffer: input.sdpOffer,
        signal: input.signal,
        voice: WaveRealtimeVoiceIdSchema.parse(
          input.voiceId ?? this.config.defaultVoiceId,
        ),
      });
    } catch (error) {
      this.releaseReservation(input.deviceId, input.sessionId);
      throw normalizeProviderError(error);
    }

    if (!this.services.deviceStore.isDeviceActive(input.deviceId)) {
      this.releaseReservation(input.deviceId, input.sessionId);
      await providerCall.end().catch(() => undefined);
      throw new WaveHttpError(
        'This Wave device is no longer authorized for Realtime.',
        {
          code: 'unauthorized',
          statusCode: 401,
        },
      );
    }

    const now = this.options.now?.() ?? new Date();
    const waveCallId = this.options.createId?.() ?? randomUUID();
    const expiresAt = new Date(now.getTime() + this.config.callTtlMs);
    const call: RealtimeCallState = {
      deviceId: input.deviceId,
      expiresAt,
      handoffTurnIds: new Map(),
      handledToolCallIds: new Set(),
      outstandingToolCalls: 0,
      providerCall,
      providerItemTurnIds: new Map(),
      sessionId: input.sessionId,
      timer: setTimeout(() => {
        void this.release(call, true);
      }, this.config.callTtlMs),
      toolQueue: Promise.resolve(),
      toolExecutionsByKey: new Map(),
      waveCallId,
    };
    this.calls.set(waveCallId, call);
    providerCall.sideband.onClose(() => {
      void this.release(call, false);
    });
    providerCall.sideband.onError(() => {
      // Most Realtime error events are recoverable. The socket close event owns
      // cleanup if the sideband can no longer continue.
    });
    providerCall.sideband.onFunctionCall((toolCall) => {
      void this.handleFunctionCall(call, toolCall);
    });
    providerCall.sideband.onUserItem((itemId) => {
      try {
        this.ensureRealtimeTurn(call, itemId);
      } catch {
        // Persistence failure must not tear down an otherwise healthy call.
      }
    });
    providerCall.sideband.onUserTranscript((transcript) => {
      try {
        this.recordUserTranscript(call, transcript);
      } catch {
        // Finalized transcript capture is best effort while the call is active.
      }
    });
    providerCall.sideband.onAssistantTranscript((transcript) => {
      try {
        this.recordAssistantTranscript(call, transcript);
      } catch {
        // Finalized transcript capture is best effort while the call is active.
      }
    });

    return {
      expiresAt: expiresAt.toISOString(),
      id: waveCallId,
      sdpAnswer: providerCall.sdpAnswer,
    };
  }

  private completeToolCall(
    call: RealtimeCallState,
    toolCallId: string,
    result: WaveAskHermesToolResult,
    handoffId?: string,
  ) {
    if (this.calls.get(call.waveCallId) !== call) {
      return;
    }
    call.providerCall.sideband.sendFunctionResult(
      toolCallId,
      WaveAskHermesToolResultSchema.parse(result),
      handoffId,
    );
  }

  private async executeHermesTool(
    call: RealtimeCallState,
    instruction: string,
    controller: AbortController,
  ): Promise<HermesExecutionOutcome> {
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.config.toolTimeoutMs);
    let answer = '';
    let completedAnswer: string | undefined;
    let hermesAssistantMessageId: string | undefined;
    let hermesAssistantMessageTimestamp: number | undefined;
    let truncated = false;

    try {
      for await (const event of this.services.hermesClient.streamChat(
        call.sessionId,
        {
          input: instruction,
          signal: controller.signal,
        },
      )) {
        if (event.type === 'assistant.delta') {
          const available = WAVE_MAX_ASK_HERMES_ANSWER_LENGTH - answer.length;
          if (event.delta.length > available) {
            truncated = true;
          }
          if (available > 0) {
            answer += event.delta.slice(0, available);
          }
        } else if (event.type === 'assistant.completed') {
          hermesAssistantMessageId = event.messageId;
          hermesAssistantMessageTimestamp = event.timestamp;
          completedAnswer = event.content.slice(
            0,
            WAVE_MAX_ASK_HERMES_ANSWER_LENGTH,
          );
          truncated = event.content.length > WAVE_MAX_ASK_HERMES_ANSWER_LENGTH;
        } else if (event.type === 'error') {
          throw new Error('Hermes stream failed.');
        }
      }
    } catch {
      if (timedOut) {
        return {
          result: toolError(
            'timeout',
            'Hermes did not complete the request before the timeout.',
            true,
          ),
        };
      }
      if (controller.signal.aborted) {
        return {
          result: toolError(
            'cancelled',
            'The Hermes request was cancelled.',
            false,
          ),
        };
      }
      return {
        result: toolError(
          'upstream_unavailable',
          'Hermes could not complete the request.',
          true,
        ),
      };
    } finally {
      clearTimeout(timeout);
    }

    const finalAnswer = (completedAnswer ?? answer).trim();
    if (!finalAnswer) {
      return {
        result: toolError(
          'upstream_unavailable',
          'Hermes completed without returning an answer.',
          true,
        ),
      };
    }
    return {
      ...(hermesAssistantMessageId ? { hermesAssistantMessageId } : {}),
      ...(hermesAssistantMessageTimestamp === undefined
        ? {}
        : { hermesAssistantMessageTimestamp }),
      result: {
        answer: finalAnswer,
        ok: true,
        truncated,
      },
    };
  }

  private handleFunctionCall(
    call: RealtimeCallState,
    toolCall: RealtimeFunctionCall,
  ) {
    if (
      this.calls.get(call.waveCallId) !== call ||
      call.handledToolCallIds.has(toolCall.callId)
    ) {
      return;
    }
    if (call.handledToolCallIds.size >= MAX_TOOL_CALLS_PER_REALTIME_CALL) {
      this.completeToolCall(
        call,
        toolCall.callId,
        toolError(
          'busy',
          'This live voice call reached its tool-call limit.',
          false,
        ),
      );
      return;
    }
    call.handledToolCallIds.add(toolCall.callId);

    if (toolCall.name !== ASK_HERMES_TOOL_NAME) {
      this.completeToolCall(
        call,
        toolCall.callId,
        toolError(
          'unknown_tool',
          'Wave does not support the requested tool.',
          false,
        ),
      );
      return;
    }

    let rawArguments: unknown;
    try {
      rawArguments = JSON.parse(toolCall.arguments);
    } catch {
      rawArguments = undefined;
    }
    const parsed = WaveAskHermesArgumentsSchema.safeParse(rawArguments);
    if (!parsed.success) {
      this.completeToolCall(
        call,
        toolCall.callId,
        toolError(
          'invalid_arguments',
          'The ask_hermes arguments were invalid.',
          false,
        ),
      );
      return;
    }

    if (!this.isCallAuthorized(call)) {
      this.completeToolCall(
        call,
        toolCall.callId,
        toolError(
          'unauthorized',
          'This Wave call is no longer authorized for Hermes.',
          false,
        ),
      );
      return;
    }

    const executionKey = createToolExecutionKey(
      parsed.data.instruction,
      toolCall.userItemId,
    );
    const existingExecution = call.toolExecutionsByKey.get(executionKey);
    if (existingExecution) {
      existingExecution.callIds.add(toolCall.callId);
      if (existingExecution.result) {
        this.completeToolCall(
          call,
          toolCall.callId,
          existingExecution.result,
          existingExecution.handoffId,
        );
      }
      return;
    }

    if (
      call.outstandingToolCalls >= MAX_OUTSTANDING_TOOL_CALLS_PER_REALTIME_CALL
    ) {
      this.completeToolCall(
        call,
        toolCall.callId,
        toolError(
          'busy',
          'This live call has too many Hermes requests waiting.',
          true,
        ),
      );
      return;
    }

    const execution: RealtimeToolExecution = {
      callIds: new Set([toolCall.callId]),
      handoffId: '',
      instruction: parsed.data.instruction,
      primaryCallId: toolCall.callId,
      turnId: '',
    };
    try {
      execution.turnId = this.ensureRealtimeTurn(
        call,
        toolCall.userItemId ?? `tool:${toolCall.callId}`,
      );
      execution.handoffId = this.services.interactionStore.beginHandoff({
        createdAt: this.now().toISOString(),
        eventKey: createInteractionKey(
          call.waveCallId,
          'handoff',
          toolCall.callId,
        ),
        instruction: execution.instruction,
        sessionId: call.sessionId,
        turnId: execution.turnId,
      });
      call.handoffTurnIds.set(execution.handoffId, execution.turnId);
    } catch {
      this.completeToolCall(
        call,
        toolCall.callId,
        toolError(
          'upstream_unavailable',
          'Wave could not persist the Hermes request.',
          true,
        ),
      );
      return;
    }
    call.toolExecutionsByKey.set(executionKey, execution);
    call.outstandingToolCalls += 1;
    call.toolQueue = call.toolQueue
      .then(() => this.executeQueuedTool(call, execution))
      .catch(() => {
        this.completeToolExecution(
          call,
          execution,
          toolError(
            'upstream_unavailable',
            'Hermes could not complete the request.',
            true,
          ),
        );
      })
      .finally(() => {
        call.outstandingToolCalls -= 1;
      });
  }

  private async executeQueuedTool(
    call: RealtimeCallState,
    execution: RealtimeToolExecution,
  ) {
    if (this.calls.get(call.waveCallId) !== call) {
      return;
    }
    if (!this.isCallAuthorized(call)) {
      this.completeToolExecution(
        call,
        execution,
        toolError(
          'unauthorized',
          'This Wave call is no longer authorized for Hermes.',
          false,
        ),
      );
      return;
    }

    const activeTool: ActiveRealtimeTool = {
      callId: execution.primaryCallId,
      controller: new AbortController(),
    };
    call.activeTool = activeTool;
    let outcome: HermesExecutionOutcome;
    try {
      outcome = await this.executeHermesTool(
        call,
        execution.instruction,
        activeTool.controller,
      );
    } catch {
      outcome = {
        result: toolError(
          'upstream_unavailable',
          'Hermes could not complete the request.',
          true,
        ),
      };
    }
    if (
      this.calls.get(call.waveCallId) === call &&
      call.activeTool === activeTool
    ) {
      call.activeTool = undefined;
      this.completeToolExecution(
        call,
        execution,
        outcome.result,
        outcome.hermesAssistantMessageId,
        outcome.hermesAssistantMessageTimestamp,
      );
    }
  }

  private completeToolExecution(
    call: RealtimeCallState,
    execution: RealtimeToolExecution,
    result: WaveAskHermesToolResult,
    hermesAssistantMessageId?: string,
    hermesAssistantMessageTimestamp?: number,
  ) {
    if (execution.result) {
      return;
    }
    let deliveredResult = result;
    try {
      this.services.interactionStore.completeHandoff({
        completedAt: this.now().toISOString(),
        handoffId: execution.handoffId,
        ...(hermesAssistantMessageId ? { hermesAssistantMessageId } : {}),
        ...(hermesAssistantMessageTimestamp === undefined
          ? {}
          : { hermesAssistantMessageTimestamp }),
        result,
      });
    } catch {
      deliveredResult = toolError(
        'upstream_unavailable',
        'Wave could not persist the Hermes result.',
        true,
      );
      try {
        this.services.interactionStore.completeHandoff({
          completedAt: this.now().toISOString(),
          handoffId: execution.handoffId,
          result: deliveredResult,
        });
      } catch {
        // Keep the call usable even when durable interaction storage is down.
      }
    }
    execution.result = deliveredResult;
    for (const callId of execution.callIds) {
      this.completeToolCall(call, callId, deliveredResult, execution.handoffId);
    }
  }

  private ensureRealtimeTurn(call: RealtimeCallState, providerItemId: string) {
    const existing = call.providerItemTurnIds.get(providerItemId);
    if (existing) {
      call.latestTurnId = existing;
      return existing;
    }
    const turnId = this.services.interactionStore.beginRealtimeTurn({
      createdAt: this.now().toISOString(),
      eventKey: createInteractionKey(
        call.waveCallId,
        'user_item',
        providerItemId,
      ),
      sessionId: call.sessionId,
    });
    call.providerItemTurnIds.set(providerItemId, turnId);
    call.latestTurnId = turnId;
    return turnId;
  }

  private now() {
    return this.options.now?.() ?? new Date();
  }

  private recordAssistantTranscript(
    call: RealtimeCallState,
    transcript: RealtimeAssistantTranscript,
  ) {
    if (this.calls.get(call.waveCallId) !== call) {
      return;
    }
    const content = boundedTranscript(transcript.transcript);
    if (!content) {
      return;
    }
    const handoffTurnId = transcript.handoffIds
      .map((handoffId) => call.handoffTurnIds.get(handoffId))
      .find((turnId) => turnId !== undefined);
    const turnId =
      handoffTurnId ??
      (transcript.userItemId
        ? this.ensureRealtimeTurn(call, transcript.userItemId)
        : call.latestTurnId);
    if (!turnId) {
      return;
    }
    this.services.interactionStore.recordWaveMessage({
      content,
      createdAt: this.now().toISOString(),
      eventKey: createInteractionKey(
        call.waveCallId,
        'assistant_response',
        transcript.responseId,
      ),
      sessionId: call.sessionId,
      turnId,
    });
  }

  private recordUserTranscript(
    call: RealtimeCallState,
    transcript: RealtimeUserTranscript,
  ) {
    if (this.calls.get(call.waveCallId) !== call) {
      return;
    }
    const content = boundedTranscript(transcript.transcript);
    if (!content) {
      return;
    }
    const turnId = this.ensureRealtimeTurn(call, transcript.itemId);
    this.services.interactionStore.recordUserTranscript({
      transcript: content,
      turnId,
      updatedAt: this.now().toISOString(),
    });
  }

  private isCallAuthorized(call: RealtimeCallState) {
    return this.services.deviceStore.isDeviceActive(call.deviceId);
  }

  private async release(call: RealtimeCallState, endProviderCall: boolean) {
    if (this.calls.get(call.waveCallId) !== call) {
      return;
    }
    this.calls.delete(call.waveCallId);
    this.releaseReservation(call.deviceId, call.sessionId);
    clearTimeout(call.timer);
    for (const execution of call.toolExecutionsByKey.values()) {
      if (!execution.result) {
        this.completeToolExecution(
          call,
          execution,
          toolError(
            'cancelled',
            'The Hermes request was cancelled when the live call ended.',
            false,
          ),
        );
      }
    }
    call.activeTool?.controller.abort();
    call.activeTool = undefined;
    if (endProviderCall) {
      await call.providerCall.end();
    }
  }

  private releaseReservation(deviceId: string, sessionId: string) {
    this.reservedDeviceIds.delete(deviceId);
    this.reservedSessionIds.delete(sessionId);
  }

  private async requireAuthorizedSession(deviceId: string, sessionId: string) {
    if (!this.services.deviceStore.isDeviceActive(deviceId)) {
      throw new WaveHttpError('The Hermes session was not found.', {
        code: 'not_found',
        statusCode: 404,
      });
    }
    await this.services.hermesClient.getSession(sessionId);
  }

  private reserve(deviceId: string, sessionId: string) {
    if (this.reservedDeviceIds.size >= this.config.maxActiveCalls) {
      throw new WaveHttpError(
        'Wave Companion is already handling its maximum number of live calls.',
        {
          code: 'rate_limited',
          retryable: true,
          statusCode: 429,
        },
      );
    }
    if (this.reservedDeviceIds.has(deviceId)) {
      throw new WaveHttpError(
        'This Wave device already has an active live call.',
        {
          code: 'conflict',
          statusCode: 409,
        },
      );
    }
    if (this.reservedSessionIds.has(sessionId)) {
      throw new WaveHttpError(
        'This Hermes session already has an active live call.',
        {
          code: 'conflict',
          statusCode: 409,
        },
      );
    }
    this.reservedDeviceIds.add(deviceId);
    this.reservedSessionIds.add(sessionId);
  }
}

function createSafetyIdentifier(deviceId: string) {
  return createHash('sha256').update(deviceId, 'utf8').digest('hex');
}

function createInteractionKey(
  waveCallId: string,
  kind: string,
  providerIdentifier: string,
) {
  return createHash('sha256')
    .update(waveCallId, 'utf8')
    .update('\0')
    .update(kind, 'utf8')
    .update('\0')
    .update(providerIdentifier, 'utf8')
    .digest('hex');
}

function createToolExecutionKey(
  instruction: string,
  userItemId: string | undefined,
) {
  return userItemId ? `${userItemId}\0${instruction}` : instruction;
}

function boundedTranscript(value: string) {
  return value.trim().slice(0, 128_000);
}

function normalizeProviderError(error: unknown) {
  if (!(error instanceof RealtimeProviderError)) {
    return new WaveHttpError(
      'OpenAI Realtime could not create the live call.',
      {
        code: 'upstream_unavailable',
        retryable: true,
        statusCode: 503,
      },
    );
  }
  switch (error.kind) {
    case 'rate_limited':
      return new WaveHttpError('OpenAI Realtime is rate limited.', {
        code: 'rate_limited',
        retryable: true,
        statusCode: 429,
      });
    case 'timeout':
      return new WaveHttpError(
        'OpenAI Realtime did not create the call before the timeout.',
        {
          code: 'timeout',
          retryable: true,
          statusCode: 504,
        },
      );
    case 'authentication':
    case 'protocol':
    case 'unavailable':
      return new WaveHttpError(
        'OpenAI Realtime could not create the live call.',
        {
          code: 'upstream_unavailable',
          retryable: error.retryable,
          statusCode: 503,
        },
      );
  }
}

function toolError(
  code: WaveAskHermesToolErrorCode,
  message: string,
  retryable: boolean,
): WaveAskHermesToolResult {
  return WaveAskHermesToolResultSchema.parse({
    error: {
      code,
      message,
      retryable,
    },
    ok: false,
  });
}
