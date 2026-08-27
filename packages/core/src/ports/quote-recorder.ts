import type { JsonObject } from '../domain/json.js';
import type { ProviderCapability } from './provider-adapter.js';

export type QuoteOutcome = 'quoted' | 'failed';

/**
 * A record of one provider interaction.
 *
 * Every quote is recorded, successful or not, with the time it was asked for and the time it came
 * back. Two reasons that matters here beyond ordinary observability: a disputed price has to be
 * traceable to the exact response that produced it, and a provider's reliability score is only
 * honest if failures are counted as diligently as successes.
 *
 * `requestedAt` and `receivedAt` are both kept rather than a single timestamp because the gap is the
 * latency, and latency is what distinguishes a provider that is slow from one that is down.
 */
export interface RecordedQuote {
  readonly recordId: string;
  readonly providerId: string;
  readonly capability: ProviderCapability;
  /** The adapter method called, e.g. `"getFXQuote"`. */
  readonly operation: string;
  readonly requestedAt: string;
  readonly receivedAt: string;
  readonly latencyMs: number;
  readonly outcome: QuoteOutcome;
  /** How many attempts were made, including the one that succeeded. */
  readonly attempts: number;
  readonly correlationId: string | null;
  /** The request as asked, for reproducing the call. */
  readonly request: JsonObject;
  /** The quote as returned. Null when the call failed. */
  readonly quote: JsonObject | null;
  readonly error: { readonly code: string; readonly message: string } | null;
}

export type RecordedQuoteInput = Omit<RecordedQuote, 'recordId' | 'latencyMs'>;

/**
 * Sink for provider quote records. Append-only, like the audit log: a record of what a provider said
 * is evidence, and evidence is not edited.
 */
export interface QuoteRecorder {
  record(entry: RecordedQuoteInput): Promise<RecordedQuote>;
  /** Most recent first. */
  list(options?: { readonly limit?: number }): Promise<readonly RecordedQuote[]>;
}

/** Discards records. For unit tests that are not asserting on recording. */
export const noopQuoteRecorder: QuoteRecorder = {
  record: (entry) =>
    Promise.resolve({
      ...entry,
      recordId: 'noop',
      latencyMs: 0,
    }),
  list: () => Promise.resolve([]),
};
