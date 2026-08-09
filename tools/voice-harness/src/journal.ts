/**
 * The harness journal: everything the fake gateway observed, in order, so a
 * test can assert what the app actually sent without scraping server logs.
 *
 * Entries are bounded and secrets-free by construction: cookies and tickets
 * are never journaled, and free-form detail values are truncated.
 */

export interface JournalEntry {
  /** Milliseconds since the harness started. */
  at: number;
  detail: Record<string, unknown>;
  kind: string;
}

const MAX_ENTRIES = 5_000;
const MAX_DETAIL_CHARS = 2_000;

export class Journal {
  private readonly entries: JournalEntry[] = [];
  private readonly startedAt = Date.now();

  record(kind: string, detail: Record<string, unknown> = {}): void {
    if (this.entries.length >= MAX_ENTRIES) return;
    this.entries.push({
      at: Date.now() - this.startedAt,
      detail: boundDetail(detail),
      kind,
    });
  }

  list(): JournalEntry[] {
    return [...this.entries];
  }

  clear(): void {
    this.entries.length = 0;
  }
}

function boundDetail(detail: Record<string, unknown>): Record<string, unknown> {
  const bounded: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(detail)) {
    if (typeof value === 'string' && value.length > MAX_DETAIL_CHARS) {
      bounded[key] = `${value.slice(0, MAX_DETAIL_CHARS)}…`;
    } else {
      bounded[key] = value;
    }
  }
  return bounded;
}
