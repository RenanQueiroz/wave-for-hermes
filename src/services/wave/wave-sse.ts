import {
  WaveTurnEventSchema,
  type WaveTurnEvent,
} from '@wave/contracts';

const MAX_EVENT_BYTES = 2 * 1024 * 1024;

export class WaveSseProtocolError extends Error {
  constructor(message = 'Wave Companion returned an invalid event stream.') {
    super(message);
    this.name = 'WaveSseProtocolError';
  }
}

export async function* parseWaveSseStream(
  stream: ReadableStream<Uint8Array>,
  options: { onActivity?(): void } = {},
): AsyncGenerator<WaveTurnEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = '';
  let reachedEnd = false;

  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        reachedEnd = true;
        buffer += decoder.decode();
        break;
      }
      options.onActivity?.();
      buffer += decoder.decode(chunk.value, { stream: true });
      buffer = buffer.replace(/\r\n/g, '\n');

      while (true) {
        const boundary = buffer.indexOf('\n\n');
        if (boundary < 0) break;
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        if (encoder.encode(frame).byteLength > MAX_EVENT_BYTES) {
          throw new WaveSseProtocolError();
        }
        const event = parseFrame(frame);
        if (event) yield event;
      }
      if (encoder.encode(buffer).byteLength > MAX_EVENT_BYTES) {
        throw new WaveSseProtocolError();
      }
    }

    if (buffer.trim()) {
      throw new WaveSseProtocolError();
    }
  } catch (error) {
    if (error instanceof WaveSseProtocolError) throw error;
    throw error;
  } finally {
    if (!reachedEnd) {
      await reader.cancel().catch(() => undefined);
    }
    reader.releaseLock();
  }
}

function parseFrame(frame: string) {
  if (!frame || frame.startsWith(':')) return undefined;
  let eventName: string | undefined;
  let eventId: string | undefined;
  const data: string[] = [];

  for (const line of frame.split('\n')) {
    if (!line || line.startsWith(':')) continue;
    const separator = line.indexOf(':');
    const field = separator < 0 ? line : line.slice(0, separator);
    const value =
      separator < 0
        ? ''
        : line.slice(separator + 1).replace(/^ /, '');
    switch (field) {
      case 'data':
        data.push(value);
        break;
      case 'event':
        if (eventName !== undefined) throw new WaveSseProtocolError();
        eventName = value;
        break;
      case 'id':
        if (eventId !== undefined) throw new WaveSseProtocolError();
        eventId = value;
        break;
      default:
        throw new WaveSseProtocolError();
    }
  }

  if (!eventName || !eventId || data.length === 0) {
    throw new WaveSseProtocolError();
  }
  let payload: unknown;
  try {
    payload = JSON.parse(data.join('\n')) as unknown;
  } catch {
    throw new WaveSseProtocolError();
  }
  const parsed = WaveTurnEventSchema.safeParse(payload);
  if (
    !parsed.success ||
    parsed.data.type !== eventName ||
    parsed.data.eventId !== eventId
  ) {
    throw new WaveSseProtocolError();
  }
  return parsed.data;
}
