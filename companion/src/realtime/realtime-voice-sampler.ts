import { createHash } from 'node:crypto';

import {
  WAVE_MAX_REALTIME_VOICE_SAMPLE_BYTES,
  type WaveRealtimeVoiceId,
} from '@wave/contracts';
import type { RealtimeResponseCreateParams } from 'openai/resources/realtime/realtime';
import WebSocket from 'ws';
import { z } from 'zod';

import type { OpenAIRealtimeConfig } from '../config.ts';
import { RealtimeProviderError } from './realtime-provider.ts';

const OPENAI_REALTIME_WEBSOCKET_URL = 'wss://api.openai.com/v1/realtime';
const MAX_SAMPLE_EVENT_BYTES = 2 * 1024 * 1024;
const SAMPLE_TOTAL_TIMEOUT_MS = 30_000;
const SAMPLE_RATE_HZ = 24_000;
const WAV_HEADER_BYTES = 44;
const MAX_SAMPLE_PCM_BYTES =
  WAVE_MAX_REALTIME_VOICE_SAMPLE_BYTES - WAV_HEADER_BYTES;
const SAMPLE_PHRASE =
  "Hi, I'm Wave. This is how I'll sound when we talk — ask me anything.";

type SampleSocketEvent = 'close' | 'error' | 'message' | 'open';
type SampleSocketListener = (...arguments_: unknown[]) => void;

export interface SampleSocket {
  close(code?: number, reason?: string): void;
  off(event: SampleSocketEvent, listener: SampleSocketListener): void;
  on(event: SampleSocketEvent, listener: SampleSocketListener): void;
  send(data: string): void;
}

interface SampleSocketFactoryInput {
  headers: Record<string, string>;
  timeoutMs: number;
  url: URL;
}

export type SampleSocketFactory = (
  input: SampleSocketFactoryInput,
) => SampleSocket;

export interface RealtimeVoiceSampleSource {
  readonly samplesVersion: string;
  getSample(voice: WaveRealtimeVoiceId): Promise<Buffer>;
}

const SampleAudioDeltaEventSchema = z
  .object({
    delta: z.string().max(MAX_SAMPLE_EVENT_BYTES),
    type: z.literal('response.output_audio.delta'),
  })
  .passthrough();
const SampleResponseDoneEventSchema = z
  .object({
    response: z
      .object({
        status: z.string().max(100).optional(),
      })
      .passthrough(),
    type: z.literal('response.done'),
  })
  .passthrough();

export class RealtimeVoiceSampler implements RealtimeVoiceSampleSource {
  readonly samplesVersion: string;
  private readonly config: OpenAIRealtimeConfig;
  private generationQueue: Promise<unknown> = Promise.resolve();
  private readonly samples = new Map<WaveRealtimeVoiceId, Promise<Buffer>>();
  private readonly socketFactory: SampleSocketFactory;

  constructor(
    config: OpenAIRealtimeConfig,
    options: { socketFactory?: SampleSocketFactory } = {},
  ) {
    this.config = config;
    this.socketFactory = options.socketFactory ?? createSampleSocket;
    // Samples change only when the configured Realtime model changes. Expose
    // that as an opaque token so no provider identifier crosses the Wave API.
    this.samplesVersion = createHash('sha256')
      .update(config.model)
      .digest('hex')
      .slice(0, 16);
  }

  getSample(voice: WaveRealtimeVoiceId): Promise<Buffer> {
    const cached = this.samples.get(voice);
    if (cached) {
      return cached;
    }
    // One generation at a time: a burst of preview taps queues instead of
    // opening one upstream Realtime session per voice concurrently.
    const generation = this.generationQueue
      .catch(() => undefined)
      .then(() => this.generateSample(voice));
    this.generationQueue = generation.catch(() => undefined);
    const entry = generation.catch((error: unknown) => {
      this.samples.delete(voice);
      throw error;
    });
    this.samples.set(voice, entry);
    return entry;
  }

  private generateSample(voice: WaveRealtimeVoiceId): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      const url = new URL(OPENAI_REALTIME_WEBSOCKET_URL);
      url.searchParams.set('model', this.config.model);
      let socket: SampleSocket;
      try {
        socket = this.socketFactory({
          headers: {
            Authorization: `Bearer ${this.config.apiKey}`,
          },
          timeoutMs: this.config.sidebandConnectTimeoutMs,
          url,
        });
      } catch (error) {
        reject(
          new RealtimeProviderError(
            'Could not connect to OpenAI Realtime for the voice sample.',
            { cause: error, kind: 'unavailable', retryable: true },
          ),
        );
        return;
      }

