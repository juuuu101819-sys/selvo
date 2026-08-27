import type {
  ComparisonInsights,
  ComparisonSnapshot,
  PlatformPricing,
  PlatformPricingRule,
  ReplayDivergence,
  PlatformMode,
  PricedRoute,
  ProviderDescriptor,
  ProviderFailure,
  ProviderQuote,
  QuoteRequest,
  RailType,
  ReplayResult,
  RouteComparison,
  ScoredRoute,
} from '../domain/index.js';
import { SNAPSHOT_VERSION } from '../domain/index.js';
import {
  NoRoutesAvailableError,
  NotFoundError,
  ProviderTimeoutError,
  UnsupportedCorridorError,
  ValidationError,
  isAppError,
  toAppError,
} from '../errors/index.js';
import { Dec, Money, Rate, type CurrencyCode } from '../money/index.js';
import type {
  AuditLogger,
  Clock,
  ComparisonRepository,
  IdGenerator,
  Logger,
  PlatformPricingResolver,
  RouteProvider,
} from '../ports/index.js';
import {
  DEFAULT_FRESHNESS_POLICY,
  assertQuoteUsable,
  type FreshnessPolicy,
} from '../quotes/quote-freshness.js';
import { fingerprint } from '../reproducibility/index.js';
import { serializeComparison } from '../serialization/index.js';
import type { RouteCostEngine } from './cost-engine.js';
import {
  ENGINE_VERSION,
  type ScoringWeights,
  type ScoringWeightsInput,
  parseScoringWeights,
  serializeScoringWeights,
} from './engine-config.js';
import { NO_PLATFORM_PRICING, selectPricingRule, toPlatformPricing } from './platform-pricing.js';
import type { ProviderRegistry } from './provider-registry.js';
import { RouteScorer } from './route-scorer.js';

export interface ComparisonInput {
  /**
   * The organization the comparison is for.
   *
   * Nullable while authentication is unimplemented; once it is, an absent organization on a priced
   * request is a defect rather than a valid state. Determines which negotiated commercial terms
   * apply, so two customers can be quoted different prices from identical provider input.
   */
  readonly organizationId: string | null;
  readonly sourceCurrency: CurrencyCode;
  readonly targetCurrency: CurrencyCode;
  /** Send amount in integer minor units of the source currency. */
  readonly amountMinorUnits: string;
  readonly rails: readonly RailType[] | null;
  /** Per-request scoring weights. Falls back to the platform default when absent. */
  readonly weights: ScoringWeightsInput | null;
  readonly idempotencyKey: string | null;
  /** Who asked. Recorded on every audit event. */
  readonly actor: string;
  readonly requestId: string | null;
}

export interface RouteComparisonServiceDependencies {
  readonly mode: PlatformMode;
  readonly registry: ProviderRegistry;
  readonly costEngine: RouteCostEngine;
  readonly defaultWeights: ScoringWeights;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly auditLogger: AuditLogger;
  readonly comparisons: ComparisonRepository;
  readonly logger: Logger;
  readonly providerTimeoutMs: number;
  /** Optional: an unconfigured platform charges nothing. */
  readonly pricingResolver?: PlatformPricingResolver | undefined;
  /**
   * Bounds on how old or near-expiry a quote may be when it is admitted to a comparison. Defaults
   * to {@link DEFAULT_FRESHNESS_POLICY}. Applied at ingestion only, never during a replay.
   */
  readonly freshnessPolicy?: FreshnessPolicy | undefined;
}

type QuoteOutcome =
  | { readonly ok: true; readonly quote: ProviderQuote; readonly descriptor: ProviderDescriptor }
  | { readonly ok: false; readonly failure: ProviderFailure };

/**
 * Orchestrates a route comparison: fan out to every eligible provider, price each quote with one
 * engine, rank the results, persist a replayable snapshot and audit the whole thing.
 *
 * A dead or slow provider degrades the comparison instead of failing it — the caller gets the
 * routes that did answer plus an explicit list of who did not, which is the behaviour a treasury
 * team needs when one bank's API is down.
 */
export class RouteComparisonService {
  constructor(private readonly deps: RouteComparisonServiceDependencies) {}

