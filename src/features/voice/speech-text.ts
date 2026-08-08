/**
 * Turn streamed assistant narration into speakable plain text.
 *
 * Stage 4b forbids feeding tool details, Markdown control syntax, hidden
 * reasoning, or already-spoken content to the gateway's speech stream. The
 * turn loop only ever routes assistant narration here (tool and reasoning
 * events have their own types and are never fed), so this module owns the
 * other two rules:
 *
 * - `SpeechTextFilter` incrementally strips Markdown control syntax from
 *   delta-sized chunks: fenced code blocks disappear entirely (code is never
 *   read aloud), link and image URLs are dropped while link text survives,
 *   and inline emphasis/heading/quote/table markers are removed. It is a
 *   line-aware scanner: every held lookahead resolves at the next newline, so
 *   the hold is bounded and `flush` is deterministic.
 * - `StreamedReplyFeeder` tracks exactly which raw narration was already fed
 *   so sealed interim segments and the final completion can contribute only
 *   provably unseen tails — never a repeat of text that may have been spoken.
 */

const LINK_SCAN_CAP = 300;
const TAG_SCAN_CAP = 120;

interface LineStartMatch {
  /** Characters consumed from the buffer. */
  advance: number;
  kind: 'fence' | 'marker' | 'none';
}

/** Strip inline markers from already-delimited text (link labels). */
function stripInlineMarkers(text: string): string {
  return text.replace(/[`*~]/g, '').replace(/__/g, '').replace(/\|/g, ' ');
}

function isWordChar(char: string | undefined): boolean {
  return char !== undefined && /[\p{L}\p{N}]/u.test(char);
}

export class SpeechTextFilter {
  private pending = '';
  private atLineStart = true;
  private inFence = false;
  private fenceMarker: '`' | '~' = '`';
  /** The current fence line already contains non-marker text. */
  private fenceLinePoisoned = false;
  /** The character emitted last; context for single-underscore decisions. */
  private lastEmitted = '';

  feed(chunk: string): string {
    if (!chunk) return '';
    this.pending += chunk;
    return this.process();
  }

  /**
   * Resolve every held lookahead. All holds stop at a line break, so flushing
   * a synthetic newline settles them; the trailing whitespace is harmless to
   * the server's sentence chunker.
   */
  flush(): string {
    this.pending += '\n';
    const output = this.process();
    this.pending = '';
    return output;
  }

  private process(): string {
    const buffer = this.pending;
    let output = '';
    let index = 0;

    const emit = (text: string) => {
      if (!text) return;
      output += text;
      this.lastEmitted = text[text.length - 1];
    };

    scan: while (index < buffer.length) {
      if (this.inFence) {
        const newline = buffer.indexOf('\n', index);
        if (newline === -1) {
          const rest = buffer.slice(index);
          if (!this.fenceLinePoisoned && this.couldCloseFence(rest)) {
            break scan; // Hold: the partial line may still close the fence.
          }
          this.fenceLinePoisoned = true;
          index = buffer.length;
          break scan;
        }
        const line = buffer.slice(index, newline);
        if (!this.fenceLinePoisoned && this.closesFence(line)) {
          this.inFence = false;
          this.atLineStart = true;
        }
        this.fenceLinePoisoned = false;
        index = newline + 1;
        continue;
      }

      const char = buffer[index];
      if (char === '\n') {
        emit('\n');
        index += 1;
        this.atLineStart = true;
        continue;
      }

      if (this.atLineStart) {
        const match = this.matchLineStart(buffer, index);
        if (match === undefined) break scan; // Hold: marker prefix undecided.
        if (match.kind === 'fence') {
          index += match.advance;
          continue;
        }
        if (match.kind === 'marker') {
          index += match.advance;
          continue; // Markers can nest (`> -`); try the line start again.
        }
        this.atLineStart = false;
        continue;
      }

      switch (char) {
        case '`': {
          index += this.runLength(buffer, index, '`');
          continue;
        }
        case '*': {
          index += this.runLength(buffer, index, '*');
          continue;
        }
        case '~': {
          const run = this.runLength(buffer, index, '~');
          const runEndsBuffer = index + run === buffer.length;
          if (run === 1 && runEndsBuffer) break scan; // Could become `~~`.
          if (run === 1) emit('~');
          index += run;
          continue;
        }
        case '_': {
          const run = this.runLength(buffer, index, '_');
          const runEndsBuffer = index + run === buffer.length;
          if (run === 1 && runEndsBuffer) break scan; // Neighbor unknown.
          if (
            run === 1 &&
            isWordChar(this.lastEmitted) &&
            isWordChar(buffer[index + 1])
          ) {
            emit('_'); // snake_case survives; emphasis markers do not.
          }
          index += run;
          continue;
        }
        case '-':
        case '=': {
          const run = this.runLength(buffer, index, char);
          const runEndsBuffer = index + run === buffer.length;
          if (run < 3 && runEndsBuffer) break scan; // Could become a rule.
          if (run < 3) emit(buffer.slice(index, index + run));
          index += run;
          continue;
        }
        case '|': {
          emit(' ');
          index += 1;
          continue;
        }
        case '!': {
          const next = buffer[index + 1];
          if (next === undefined) break scan;
          if (next !== '[') {
            emit('!');
            index += 1;
            continue;
          }
          const link = this.scanLink(buffer, index + 1);
          if (link === undefined) break scan;
          index = link.nextIndex; // Images are dropped, alt text included.
          continue;
        }
        case '[': {
          const link = this.scanLink(buffer, index);
          if (link === undefined) break scan;
          emit(stripInlineMarkers(link.label));
          index = link.nextIndex;
          continue;
        }
        case '<': {
          const next = buffer[index + 1];
          if (next === undefined) break scan;
          if (!/[A-Za-z/]/.test(next)) {
            emit('<');
            index += 1;
            continue;
          }
          const close = this.boundedIndexOf(buffer, '>', index, TAG_SCAN_CAP);
          if (close === 'hold') break scan;
          if (close === 'give-up') {
            emit('<');
            index += 1;
            continue;
          }
          index = close + 1; // Tags and autolink URLs are never spoken.
          continue;
        }
        default: {
          emit(char);
          index += 1;
          continue;
        }
      }
    }

    this.pending = buffer.slice(index);
    return output;
  }

  /**
   * Consume Markdown line-start markers (headings, quotes, bullets, fences).
   * Returns `undefined` while the buffer ends inside a still-ambiguous marker
   * prefix — the hold resolves once more characters or a newline arrive.
   */
  private matchLineStart(
    buffer: string,
    index: number,
  ): LineStartMatch | undefined {
    const rest = buffer.slice(index);
    // The prefix so far could still grow into any line-start marker.
    if (/^ {0,3}(?:#{1,6}|>*|[-+*]?|\d{1,9}[.)]?|`{1,3}|~{1,3})?$/.test(rest)) {
      return undefined;
    }
    const fence = /^ {0,3}(`{3,}|~{3,})/.exec(rest);
    if (fence) {
      this.inFence = true;
      this.fenceMarker = fence[1][0] as '`' | '~';
      // The rest of this line is the info string; drop through the newline.
      const newline = rest.indexOf('\n');
      this.fenceLinePoisoned = newline === -1 && rest.length > fence[0].length;
      if (newline === -1) return { advance: rest.length, kind: 'fence' };
      this.atLineStart = true;
      return { advance: newline + 1, kind: 'fence' };
    }
    const marker = /^ {0,3}(?:#{1,6} +|> ?|[-+*] +|\d{1,9}[.)] +)/.exec(rest);
    if (marker) return { advance: marker[0].length, kind: 'marker' };
    return { advance: 0, kind: 'none' };
  }

  /**
   * Scan `[label](target)` starting at the opening bracket. Returns the label
   * and the resume position; `undefined` requests more input. Scans stop at
   * line breaks or the bounded cap, emitting the label and treating the rest
   * as ordinary text — a URL is never part of the label.
   */
  private scanLink(
    buffer: string,
    open: number,
  ): { label: string; nextIndex: number } | undefined {
    const close = this.boundedScan(buffer, open + 1, LINK_SCAN_CAP, ']');
    if (close === 'hold') return undefined;
    if (close === 'give-up') {
      // Overlong or line-broken label: speak what we have, drop the bracket.
      const endOfLine = this.lineOrCapEnd(buffer, open + 1, LINK_SCAN_CAP);
      return { label: buffer.slice(open + 1, endOfLine), nextIndex: endOfLine };
    }
    const label = buffer.slice(open + 1, close);
    const after = buffer[close + 1];
    if (after === undefined) return undefined;
    if (after === '(') {
      const target = this.boundedScan(buffer, close + 2, LINK_SCAN_CAP, ')');
      if (target === 'hold') return undefined;
      if (target === 'give-up') return { label, nextIndex: close + 1 };
      return { label, nextIndex: target + 1 };
    }
    if (after === '[') {
      const reference = this.boundedScan(buffer, close + 2, LINK_SCAN_CAP, ']');
      if (reference === 'hold') return undefined;
      if (reference === 'give-up') return { label, nextIndex: close + 1 };
      return { label, nextIndex: reference + 1 };
    }
    return { label, nextIndex: close + 1 };
  }

  /** Find `target` before a newline within `cap`; hold only if more input can decide. */
  private boundedScan(
    buffer: string,
    from: number,
    cap: number,
    target: string,
  ): number | 'give-up' | 'hold' {
    const limit = Math.min(buffer.length, from + cap);
    for (let index = from; index < limit; index += 1) {
      const char = buffer[index];
      if (char === target) return index;
      if (char === '\n') return 'give-up';
    }
    return buffer.length < from + cap ? 'hold' : 'give-up';
  }

  private boundedIndexOf(
    buffer: string,
    target: string,
    from: number,
    cap: number,
  ): number | 'give-up' | 'hold' {
    return this.boundedScan(buffer, from + 1, cap, target);
  }

  private lineOrCapEnd(buffer: string, from: number, cap: number): number {
    const limit = Math.min(buffer.length, from + cap);
    const newline = buffer.indexOf('\n', from);
    return newline !== -1 && newline < limit ? newline : limit;
  }

  private runLength(buffer: string, index: number, char: string): number {
    let length = 0;
    while (buffer[index + length] === char) length += 1;
    return length;
  }

  private couldCloseFence(partialLine: string): boolean {
    const marker = this.fenceMarker === '`' ? '`' : '~';
    return new RegExp(`^ {0,3}\\${marker}{0,3}$`).test(partialLine);
  }

  private closesFence(line: string): boolean {
    const marker = this.fenceMarker === '`' ? '`' : '~';
    return new RegExp(`^ {0,3}\\${marker}{3,}\\s*$`).test(line);
  }
}

/**
 * Routes one turn's assistant narration into a speech sink exactly once.
 *
 * Deltas feed directly. A sealed interim segment normally repeats text that
 * already streamed as deltas, so it contributes only a proven unseen tail; a
 * final completion likewise contributes only a tail that extends everything
 * fed so far. Anything that diverges from the fed prefix is silently not fed:
 * duplicated speech is worse than an unspoken reconciliation, and the full
 * reply stays visible as text either way.
 */
export class StreamedReplyFeeder {
  private readonly filter = new SpeechTextFilter();
  private readonly sink: (text: string) => void;
  private fedNarration = '';
  private segmentRaw = '';
  private finished = false;

  constructor(sink: (text: string) => void) {
    this.sink = sink;
  }

  appendDelta(text: string): void {
    if (this.finished || !text) return;
    this.segmentRaw += text;
    this.fedNarration += text;
    this.emit(this.filter.feed(text));
  }

  noteInterim(content: string): void {
    if (this.finished) return;
    const segment = this.segmentRaw.trim();
    if (!segment && content) {
      // A gateway that seals narration without streaming deltas first: the
      // whole segment is provably unspoken.
      this.fedNarration += content;
      this.emit(this.filter.feed(content));
    } else if (
      segment &&
      content.length > segment.length &&
      content.startsWith(segment)
    ) {
      const tail = content.slice(segment.length);
      this.fedNarration += tail;
      this.emit(this.filter.feed(tail));
    }
    this.segmentRaw = '';
    // A segment boundary is a sentence boundary for the server's chunker.
    this.emit(this.filter.feed('\n\n'));
  }

  noteCompleted(content: string, interrupted: boolean): void {
    if (this.finished || interrupted) return;
    if (
      content.length > this.fedNarration.length &&
      content.startsWith(this.fedNarration)
    ) {
      const tail = content.slice(this.fedNarration.length);
      this.fedNarration = content;
      this.emit(this.filter.feed(tail));
    }
  }

  /** The reply is over; release any held tail. Further input is ignored. */
  finishReply(): void {
    if (this.finished) return;
    this.finished = true;
    this.emit(this.filter.flush());
  }

  private emit(text: string): void {
    if (text) this.sink(text);
  }
}
