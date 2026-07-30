import {
  WaveAskHermesArgumentsSchema,
  WaveAskHermesToolResultSchema,
  WaveRealtimeSdpSchema,
  type WaveAskHermesToolResult,
} from '@wave/contracts';
import OpenAI, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
} from 'openai';
import type { RealtimeSessionCreateRequest } from 'openai/resources/realtime/realtime';
import { OpenAIRealtimeWebSocket } from 'openai/realtime/websocket';
import { z } from 'zod';

import type { OpenAIRealtimeConfig } from '../config.ts';
import {
  RealtimeProviderError,
  type RealtimeFunctionCall,
  type RealtimeProvider,
  type RealtimeProviderCall,
  type RealtimeSideband,
} from './realtime-provider.ts';

const OPENAI_API_BASE_URL = 'https://api.openai.com/v1';
const OPENAI_REALTIME_CALL_PATH = '/realtime/calls';
const OPENAI_CALL_ID_PATTERN = /^rtc_[A-Za-z0-9_-]{1,256}$/;

const RealtimeFunctionCallSchema = z
  .object({
    arguments: z.string().max(64_000),
    call_id: z.string().min(1).max(300),
    name: z.string().min(1).max(100),
    type: z.literal('function_call'),
  })
  .passthrough();

export class OpenAIRealtimeProvider implements RealtimeProvider {
  private readonly client: OpenAI;
  private readonly config: OpenAIRealtimeConfig;

  constructor(
    config: OpenAIRealtimeConfig,
    options: {
      client?: OpenAI;
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
  }

  async createCall(input: {
    safetyIdentifier: string;
    sdpOffer: string;
    signal?: AbortSignal;
  }): Promise<RealtimeProviderCall> {
    const form = new FormData();
    form.set(
      'sdp',
      new Blob([input.sdpOffer], { type: 'application/sdp' }),
      'offer.sdp',
    );
    form.set(
      'session',
      new Blob([JSON.stringify(createSessionConfig(this.config))], {
        type: 'application/json',
      }),
      'session.json',
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

    const providerCallId = parseProviderCallId(response.headers.get('location'));
    let sdpAnswer: string;
    try {
      if (
        response.status !== 201 ||
        !response.headers
          .get('content-type')
          ?.toLowerCase()
          .startsWith('application/sdp')
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
      sideband = new OpenAIRealtimeSideband(
        new OpenAIRealtimeWebSocket(
          { callID: providerCallId },
          this.client,
        ),
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
  private closed = false;
  private readonly closeListeners = new Set<() => void>();
  private readonly errorListeners =
    new Set<(error: RealtimeProviderError) => void>();
  private readonly functionCallListeners =
    new Set<(call: RealtimeFunctionCall) => void>();
  private readonly realtime: OpenAIRealtimeWebSocket;

  constructor(realtime: OpenAIRealtimeWebSocket) {
    this.realtime = realtime;
    realtime.on('response.done', (event) => {
      for (const output of event.response.output ?? []) {
        if (output.type !== 'function_call') {
          continue;
        }
        const parsed = RealtimeFunctionCallSchema.safeParse(output);
        if (!parsed.success) {
          this.emitError(
            new RealtimeProviderError(
              'OpenAI Realtime sent an invalid function call.',
              { kind: 'protocol' },
            ),
          );
          this.close();
          return;
        }
        for (const listener of this.functionCallListeners) {
          listener({
            arguments: parsed.data.arguments,
            callId: parsed.data.call_id,
            name: parsed.data.name,
          });
        }
      }
    });
    realtime.on('error', () => {
      this.emitError(
        new RealtimeProviderError(
          'OpenAI Realtime reported a sideband error.',
          {
            kind: 'unavailable',
            retryable: true,
          },
        ),
      );
    });
    realtime.socket.addEventListener('close', () => {
      this.markClosed();
    });
    realtime.socket.addEventListener('error', () => {
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
      this.realtime.close({
        code: 1000,
        reason: 'Wave call ended',
      });
      this.markClosed();
    }
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

  sendFunctionResult(
    callId: string,
    result: WaveAskHermesToolResult,
  ) {
    if (
      this.closed ||
      this.realtime.socket.readyState !== WebSocket.OPEN
    ) {
      return false;
    }
    const output = JSON.stringify(
      WaveAskHermesToolResultSchema.parse(result),
    );
    this.realtime.send({
      item: {
        call_id: callId,
        output,
        type: 'function_call_output',
      },
      type: 'conversation.item.create',
    });
    this.realtime.send({
      type: 'response.create',
    });
    return true;
  }

  async waitUntilOpen(timeoutMs: number, signal?: AbortSignal) {
    if (this.realtime.socket.readyState === WebSocket.OPEN) {
      return;
    }
    if (this.closed || this.realtime.socket.readyState === WebSocket.CLOSED) {
      throw new RealtimeProviderError(
        'OpenAI Realtime closed before the sideband connected.',
        {
          kind: 'unavailable',
          retryable: true,
        },
      );
    }

    await new Promise<void>((resolve, reject) => {
      const socket = this.realtime.socket;
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
        socket.removeEventListener('close', onClose);
        socket.removeEventListener('error', onError);
        socket.removeEventListener('open', onOpen);
      };

      if (signal?.aborted) {
        onAbort();
        return;
      }
      signal?.addEventListener('abort', onAbort, { once: true });
      socket.addEventListener('close', onClose, { once: true });
      socket.addEventListener('error', onError, { once: true });
      socket.addEventListener('open', onOpen, { once: true });
    });
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

function createSessionConfig(
  config: OpenAIRealtimeConfig,
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
        voice: config.voice,
      },
    },
    instructions:
      'You are Wave, a concise live voice interface to the user’s Hermes agent. ' +
      'Use ask_hermes whenever the user asks Hermes to answer a question or perform work. ' +
      'Preserve the user’s intent in the instruction, never invent a session identifier, ' +
      'and do not claim Hermes completed work until the tool result confirms it. ' +
      'Explain tool failures briefly and let the user retry.',
    max_output_tokens: 1_024,
    model: config.model,
    output_modalities: ['audio'],
    parallel_tool_calls: false,
    reasoning: {
      effort: 'low',
    },
    tool_choice: 'auto',
    tools: [
      {
        description:
          'Ask the user’s already-authorized Hermes agent to answer or perform work. ' +
          'Pass only the complete instruction the user intends for Hermes.',
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
    return new RealtimeProviderError(
      'Could not reach OpenAI Realtime.',
      {
        cause: error,
        kind: 'unavailable',
        retryable: true,
      },
    );
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
      return new RealtimeProviderError(
        'OpenAI Realtime is rate limited.',
        {
          cause: error,
          kind: 'rate_limited',
          retryable: true,
        },
      );
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
