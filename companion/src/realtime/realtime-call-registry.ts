import { createHash, randomUUID } from 'node:crypto';

import {
  WAVE_MAX_ASK_HERMES_ANSWER_LENGTH,
  WaveAskHermesArgumentsSchema,
  WaveAskHermesToolResultSchema,
  type WaveAskHermesToolErrorCode,
  type WaveAskHermesToolResult,
} from '@wave/contracts';

import type { DeviceStore } from '../auth/device-store.ts';
import type { HermesClient } from '../hermes/hermes-types.ts';
import { WaveHttpError } from '../http/errors.ts';
import {
  RealtimeProviderError,
  type RealtimeFunctionCall,
  type RealtimeProvider,
  type RealtimeProviderCall,
} from './realtime-provider.ts';

const ASK_HERMES_TOOL_NAME = 'ask_hermes';
const MAX_TOOL_CALLS_PER_REALTIME_CALL = 128;
const MAX_OUTSTANDING_TOOL_CALLS_PER_REALTIME_CALL = 8;

interface ActiveRealtimeTool {
  callId: string;
  controller: AbortController;
}

interface RealtimeCallState {
  activeTool?: ActiveRealtimeTool;
  deviceId: string;
  expiresAt: Date;
  handledToolCallIds: Set<string>;
  outstandingToolCalls: number;
  providerCall: RealtimeProviderCall;
  sessionId: string;
  timer: NodeJS.Timeout;
  toolQueue: Promise<void>;
  waveCallId: string;
}

export interface RealtimeCallRegistryConfig {
  callTtlMs: number;
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
  private readonly options: {
    createId?: () => string;
    now?: () => Date;
  };
  private readonly reservedDeviceIds = new Set<string>();
  private readonly reservedSessionIds = new Set<string>();
  private readonly services: {
    deviceStore: DeviceStore;
    hermesClient: HermesClient;
    provider: RealtimeProvider;
  };

  constructor(
    config: RealtimeCallRegistryConfig,
    services: {
      deviceStore: DeviceStore;
      hermesClient: HermesClient;
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
    await Promise.allSettled(
      calls.map((call) => this.release(call, true)),
    );
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

  async start(input: {
    deviceId: string;
    sdpOffer: string;
    sessionId: string;
    signal?: AbortSignal;
  }): Promise<StartedRealtimeCall> {
    this.requireAuthorizedSession(input.deviceId, input.sessionId);
    this.reserve(input.deviceId, input.sessionId);

    let providerCall: RealtimeProviderCall;
    try {
      providerCall = await this.services.provider.createCall({
        safetyIdentifier: createSafetyIdentifier(input.deviceId),
        sdpOffer: input.sdpOffer,
        signal: input.signal,
      });
    } catch (error) {
      this.releaseReservation(input.deviceId, input.sessionId);
      throw normalizeProviderError(error);
    }

    const now = this.options.now?.() ?? new Date();
    const waveCallId = this.options.createId?.() ?? randomUUID();
    const expiresAt = new Date(now.getTime() + this.config.callTtlMs);
    const call: RealtimeCallState = {
      deviceId: input.deviceId,
      expiresAt,
      handledToolCallIds: new Set(),
      outstandingToolCalls: 0,
      providerCall,
      sessionId: input.sessionId,
      timer: setTimeout(() => {
        void this.release(call, true);
      }, this.config.callTtlMs),
      toolQueue: Promise.resolve(),
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
  ) {
    if (this.calls.get(call.waveCallId) !== call) {
      return;
    }
    call.providerCall.sideband.sendFunctionResult(
      toolCallId,
      WaveAskHermesToolResultSchema.parse(result),
    );
  }

  private async executeHermesTool(
    call: RealtimeCallState,
    instruction: string,
    controller: AbortController,
  ): Promise<WaveAskHermesToolResult> {
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.config.toolTimeoutMs);
    let answer = '';
    let completedAnswer: string | undefined;
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
          const available =
            WAVE_MAX_ASK_HERMES_ANSWER_LENGTH - answer.length;
          if (event.delta.length > available) {
            truncated = true;
          }
          if (available > 0) {
            answer += event.delta.slice(0, available);
          }
        } else if (event.type === 'assistant.completed') {
          completedAnswer = event.content.slice(
            0,
            WAVE_MAX_ASK_HERMES_ANSWER_LENGTH,
          );
          truncated =
            event.content.length > WAVE_MAX_ASK_HERMES_ANSWER_LENGTH;
        } else if (event.type === 'error') {
          throw new Error('Hermes stream failed.');
        }
      }
    } catch {
      if (timedOut) {
        return toolError(
          'timeout',
          'Hermes did not complete the request before the timeout.',
          true,
        );
      }
      if (controller.signal.aborted) {
        return toolError(
          'cancelled',
          'The Hermes request was cancelled.',
          false,
        );
      }
      return toolError(
        'upstream_unavailable',
        'Hermes could not complete the request.',
        true,
      );
    } finally {
      clearTimeout(timeout);
    }