  async compare(input: ComparisonInput): Promise<RouteComparison> {
    const { clock, registry, auditLogger, comparisons, logger } = this.deps;

    this.assertValidCorridor(input);
    const weights =
      input.weights === null ? this.deps.defaultWeights : parseScoringWeights(input.weights);

    if (input.idempotencyKey !== null) {
      const existing = await comparisons.findByIdempotencyKey(input.idempotencyKey);
      if (existing !== null) {
        logger.info('Returning comparison from idempotency key', {
          comparisonId: existing.comparisonId,
        });
        return this.rehydrate(existing.snapshot as ComparisonSnapshot, {
          comparisonId: existing.comparisonId,
          createdAt: existing.createdAt,
        });
      }
    }

    const pricingRules = await this.loadPricingRules(input);

    const request: QuoteRequest = {
      sourceCurrency: input.sourceCurrency,
      targetCurrency: input.targetCurrency,
      amountMinorUnits: input.amountMinorUnits,
      rails: input.rails === null ? null : [...input.rails].sort(),
      requestedAt: clock.nowIso(),
    };

    const comparisonId = this.deps.ids.generate('cmp');

    await auditLogger.record({
      type: 'comparison.requested',
      actor: input.actor,
      requestId: input.requestId,
      comparisonId,
      providerId: null,
      payload: {
        sourceCurrency: request.sourceCurrency,
        targetCurrency: request.targetCurrency,
        amountMinorUnits: request.amountMinorUnits,
        rails: request.rails === null ? null : [...request.rails],
        weightCost: weights.cost.toFixed(),
        weightSpeed: weights.speed.toFixed(),
        weightReliability: weights.reliability.toFixed(),
      },
    });

    const eligible = registry.eligible(request);
    if (eligible.length === 0) {
      await auditLogger.record({
        type: 'comparison.failed',
        actor: input.actor,
        requestId: input.requestId,
        comparisonId,
        providerId: null,
        payload: {
          reason: 'no eligible provider',
          registeredProviderCount: registry.all().length,
        },
      });
      throw new UnsupportedCorridorError(input.sourceCurrency, input.targetCurrency, {
        amount: Money.ofMinorUnits(input.sourceCurrency, input.amountMinorUnits).toString(),
        rails: request.rails,
      });
    }

    const outcomes = await Promise.all(
      eligible.map((provider) => this.requestQuote(provider, request, input, comparisonId)),
    );

    const quotes: ProviderQuote[] = [];
    const descriptors: ProviderDescriptor[] = [];
    const failures: ProviderFailure[] = [];

    for (const outcome of outcomes) {
      if (outcome.ok) {
        quotes.push(outcome.quote);
        descriptors.push(outcome.descriptor);
      } else {
        failures.push(outcome.failure);
      }
    }

    if (quotes.length === 0) {
      await auditLogger.record({
        type: 'comparison.failed',
        actor: input.actor,
        requestId: input.requestId,
        comparisonId,
        providerId: null,
        payload: {
          reason: 'every provider failed to quote',
          failures: failures.map(toJsonFailure),
        },
      });
      throw new NoRoutesAvailableError(
        'No provider returned a usable quote for this transaction.',
        { providerFailures: failures.map(toJsonFailure) },
      );
    }

    const snapshot: ComparisonSnapshot = {
      snapshotVersion: SNAPSHOT_VERSION,
      engineVersion: ENGINE_VERSION,
      mode: this.deps.mode,
      organizationId: input.organizationId,
      request,
      pricingRules,
      weights: serializeScoringWeights(weights),
      quotes: sortById(quotes, (quote) => quote.providerId),
      providers: sortById(descriptors, (descriptor) => descriptor.id),
    };

    const comparison = this.computeFromSnapshot(snapshot, {
      comparisonId,
      createdAt: clock.nowIso(),
      providerFailures: failures,
    });

    await comparisons.save({
      comparisonId: comparison.comparisonId,
      createdAt: comparison.createdAt,
      mode: comparison.mode,
      engineVersion: comparison.engineVersion,
      fingerprint: comparison.fingerprint,
      sourceCurrency: request.sourceCurrency,
      targetCurrency: request.targetCurrency,
      amountMinorUnits: request.amountMinorUnits,
      idempotencyKey: input.idempotencyKey,
      organizationId: input.organizationId,
      snapshot,
      result: serializeComparison(comparison),
    });

    await auditLogger.record({
      type: 'comparison.completed',
      actor: input.actor,
      requestId: input.requestId,
      comparisonId,
      providerId: null,
      payload: {
        fingerprint: comparison.fingerprint,
        routeCount: comparison.routes.length,
        recommendedRouteId: comparison.recommendedRouteId,
        failedProviderCount: failures.length,
      },
    });

    return comparison;
  }

