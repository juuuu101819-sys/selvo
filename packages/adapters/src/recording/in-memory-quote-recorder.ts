import { randomUUID } from 'node:crypto';
import type { QuoteRecorder, RecordedQuote, RecordedQuoteInput } from '@meridian/core';

const DEFAULT_LIST_LIMIT = 100;

/**
 * In-process quote record store.
 *
 * Bounded on purpose. A long-lived process quoting continuously would otherwise grow this without
 * limit, and an unbounded in-memory log is a slow leak rather than an audit trail. The durable
 * record belongs in the `quotes` table; this exists for local development, for tests, and as the
 * default so that nothing silently runs with recording switched off.
 */
export class InMemoryQuoteRecorder implements QuoteRecorder {
  private readonly entries: RecordedQuote[] = [];

  constructor(private readonly maxEntries = 1_000) {}

  record(entry: RecordedQuoteInput): Promise<RecordedQuote> {
    const requestedMs = Date.parse(entry.requestedAt);
    const receivedMs = Date.parse(entry.receivedAt);

    const recorded: RecordedQuote = {
      ...entry,
      recordId: `qr_${randomUUID().replaceAll('-', '')}`,
      latencyMs:
        Number.isNaN(requestedMs) || Number.isNaN(receivedMs)
          ? 0
          : Math.max(0, receivedMs - requestedMs),
    };

    this.entries.push(recorded);
    if (this.entries.length > this.maxEntries) {
      this.entries.splice(0, this.entries.length - this.maxEntries);
    }

    return Promise.resolve(recorded);
  }

  list(options: { limit?: number } = {}): Promise<readonly RecordedQuote[]> {
    const limit = options.limit ?? DEFAULT_LIST_LIMIT;
    return Promise.resolve([...this.entries].reverse().slice(0, limit));
  }

  /** Records for one provider, oldest first. Used by tests and by local diagnostics. */
  forProvider(providerId: string): readonly RecordedQuote[] {
    return this.entries.filter((entry) => entry.providerId === providerId);
  }

  get size(): number {
    return this.entries.length;
  }

  clear(): void {
    this.entries.length = 0;
  }
}
