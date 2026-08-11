import {
  WaveRealtimeVoiceIdSchema,
  type WaveRealtimeVoiceId,
} from '@wave/contracts';

import {
  isWaveRealtimeModelId,
  type WaveRealtimeModelId,
} from './realtime-model-preference-record.ts';

const OPENAI_REALTIME_WEBSOCKET_URL = 'wss://api.openai.com/v1/realtime';
const MAX_SAMPLE_EVENT_CHARACTERS = 2 * 1024 * 1024;
const SAMPLE_TOTAL_TIMEOUT_MS = 30_000;
const SAMPLE_RATE_HZ = 24_000;
const WAV_HEADER_BYTES = 44;
const MAX_SAMPLE_BYTES = 600_000;
const MAX_SAMPLE_PCM_BYTES = MAX_SAMPLE_BYTES - WAV_HEADER_BYTES;
const SAMPLE_PHRASE =
  "Hi, I'm Wave. This is how I'll sound when we talk — ask me anything.";

type SampleSocketEvent = 'close' | 'error' | 'message' | 'open';
type SampleSocketListener = (event: { data?: unknown }) => void;

export interface VoiceSampleSocket {
  addEventListener(
    event: SampleSocketEvent,
    listener: SampleSocketListener,
  ): void;
  close(code?: number, reason?: string): void;
  removeEventListener(
    event: SampleSocketEvent,
    listener: SampleSocketListener,
  ): void;
  send(data: string): void;
}

export type VoiceSampleSocketFactory = (
  url: string,
  apiKey: string,
) => VoiceSampleSocket;

export class OpenAiRealtimeVoiceSampleError extends Error {
  readonly cancelled: boolean;

  constructor(message: string, options: { cancelled?: boolean } = {}) {
    super(message);
    this.name = 'OpenAiRealtimeVoiceSampleError';
    this.cancelled = options.cancelled === true;
  }
}

/**
 * Generate one short, bounded preview with the user's device-only OpenAI key.
 * The key is carried only in the WebSocket Authorization header and provider
 * payloads never cross this boundary.
 */
export class OpenAiRealtimeVoiceSampler {
  private readonly apiKey: string;
  private readonly model: WaveRealtimeModelId;
  private readonly socketFactory: VoiceSampleSocketFactory;

  constructor(options: {
    apiKey: string;
    model: WaveRealtimeModelId;
    socketFactory?: VoiceSampleSocketFactory;
  }) {
    if (!isWaveRealtimeModelId(options.model)) {
      throw new OpenAiRealtimeVoiceSampleError(
        'Wave does not support that Realtime model.',
      );
    }
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.socketFactory = options.socketFactory ?? createVoiceSampleSocket;
  }

