import type { SerializedScoringWeights } from '../engine/engine-config.js';
import type { Decimal, Money } from '../money/index.js';
import type { PlatformPricingRule } from './platform-pricing.js';
import type { PlatformMode, ProviderDescriptor } from './provider.js';
import type { ProviderQuote, QuoteRequest } from './quote.js';
import type { ProviderFailure, ScoredRoute } from './route.js';

export const SNAPSHOT_VERSION = 1;

/**
 * Everything the engine needs to recompute a comparison byte-for-byte.
 *
 * This is the reproducibility contract (rule 13): the engine is a pure function of a snapshot, so
 * persisting the snapshot is enough to re-derive the result at any later time, even after upstream
 * prices have moved.
 */
export interface ComparisonSnapshot {
  readonly snapshotVersion: typeof SNAPSHOT_VERSION;
  readonly engineVersion: string;
  readonly mode: PlatformMode;
  readonly organizationId: string | null;
  readonly request: QuoteRequest;
  /**
   * The commercial terms in force when the comparison was made.
   *
   * Captured rather than re-queried on replay: a customer's pricing changes over time, and a replay
   * that resolved today's terms against last quarter's quotes would produce a number that never
   * existed.
   */
  readonly pricingRules: readonly PlatformPricingRule[];
  readonly weights: SerializedScoringWeights;
  /** Provider quotes exactly as received, sorted by provider id for a stable hash. */
  readonly quotes: readonly ProviderQuote[];
  /**
   * Descriptors of the quoting providers, captured so a replay is self-contained even after an
   * adapter is retired, and so a change to a provider's pricing version is visible in the hash.
   */
  readonly providers: readonly ProviderDescriptor[];
}

/** Headline comparisons a treasury team asks for immediately after seeing the routes. */
export interface ComparisonInsights {
  readonly cheapestRouteId: string;
  readonly fastestRouteId: string;
  readonly mostExpensiveRouteId: string;
  /** What the recommended route saves against the most expensive candidate. */
  readonly savingsVsMostExpensive: Money;
  readonly savingsVsMostExpensiveBps: Decimal;
  /**
   * What the recommended route saves against the cheapest traditional bank-FX route, the baseline
   * most businesses are actually comparing against. `null` when no bank route was returned.
   */
  readonly savingsVsBankFx: Money | null;
}

export interface RouteComparison {
  readonly comparisonId: string;
  readonly createdAt: string;
  readonly mode: PlatformMode;
  readonly engineVersion: string;
  /** SHA-256 over the canonical snapshot. Identical inputs always yield this same value. */
  readonly fingerprint: string;
  readonly request: QuoteRequest;
  readonly snapshot: ComparisonSnapshot;
  /** Ranked best-first. */
  readonly routes: readonly ScoredRoute[];
  readonly recommendedRouteId: string | null;
  readonly insights: ComparisonInsights | null;
  readonly providerFailures: readonly ProviderFailure[];
}

/** Why a replay did not reproduce the original. */
export type ReplayDivergence = 'fingerprint_mismatch' | 'engine_version_changed';

/** Outcome of recomputing a stored comparison. */
export interface ReplayResult {
  readonly comparisonId: string;
  readonly reproducible: boolean;
  /** Null when the replay reproduced the original exactly. */
  readonly divergence: ReplayDivergence | null;
  readonly originalFingerprint: string;
  readonly replayedFingerprint: string;
  /** Engine that produced the stored comparison, and the one that replayed it. */
  readonly originalEngineVersion: string;
  readonly replayEngineVersion: string;
  readonly replayedAt: string;
  readonly comparison: RouteComparison;
}