  /** Recomputes a stored comparison and reports whether the engine still reproduces it. */
  async replay(
    comparisonId: string,
    context: { readonly actor: string; readonly requestId: string | null },
  ): Promise<ReplayResult> {
    const stored = await this.deps.comparisons.findById(comparisonId);
    if (stored === null) {
      throw new NotFoundError('Comparison', comparisonId);
    }

    const snapshot = stored.snapshot as ComparisonSnapshot;
    const replayed = this.rehydrate(snapshot, {
      comparisonId: stored.comparisonId,
      createdAt: stored.createdAt,
    });
    const fingerprintMatches = replayed.fingerprint === stored.fingerprint;
    // A snapshot made by a different engine version can hash identically while producing different
    // numbers, because the fingerprint covers the inputs and the engine's own version but not its
    // arithmetic. Reporting that as reproducible would be the most misleading answer available.
    const engineMatches = snapshot.engineVersion === ENGINE_VERSION;
    const reproducible = fingerprintMatches && engineMatches;
    const divergence: ReplayDivergence | null = !fingerprintMatches
      ? 'fingerprint_mismatch'
      : engineMatches
        ? null
        : 'engine_version_changed';
    const replayedAt = this.deps.clock.nowIso();

    await this.deps.auditLogger.record({
      type: 'comparison.replayed',
      actor: context.actor,
      requestId: context.requestId,
      comparisonId,
      providerId: null,
      payload: {
        reproducible,
        divergence,
        originalFingerprint: stored.fingerprint,
        replayedFingerprint: replayed.fingerprint,
        originalEngineVersion: snapshot.engineVersion,
        replayEngineVersion: ENGINE_VERSION,
      },
    });

    if (divergence === 'fingerprint_mismatch') {
      this.deps.logger.error('Comparison replay produced a different fingerprint', {
        comparisonId,
        originalFingerprint: stored.fingerprint,
        replayedFingerprint: replayed.fingerprint,
      });
    } else if (divergence === 'engine_version_changed') {
      this.deps.logger.warn('Comparison replayed under a different engine version', {
        comparisonId,
        originalEngineVersion: snapshot.engineVersion,
        replayEngineVersion: ENGINE_VERSION,
      });
    }

    return {
      comparisonId,
      reproducible,
      divergence,
      originalFingerprint: stored.fingerprint,
      replayedFingerprint: replayed.fingerprint,
      originalEngineVersion: snapshot.engineVersion,
      replayEngineVersion: ENGINE_VERSION,
      replayedAt,
      comparison: replayed,
    };
  }

  private rehydrate(
    snapshot: ComparisonSnapshot,
    identity: { comparisonId: string; createdAt: string },
  ): RouteComparison {
    return this.computeFromSnapshot(snapshot, { ...identity, providerFailures: [] });
  }

  /**
   * The deterministic half of the service: snapshot in, comparison out, no I/O and no clock.
   * Both the live path and replay go through here, so there is only one calculation to trust.
   */
  private computeFromSnapshot(
    snapshot: ComparisonSnapshot,
    identity: {
      comparisonId: string;
      createdAt: string;
      providerFailures: readonly ProviderFailure[];
    },
  ): RouteComparison {
    const descriptorsById = new Map(
      snapshot.providers.map((descriptor) => [descriptor.id, descriptor]),
    );
    const weights = parseScoringWeights(snapshot.weights);
    const scorer = new RouteScorer(weights);

    const priced: PricedRoute[] = [];
    const pricingFailures: ProviderFailure[] = [];

    for (const quote of snapshot.quotes) {
      const descriptor = descriptorsById.get(quote.providerId);
      if (descriptor === undefined) {
        pricingFailures.push({
          providerId: quote.providerId,
          rail: quote.rail,
          code: 'MISSING_PROVIDER_DESCRIPTOR',
          message: `Snapshot has no descriptor for provider "${quote.providerId}".`,
          failedAt: snapshot.request.requestedAt,
        });
        continue;
      }
      try {
        priced.push(
          this.deps.costEngine.price(snapshot.request, quote, descriptor, {
            platformPricing: this.resolvePricingFor(snapshot, quote, descriptor),
          }),
        );
      } catch (error) {
        const appError = toAppError(error);
        this.deps.logger.warn('Failed to price provider quote', {
          providerId: quote.providerId,
          code: appError.code,
          message: appError.message,
        });
        pricingFailures.push({
          providerId: quote.providerId,
          rail: quote.rail,
          code: appError.code,
          message: appError.message,
          failedAt: snapshot.request.requestedAt,
        });
      }
    }

    const routes = scorer.score(priced);
    const recommended = routes.find((route) => route.recommended) ?? null;

    return {
      comparisonId: identity.comparisonId,
      createdAt: identity.createdAt,
      mode: snapshot.mode,
      engineVersion: snapshot.engineVersion,
      fingerprint: fingerprint(snapshot),
      request: snapshot.request,
      snapshot,
      routes,
      recommendedRouteId: recommended?.routeId ?? null,
      insights: this.buildInsights(routes),
      providerFailures: [...identity.providerFailures, ...pricingFailures],
    };
  }