  getSample(
    requestedVoice: WaveRealtimeVoiceId,
    signal?: AbortSignal,
  ): Promise<Uint8Array> {
    const voice = WaveRealtimeVoiceIdSchema.parse(requestedVoice);
    if (signal?.aborted) return Promise.reject(cancelledError());

    return new Promise<Uint8Array>((resolve, reject) => {
      const url = new URL(OPENAI_REALTIME_WEBSOCKET_URL);
      url.searchParams.set('model', this.model);

      let socket: VoiceSampleSocket;
      try {
        socket = this.socketFactory(url.toString(), this.apiKey);
      } catch {
        reject(
          new OpenAiRealtimeVoiceSampleError(
            'Wave could not connect to OpenAI for the voice preview.',
          ),
        );
        return;
      }

      const chunks: Uint8Array[] = [];
      let pcmByteLength = 0;
      let settled = false;

      const settle = () => {
        settled = true;
        clearTimeout(timeout);
        signal?.removeEventListener('abort', onAbort);
        socket.removeEventListener('close', onClose);
        socket.removeEventListener('error', onSocketError);
        socket.removeEventListener('message', onMessage);
        socket.removeEventListener('open', onOpen);
        try {
          socket.close(1000, 'Wave voice preview finished');
        } catch {
          // The provider may already have closed the socket.
        }
      };
      const fail = (error: OpenAiRealtimeVoiceSampleError) => {
        if (settled) return;
        settle();
        reject(error);
      };
      const finish = () => {
        if (settled) return;
        if (pcmByteLength === 0) {
          fail(
            new OpenAiRealtimeVoiceSampleError(
              'OpenAI returned an empty voice preview.',
            ),
          );
          return;
        }
        const pcm = new Uint8Array(pcmByteLength);
        let offset = 0;
        for (const chunk of chunks) {
          pcm.set(chunk, offset);
          offset += chunk.byteLength;
        }
        settle();
        resolve(wrapPcmInWav(pcm, SAMPLE_RATE_HZ));
      };
      const onAbort = () => fail(cancelledError());
      const onClose: SampleSocketListener = () =>
        fail(
          new OpenAiRealtimeVoiceSampleError(
            'OpenAI closed before the voice preview completed.',
          ),
        );
      const onSocketError: SampleSocketListener = () =>
        fail(
          new OpenAiRealtimeVoiceSampleError(
            'Wave could not maintain the voice preview connection.',
          ),
        );
      const onOpen: SampleSocketListener = () => {
        try {
          socket.send(
            JSON.stringify({
              response: createSampleResponse(voice),
              type: 'response.create',
            }),
          );
        } catch {
          fail(
            new OpenAiRealtimeVoiceSampleError(
              'Wave could not request the voice preview.',
            ),
          );
        }
      };
      const onMessage: SampleSocketListener = (message) => {
        const event = parseSampleEvent(message.data);
        if (!event) {
          fail(
            new OpenAiRealtimeVoiceSampleError(
              'OpenAI sent an invalid voice preview event.',
            ),
          );
          return;
        }
        if (event.type === 'error') {
          fail(
            new OpenAiRealtimeVoiceSampleError(
              'OpenAI could not generate the voice preview.',
            ),
          );
          return;
        }
        if (event.type === 'response.output_audio.delta') {
          if (typeof event.delta !== 'string') {
            fail(
              new OpenAiRealtimeVoiceSampleError(
                'OpenAI sent invalid voice preview audio.',
              ),
            );
            return;
          }
          const chunk = decodeBase64(event.delta);
          if (!chunk) {
            fail(
              new OpenAiRealtimeVoiceSampleError(
                'OpenAI sent invalid voice preview audio.',
              ),
            );
            return;
          }
          pcmByteLength += chunk.byteLength;
          if (pcmByteLength > MAX_SAMPLE_PCM_BYTES) {
            fail(
              new OpenAiRealtimeVoiceSampleError(
                'OpenAI returned an oversized voice preview.',
              ),
            );
            return;
          }
          chunks.push(chunk);
          return;
        }
        if (event.type === 'response.done') {
          const response = event.response;
          if (
            !response ||
            typeof response !== 'object' ||
            Array.isArray(response) ||
            (response as Record<string, unknown>).status !== 'completed'
          ) {
            fail(
              new OpenAiRealtimeVoiceSampleError(
                'OpenAI could not complete the voice preview.',
              ),
            );
            return;
          }
          finish();
        }
      };
      const timeout = setTimeout(
        () =>
          fail(
            new OpenAiRealtimeVoiceSampleError(
              'OpenAI did not produce the voice preview in time.',
            ),
          ),
        SAMPLE_TOTAL_TIMEOUT_MS,
      );

      signal?.addEventListener('abort', onAbort, { once: true });
      socket.addEventListener('close', onClose);
      socket.addEventListener('error', onSocketError);
      socket.addEventListener('message', onMessage);
      socket.addEventListener('open', onOpen);
      if (signal?.aborted) onAbort();
    });
  }
}

function createSampleResponse(voice: WaveRealtimeVoiceId) {
  return {
    audio: {
      output: {
        format: { rate: SAMPLE_RATE_HZ, type: 'audio/pcm' },
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

function parseSampleEvent(data: unknown) {
  if (typeof data !== 'string' || data.length > MAX_SAMPLE_EVENT_CHARACTERS) {
    return undefined;
  }
  let event: unknown;
  try {
    event = JSON.parse(data);
  } catch {
    return undefined;
  }
  if (
    !event ||
    typeof event !== 'object' ||
    Array.isArray(event) ||
    typeof (event as Record<string, unknown>).type !== 'string'
  ) {
    return undefined;
  }
  return event as Record<string, unknown> & { type: string };
}

function decodeBase64(encoded: string): Uint8Array | undefined {
  if (
    encoded.length === 0 ||
    encoded.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)
  ) {
    return undefined;
  }
  try {
    const decoded = atob(encoded);
    const bytes = new Uint8Array(decoded.length);
    for (let index = 0; index < decoded.length; index += 1) {
      bytes[index] = decoded.charCodeAt(index);
    }
    return bytes;
  } catch {
    return undefined;
  }
}

export function wrapPcmInWav(pcm: Uint8Array, sampleRateHz: number) {
  const wav = new Uint8Array(WAV_HEADER_BYTES + pcm.byteLength);
  const view = new DataView(wav.buffer);
  writeAscii(wav, 0, 'RIFF');
  view.setUint32(4, 36 + pcm.byteLength, true);
  writeAscii(wav, 8, 'WAVE');
  writeAscii(wav, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRateHz, true);
  view.setUint32(28, sampleRateHz * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(wav, 36, 'data');
  view.setUint32(40, pcm.byteLength, true);
  wav.set(pcm, WAV_HEADER_BYTES);
  return wav;
}

function writeAscii(target: Uint8Array, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    target[offset + index] = value.charCodeAt(index);
  }
}

function cancelledError() {
  return new OpenAiRealtimeVoiceSampleError(
    'Voice preview generation was cancelled.',
    { cancelled: true },
  );
}

function createVoiceSampleSocket(url: string, apiKey: string) {
  // React Native's WebSocket accepts per-connection headers as a third
  // argument. The key is deliberately never placed in the URL.
  const SocketWithOptions = WebSocket as unknown as new (
    url: string,
    protocols?: string[] | null,
    options?: { headers?: Record<string, string> },
  ) => WebSocket;
  return new SocketWithOptions(url, null, {
    headers: { Authorization: `Bearer ${apiKey}` },
  }) as unknown as VoiceSampleSocket;
}