      const pcmChunks: Buffer[] = [];
      let pcmByteLength = 0;
      let settled = false;
      const timeout = setTimeout(() => {
        fail(
          new RealtimeProviderError(
            'OpenAI Realtime did not produce the voice sample in time.',
            { kind: 'timeout', retryable: true },
          ),
        );
      }, SAMPLE_TOTAL_TIMEOUT_MS);
      const settle = () => {
        settled = true;
        clearTimeout(timeout);
        socket.off('close', onClose);
        socket.off('error', onError);
        socket.off('message', onMessage);
        socket.off('open', onOpen);
        socket.close(1000, 'Wave sample finished');
      };
      const fail = (error: RealtimeProviderError) => {
        if (settled) return;
        settle();
        reject(error);
      };
      const finish = () => {
        if (settled) return;
        if (pcmByteLength === 0) {
          fail(
            new RealtimeProviderError(
              'OpenAI Realtime returned an empty voice sample.',
              { kind: 'protocol' },
            ),
          );
          return;
        }
        settle();
        resolve(wrapPcmInWav(Buffer.concat(pcmChunks), SAMPLE_RATE_HZ));
      };
      const onOpen = () => {
        try {
          socket.send(
            JSON.stringify({
              response: createSampleResponseParams(voice),
              type: 'response.create',
            }),
          );
        } catch {
          fail(
            new RealtimeProviderError(
              'Could not request the OpenAI Realtime voice sample.',
              { kind: 'unavailable', retryable: true },
            ),
          );
        }
      };
      const onError = () => {
        fail(
          new RealtimeProviderError(
            'Could not maintain the OpenAI Realtime sample connection.',
            { kind: 'unavailable', retryable: true },
          ),
        );
      };
      const onClose = () => {
        fail(
          new RealtimeProviderError(
            'OpenAI Realtime closed before the voice sample completed.',
            { kind: 'unavailable', retryable: true },
          ),
        );
      };
      const onMessage = (data: unknown, isBinary: unknown) => {
        const event = parseSampleEvent(data, isBinary === true);
        if (event === undefined) {
          fail(
            new RealtimeProviderError(
              'OpenAI Realtime sent an invalid sample event.',
              { kind: 'protocol' },
            ),
          );
          return;
        }
        if (event.type === 'error') {
          fail(
            new RealtimeProviderError(
              'OpenAI Realtime could not generate the voice sample.',
              { kind: 'unavailable', retryable: true },
            ),
          );
          return;
        }
        if (event.type === 'response.output_audio.delta') {
          const parsed = SampleAudioDeltaEventSchema.safeParse(event);
          if (!parsed.success) {
            fail(
              new RealtimeProviderError(
                'OpenAI Realtime sent invalid sample audio.',
                { kind: 'protocol' },
              ),
            );
            return;
          }
          const chunk = Buffer.from(parsed.data.delta, 'base64');
          pcmByteLength += chunk.byteLength;
          if (pcmByteLength > MAX_SAMPLE_PCM_BYTES) {
            fail(
              new RealtimeProviderError(
                'OpenAI Realtime returned an oversized voice sample.',
                { kind: 'protocol' },
              ),
            );
            return;
          }
          pcmChunks.push(chunk);
          return;
        }
        if (event.type === 'response.done') {
          const parsed = SampleResponseDoneEventSchema.safeParse(event);
          if (!parsed.success || parsed.data.response.status !== 'completed') {
            fail(
              new RealtimeProviderError(
                'OpenAI Realtime could not complete the voice sample.',
                { kind: 'unavailable', retryable: true },
              ),
            );
            return;
          }
          finish();
        }
      };

      socket.on('close', onClose);
      socket.on('error', onError);
      socket.on('message', onMessage);
      socket.on('open', onOpen);
    });
  }
}

function createSampleResponseParams(
  voice: WaveRealtimeVoiceId,
): RealtimeResponseCreateParams {
  return {
    audio: {
      output: {
        format: {
          rate: SAMPLE_RATE_HZ,
          type: 'audio/pcm',
        },
        voice,
      },
    },
    conversation: 'none',
    input: [
      {
        content: [
          {
            text: 'Introduce yourself in one short sentence.',
            type: 'input_text',
          },
        ],
        role: 'user',
        type: 'message',
      },
    ],
    instructions:
      'You are Wave, a friendly voice assistant. Say exactly, warmly and ' +
      `naturally: "${SAMPLE_PHRASE}" Do not say anything else.`,
    max_output_tokens: 500,
    output_modalities: ['audio'],
  };
}

function parseSampleEvent(data: unknown, isBinary: boolean) {
  if (isBinary) {
    return undefined;
  }
  let text: string;
  if (typeof data === 'string') {
    text = data;
  } else if (Buffer.isBuffer(data)) {
    text = data.toString('utf8');
  } else if (data instanceof ArrayBuffer) {
    text = Buffer.from(data).toString('utf8');
  } else {
    return undefined;
  }
  if (Buffer.byteLength(text, 'utf8') > MAX_SAMPLE_EVENT_BYTES) {
    return undefined;
  }
  let event: unknown;
  try {
    event = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (
    typeof event !== 'object' ||
    event === null ||
    Array.isArray(event) ||
    typeof (event as Record<string, unknown>).type !== 'string'
  ) {
    return undefined;
  }
  return event as Record<string, unknown> & { type: string };
}

export function wrapPcmInWav(pcm: Buffer, sampleRateHz: number) {
  const header = Buffer.alloc(WAV_HEADER_BYTES);
  const channels = 1;
  const bytesPerSample = 2;
  const byteRate = sampleRateHz * channels * bytesPerSample;
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcm.byteLength, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRateHz, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(channels * bytesPerSample, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcm.byteLength, 40);
  return Buffer.concat([header, pcm]);
}

function createSampleSocket(input: SampleSocketFactoryInput): SampleSocket {
  return new WebSocket(input.url, {
    handshakeTimeout: input.timeoutMs,
    headers: input.headers,
    maxPayload: MAX_SAMPLE_EVENT_BYTES,
    perMessageDeflate: false,
  }) as unknown as SampleSocket;
}
