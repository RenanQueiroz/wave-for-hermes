export const WAVE_TURN_BUFFER_MAX_FRAMES = 4_096;
export const WAVE_TURN_BUFFER_MAX_BYTES = 4 * 1024 * 1024;

interface BufferedFrame {
  frame: string;
  sequence: number;
}

/**
 * Bounded replay buffer of formatted SSE frames for one turn. When the caps
 * evict the oldest frames, a reattach that would need them is refused instead
 * of replaying a stream with a gap.
 */
export class TurnStreamBuffer {
  private bytes = 0;
  private evictedThroughSequence = -1;
  private frames: BufferedFrame[] = [];
  private latest = -1;
  private readonly maxBytes: number;
  private readonly maxFrames: number;

  constructor(options: { maxBytes?: number; maxFrames?: number } = {}) {
    this.maxBytes = options.maxBytes ?? WAVE_TURN_BUFFER_MAX_BYTES;
    this.maxFrames = options.maxFrames ?? WAVE_TURN_BUFFER_MAX_FRAMES;
  }

  get latestSequence() {
    return this.latest;
  }

  append(sequence: number, frame: string) {
    this.frames.push({ frame, sequence });
    this.bytes += frame.length;
    this.latest = sequence;
    while (this.frames.length > this.maxFrames || this.bytes > this.maxBytes) {
      const evicted = this.frames.shift();
      if (!evicted) break;
      this.bytes -= evicted.frame.length;
      this.evictedThroughSequence = evicted.sequence;
    }
  }

  /**
   * Frames strictly after `sequence`, or undefined when that replay is no
   * longer possible: the requested position was evicted, or lies beyond
   * what this turn has emitted.
   */
  replayAfter(sequence: number): string[] | undefined {
    if (sequence < this.evictedThroughSequence || sequence > this.latest) {
      return undefined;
    }
    return this.frames
      .filter((entry) => entry.sequence > sequence)
      .map((entry) => entry.frame);
  }
}
