import { HermesClientError } from './hermes-errors.ts';

/** Incremental parser for Hermes's server-side event stream. */
export interface HermesSseFrame {
  data: string;
  event: string;
  id?: string;
}

export class HermesSseParser {
  private readonly decoder = new TextDecoder();
  private dataLines: string[] = [];
  private eventName = '';
  private eventId: string | undefined;
  private textBuffer = '';

  push(chunk: Uint8Array | string) {
    this.textBuffer +=
      typeof chunk === 'string'
        ? chunk
        : this.decoder.decode(chunk, { stream: true });

    return this.readCompleteLines();
  }

  finish() {
    this.textBuffer += this.decoder.decode();
    const frames = this.readCompleteLines();

    if (this.textBuffer.endsWith('\r')) {
      this.textBuffer = this.textBuffer.slice(0, -1);
    }

    if (this.textBuffer) {
      this.consumeLine(this.textBuffer, frames);
      this.textBuffer = '';
    }

    if (this.hasPendingEvent()) {
      throw new HermesClientError('Hermes closed an incomplete event stream.', {
        code: 'truncated_sse_stream',
        kind: 'protocol',
      });
    }

    return frames;
  }

  private consumeLine(line: string, frames: HermesSseFrame[]) {
    if (line === '') {
      const frame = this.dispatch();
      if (frame) {
        frames.push(frame);
      }
      return;
    }

    if (line.startsWith(':')) {
      return;
    }

    const separatorIndex = line.indexOf(':');
    const field = separatorIndex === -1 ? line : line.slice(0, separatorIndex);
    let value = separatorIndex === -1 ? '' : line.slice(separatorIndex + 1);
    if (value.startsWith(' ')) {
      value = value.slice(1);
    }

    switch (field) {
      case 'data':
        this.dataLines.push(value);
        break;
      case 'event':
        this.eventName = value;
        break;
      case 'id':
        if (!value.includes('\0')) {
          this.eventId = value;
        }
        break;
      default:
        break;
    }
  }

  private dispatch() {
    if (this.dataLines.length === 0) {
      this.eventName = '';
      return undefined;
    }

    const frame: HermesSseFrame = {
      data: this.dataLines.join('\n'),
      event: this.eventName || 'message',
    };
    if (this.eventId !== undefined) {
      frame.id = this.eventId;
    }

    this.dataLines = [];
    this.eventName = '';
    return frame;
  }

  private hasPendingEvent() {
    return this.dataLines.length > 0 || this.eventName !== '';
  }

  private readCompleteLines() {
    const frames: HermesSseFrame[] = [];
    let newlineIndex = this.textBuffer.indexOf('\n');

    while (newlineIndex !== -1) {
      let line = this.textBuffer.slice(0, newlineIndex);
      this.textBuffer = this.textBuffer.slice(newlineIndex + 1);
      if (line.endsWith('\r')) {
        line = line.slice(0, -1);
      }
      this.consumeLine(line, frames);
      newlineIndex = this.textBuffer.indexOf('\n');
    }

    return frames;
  }
}