    const finalAnswer = (completedAnswer ?? answer).trim();
    if (!finalAnswer) {
      return toolError(
        'upstream_unavailable',
        'Hermes completed without returning an answer.',
        true,
      );
    }
    return {
      answer: finalAnswer,
      ok: true,
      truncated,
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
    if (
      call.handledToolCallIds.size >= MAX_TOOL_CALLS_PER_REALTIME_CALL
    ) {
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

    if (
      call.outstandingToolCalls >=
      MAX_OUTSTANDING_TOOL_CALLS_PER_REALTIME_CALL
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

    call.outstandingToolCalls += 1;
    call.toolQueue = call.toolQueue
      .then(() =>
        this.executeQueuedTool(
          call,
          toolCall.callId,
          parsed.data.instruction,
        ),
      )
      .catch(() => {
        this.completeToolCall(
          call,
          toolCall.callId,
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
    toolCallId: string,
    instruction: string,
  ) {
    if (this.calls.get(call.waveCallId) !== call) {
      return;
    }
    if (!this.isCallAuthorized(call)) {
      this.completeToolCall(
        call,
        toolCallId,
        toolError(
          'unauthorized',
          'This Wave call is no longer authorized for Hermes.',
          false,
        ),
      );
      return;
    }

    const activeTool: ActiveRealtimeTool = {
      callId: toolCallId,
      controller: new AbortController(),
    };
    call.activeTool = activeTool;
    let result: WaveAskHermesToolResult;
    try {
      result = await this.executeHermesTool(
        call,
        instruction,
        activeTool.controller,
      );
    } catch {
      result = toolError(
        'upstream_unavailable',
        'Hermes could not complete the request.',
        true,
      );
    }
    if (
      this.calls.get(call.waveCallId) === call &&
      call.activeTool === activeTool
    ) {
      call.activeTool = undefined;
      this.completeToolCall(call, toolCallId, result);
    }
  }

  private isCallAuthorized(call: RealtimeCallState) {
    return (
      this.services.deviceStore.isDeviceActive(call.deviceId) &&
      this.services.deviceStore.hasSession(
        call.deviceId,
        call.sessionId,
      )
    );
  }

  private async release(call: RealtimeCallState, endProviderCall: boolean) {
    if (this.calls.get(call.waveCallId) !== call) {
      return;
    }
    this.calls.delete(call.waveCallId);
    this.releaseReservation(call.deviceId, call.sessionId);
    clearTimeout(call.timer);
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

  private requireAuthorizedSession(deviceId: string, sessionId: string) {
    if (
      !this.services.deviceStore.isDeviceActive(deviceId) ||
      !this.services.deviceStore.hasSession(deviceId, sessionId)
    ) {
      throw new WaveHttpError('The Hermes session was not found.', {
        code: 'not_found',
        statusCode: 404,
      });
    }
  }

  private reserve(deviceId: string, sessionId: string) {
    if (
      this.reservedDeviceIds.size >= this.config.maxActiveCalls
    ) {
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
  return createHash('sha256')
    .update(deviceId, 'utf8')
    .digest('hex');
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