  /**
   * Fetches the organization's candidate terms once per comparison.
   *
   * A failure here degrades to charging nothing rather than failing the comparison: the customer
   * still gets a usable answer, and under-charging is the safer direction to fail in. It is logged at
   * error level because silently forgoing revenue is not something to discover from a ledger.
   */
  private async loadPricingRules(input: ComparisonInput): Promise<readonly PlatformPricingRule[]> {
    const resolver = this.deps.pricingResolver;
    if (resolver === undefined || input.organizationId === null) {
      return [];
    }

    try {
      return await resolver.rulesFor({
        organizationId: input.organizationId,
        sourceCurrency: input.sourceCurrency,
        targetCurrency: input.targetCurrency,
        at: this.deps.clock.nowIso(),
      });
    } catch (error) {
      this.deps.logger.error('Could not load platform pricing; quoting without a platform fee', {
        organizationId: input.organizationId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Selects the term that applies to one route.
   *
   * Pure, and driven entirely by the snapshot, so a replay resolves exactly the terms that were in
   * force when the comparison was made rather than whatever is current.
   */
  private resolvePricingFor(
    snapshot: ComparisonSnapshot,
    quote: ProviderQuote,
    descriptor: ProviderDescriptor,
  ): PlatformPricing {
    // Read defensively rather than trusting the type: snapshots stored by engine 1.x predate both
    // fields, and they arrive here straight from persistence without validation. Treating an absent
    // field as "no terms" is what those comparisons meant; anything stricter silently unpriced every
    // route in a legacy replay, which is how this line earned its test.
    const organizationId = snapshot.organizationId ?? null;
    const pricingRules = snapshot.pricingRules ?? [];
    if (organizationId === null || pricingRules.length === 0) {
      return NO_PLATFORM_PRICING;
    }

    const rule = selectPricingRule(pricingRules, {
      organizationId,
      sourceCurrency: snapshot.request.sourceCurrency,
      targetCurrency: snapshot.request.targetCurrency,
      rail: quote.rail,
      providerId: descriptor.id,
      at: snapshot.request.requestedAt,
    });

    return toPlatformPricing(rule, {
      sourceCurrency: snapshot.request.sourceCurrency,
      midMarketRate: Rate.of(
        snapshot.request.sourceCurrency,
        snapshot.request.targetCurrency,
        quote.midMarketRate,
      ),
    });
  }

  private buildInsights(routes: readonly ScoredRoute[]): ComparisonInsights | null {
    const recommended = routes[0];
    if (recommended === undefined) {
      return null;
    }

    const cheapest = pickBy(routes, (a, b) => a.totalCost.lessThan(b.totalCost));
    const fastest = pickBy(routes, (a, b) => a.settlement.p50Seconds < b.settlement.p50Seconds);
    const mostExpensive = pickBy(routes, (a, b) => a.totalCost.greaterThan(b.totalCost));

    const savings = mostExpensive.totalCost.subtract(recommended.totalCost);
    const benchmark = recommended.benchmarkAmount.toDecimal();
    const bankBaseline = routes
      .filter((route) => route.rail === 'bank_fx')
      .reduce<ScoredRoute | null>(
        (best, route) => (best === null || route.totalCost.lessThan(best.totalCost) ? route : best),
        null,
      );

    return {
      cheapestRouteId: cheapest.routeId,
      fastestRouteId: fastest.routeId,
      mostExpensiveRouteId: mostExpensive.routeId,
      savingsVsMostExpensive: savings,
      savingsVsMostExpensiveBps: benchmark.isZero()
        ? new Dec(0)
        : savings.toDecimal().div(benchmark).times(10_000),
      savingsVsBankFx:
        bankBaseline === null ? null : bankBaseline.totalCost.subtract(recommended.totalCost),
    };
  }

  private async requestQuote(
    provider: RouteProvider,
    request: QuoteRequest,
    input: ComparisonInput,
    comparisonId: string,
  ): Promise<QuoteOutcome> {
    const { clock, logger, auditLogger, providerTimeoutMs } = this.deps;
    const providerId = provider.descriptor.id;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    try {
      const pending = provider.fetchQuote(request, {
        clock,
        logger: logger.child({ providerId }),
        requestId: input.requestId,
        signal: controller.signal,
      });
      // A late rejection after the timeout has already won the race would otherwise surface as an
      // unhandled rejection; the race still observes the original outcome.
      void pending.catch(() => undefined);

      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new ProviderTimeoutError(providerId, providerTimeoutMs));
        }, providerTimeoutMs);
      });

      const quote = await Promise.race([pending, timeout]);

      await auditLogger.record({
        type: 'provider.quote.received',
        actor: input.actor,
        requestId: input.requestId,
        comparisonId,
        providerId,
        payload: {
          quotedAt: quote.quotedAt,
          quoteReference: quote.quoteReference,
          offeredRate: quote.offeredRate,
          midMarketRate: quote.midMarketRate,
          pricingVersion: quote.pricingVersion,
        },
      });

      // Freshness is checked here, at ingestion, and deliberately nowhere near the snapshot
      // computation: a replay prices quotes that are weeks old by design, whereas admitting an
      // already-expired quote into a live comparison would rank a price nobody can transact on.
      // Checked after the received-event above, so a quote that arrived dead is still evidenced.
      this.assertQuoteCurrent(quote);

      return { ok: true, quote, descriptor: provider.descriptor };
    } catch (error) {
      const appError = toAppError(error);
      logger.warn('Provider failed to quote', {
        providerId,
        code: appError.code,
        message: appError.message,
        operational: isAppError(error) ? error.operational : false,
      });

      const failure: ProviderFailure = {
        providerId,
        rail: provider.descriptor.rail,
        code: appError.code,
        message: appError.message,
        failedAt: clock.nowIso(),
      };

      await auditLogger.record({
        type: 'provider.quote.failed',
        actor: input.actor,
        requestId: input.requestId,
        comparisonId,
        providerId,
        payload: { code: appError.code, message: appError.message },
      });

      return { ok: false, failure };
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }

  /**
   * Rejects a quote that is already unusable at the moment it arrives.
   *
   * Expiry, staleness and implausible clock skew all end the same way — the quote becomes a
   * per-provider failure and the comparison degrades — but they keep their distinct error codes,
   * because the operational responses differ: an expired quote means the provider's TTL is shorter
   * than our fan-out latency, a stale one means an adapter is serving cached prices, and a skewed
   * one means somebody's clock is wrong.
   *
   * A quote with no stated expiry is exempt entirely: the freshness model reasons about the window
   * between issue and expiry, and without an expiry there is no window to assess. Every current
   * adapter stamps one; this tolerance exists for the engine-facing contract, where `expiresAt` is
   * nullable.
   */
  private assertQuoteCurrent(quote: ProviderQuote): void {
    if (quote.expiresAt === null) {
      return;
    }
    assertQuoteUsable(
      {
        providerId: quote.providerId,
        timestamp: quote.quotedAt,
        expiresAt: quote.expiresAt,
        quoteReference: quote.quoteReference,
      },
      this.deps.clock.nowMs(),
      this.deps.freshnessPolicy ?? DEFAULT_FRESHNESS_POLICY,
    );
  }

  private assertValidCorridor(input: ComparisonInput): void {
    if (input.sourceCurrency === input.targetCurrency) {
      throw new ValidationError(
        'Source and target currencies must differ. Meridian compares cross-currency routes.',
        { currency: input.sourceCurrency },
      );
    }
    const amount = Money.ofMinorUnits(input.sourceCurrency, input.amountMinorUnits);
    if (!amount.isPositive()) {
      throw new ValidationError('Amount must be greater than zero.', {
        amountMinorUnits: input.amountMinorUnits,
      });
    }
  }
}

function sortById<T>(items: readonly T[], key: (item: T) => string): readonly T[] {
  return [...items].sort((left, right) => key(left).localeCompare(key(right), 'en'));
}

function pickBy<T>(
  items: readonly [T, ...T[]] | readonly T[],
  isBetter: (a: T, b: T) => boolean,
): T {
  const [first, ...rest] = items;
  if (first === undefined) {
    throw new NoRoutesAvailableError('Cannot select from an empty route set.');
  }
  return rest.reduce((best, candidate) => (isBetter(candidate, best) ? candidate : best), first);
}

function toJsonFailure(failure: ProviderFailure): Record<string, string | null> {
  return {
    providerId: failure.providerId,
    rail: failure.rail,
    code: failure.code,
    message: failure.message,
    failedAt: failure.failedAt,
  };
}
