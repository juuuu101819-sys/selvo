import type {
  PlatformMode,
  PlatformPricingRule,
  ProviderDescriptor,
  ProviderFailure,
  RailType,
} from '../domain/index.js';
import { assetKind } from '../domain/asset.js';
import { conversionKindOf } from '../domain/conversion.js';
import {
  NoRoutesAvailableError,
  ProviderTimeoutError,
  UnsupportedCorridorError,
  ValidationError,
  isAppError,
  toAppError,
} from '../errors/index.js';
import { Dec, type Decimal } from '../money/index.js';
import { AssetAmount } from '../money/asset-amount.js';
import { Rounding } from '../money/decimal.js';
import type {
  AuditLogger,
  Clock,
  FinancialProvider,
  IdGenerator,
  Logger,
  NormalizedQuote,
  NormalizedQuoteRequest,
  PlatformPricingResolver,
} from '../ports/index.js';
import { selectPricingRule } from './platform-pricing.js';
import type { FinancialProviderRegistry } from './financial-registry.js';
import { admitNormalizedQuote } from './quote-admission.js';
import { freshnessPolicyForRail } from '../quotes/rail-freshness.js';
import { quoteFreshnessView } from '../quotes/quote-freshness.js';
import { NO_ROUTING_PLATFORM_CHARGE, type RoutingPlatformCharge } from './routing-cost.js';
import type { MultiRailCostEngine } from './routing-cost.js';
import {
  ROUTING_ENGINE_VERSION,
  parseRoutingWeights,
  serializeRoutingWeights,
  type RoutingWeights,
  type RoutingWeightsInput,
} from './routing-config.js';
import { MultiRailScorer } from './routing-scorer.js';
import { explainRecommendation } from './routing-explanation.js';
import type { MultiRailRouting, PlannedRoute, PricedMultiRailRoute } from './routing-types.js';
import type { RoutingComparisonSnapshot } from './routing-snapshot.js';
import type { ExecutionPartnerRegistry } from './execution-partner-registry.js';
import { partnerSupportsRequest } from './partner-capability.js';

export interface RoutingEngineInput {
  readonly organizationId: string | null;
  readonly sourceAsset: string;
  readonly destinationAsset: string;
  readonly amountMinorUnits: string;
  readonly weights: RoutingWeightsInput | null;
  readonly actor: string;
  readonly requestId: string | null;
  /** Restrict eligible providers to these rails. `null` / omitted means every rail. */
  readonly rails?: readonly RailType[] | null | undefined;
  /** When set, provider quote audit events attach to this comparison id. */
  readonly comparisonId?: string | null | undefined;
}

export interface MultiRailRouterDependencies {
  readonly mode: PlatformMode;
  readonly registry: FinancialProviderRegistry;
  readonly costEngine: MultiRailCostEngine;
  readonly defaultWeights: RoutingWeights;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly auditLogger: AuditLogger;
  readonly logger: Logger;
  readonly providerTimeoutMs: number;
  readonly pricingResolver?: PlatformPricingResolver | undefined;
  /**
   * When set, financial providers that have a linked execution partner are admitted only if that
   * partner's corridor/currency/limit/hours cover the request. Quote-only providers are unchanged.
   */
  readonly executionPartners?: ExecutionPartnerRegistry | undefined;
}

type QuoteOutcome =
  | {
      readonly ok: true;
      readonly quote: NormalizedQuote;
      readonly provider: FinancialProvider;
    }
  | { readonly ok: false; readonly failure: ProviderFailure };

/**
 * Evaluates Traditional Finance, stablecoin and DeFi quotes in one normalised framework.
 *
 * Deterministic: ranking is a pure function of quotes and weights. A dead provider degrades the
 * result instead of failing it. AI is not consulted for any figure.
 */
export class MultiRailRouter {
  constructor(private readonly deps: MultiRailRouterDependencies) {}

  async evaluate(input: RoutingEngineInput): Promise<MultiRailRouting> {
    const { clock, registry, auditLogger, logger } = this.deps;

    this.assertValidCorridor(input);
    const weights =
      input.weights === null ? this.deps.defaultWeights : parseRoutingWeights(input.weights);

    const requestedAt = clock.nowIso();
    const request: NormalizedQuoteRequest = {
      sourceAsset: input.sourceAsset,
      targetAsset: input.destinationAsset,
      amountMinorUnits: input.amountMinorUnits,
      requestedAt,
    };

    const routingId = this.deps.ids.generate('rte');
    const comparisonId = input.comparisonId ?? null;

    await auditLogger.record({
      type: 'routing.requested',
      actor: input.actor,
      requestId: input.requestId,
      comparisonId,
      providerId: null,
      payload: {
        routingId,
        sourceAsset: input.sourceAsset,
        destinationAsset: input.destinationAsset,
        amountMinorUnits: input.amountMinorUnits,
        organizationId: input.organizationId,
        weights: serializeRoutingWeights(weights),
        rails: input.rails === undefined || input.rails === null ? null : [...input.rails],
        aiUsed: false,
      },
    });

    let eligible = registry.eligible(request);
    if (input.rails !== undefined && input.rails !== null) {
      const allowed = new Set(input.rails);
      eligible = eligible.filter((provider) => allowed.has(provider.descriptor.rail));
    }
    const partnerRegistry = this.deps.executionPartners;
    if (partnerRegistry !== undefined) {
      eligible = eligible.filter((provider) => {
        const linked = partnerRegistry.forQuotedProvider(provider.descriptor.id);
        if (linked.length === 0) {
          return true;
        }
        return linked.some((partner) =>
          partnerSupportsRequest(partner.capabilities, {
            sourceAsset: input.sourceAsset,
            destinationAsset: input.destinationAsset,
            amountMinorUnits: input.amountMinorUnits,
            atIso: requestedAt,
          }),
        );
      });
    }
    if (eligible.length === 0) {
      await auditLogger.record({
        type: 'routing.failed',
        actor: input.actor,
        requestId: input.requestId,
        comparisonId: input.comparisonId ?? null,
        providerId: null,
        payload: {
          routingId,
          reason: 'no eligible provider',
          registeredProviderCount: registry.all().length,
        },
      });
      throw new UnsupportedCorridorError(input.sourceAsset, input.destinationAsset, {
        amount: AssetAmount.ofMinorUnits(input.sourceAsset, input.amountMinorUnits).toString(),
        rails: input.rails === undefined || input.rails === null ? null : [...input.rails],
      });
    }

    const outcomes = await Promise.all(
      eligible.map((provider) => this.requestQuote(provider, request, input)),
    );

    const quotes: { quote: NormalizedQuote; provider: FinancialProvider }[] = [];
    const failures: ProviderFailure[] = [];
    for (const outcome of outcomes) {
      if (outcome.ok) {
        quotes.push({ quote: outcome.quote, provider: outcome.provider });
      } else {
        failures.push(outcome.failure);
      }
    }

    if (quotes.length === 0) {
      await auditLogger.record({
        type: 'routing.failed',
        actor: input.actor,
        requestId: input.requestId,
        comparisonId: input.comparisonId ?? null,
        providerId: null,
        payload: {
          routingId,
          reason: 'every provider failed to quote',
          failures: failures.map((failure) => ({ ...failure })),
        },
      });
      throw new NoRoutesAvailableError(
        'No provider returned a usable quote for this corridor.',
        { providerFailures: failures.map((failure) => ({ ...failure })) },
      );
    }

    const pricingRules = await this.loadPricingRules(input);
    const rankingAtMs = clock.nowMs();
    const priced: PricedMultiRailRoute[] = [];
    const pricingFailures: ProviderFailure[] = [];

    for (const { quote, provider } of quotes) {
      try {
        const freshness = admitNormalizedQuote(quote, provider.descriptor.rail, rankingAtMs);
        priced.push(
          this.deps.costEngine.price(
            quote,
            provider.descriptor,
            provider.getCapabilities(),
            this.platformCharge(input, provider.descriptor, pricingRules, requestedAt),
            freshness,
          ),
        );
      } catch (error) {
        const appError = toAppError(error);
        logger.warn('Failed to price a normalised quote', {
          providerId: provider.descriptor.id,
          code: appError.code,
          message: appError.message,
        });
        pricingFailures.push({
          providerId: provider.descriptor.id,
          rail: provider.descriptor.rail,
          code: appError.code,
          message: appError.message,
          failedAt: clock.nowIso(),
        });
      }
    }

    if (priced.length === 0) {
      throw new NoRoutesAvailableError(
        'Providers quoted this corridor but none produced a usable priced route.',
        { providerFailures: [...failures, ...pricingFailures] },
      );
    }

    const routes = new MultiRailScorer(weights).score(priced);
    const recommended = routes[0] ?? null;
    const allFailures = [...failures, ...pricingFailures];

    const result: MultiRailRouting = {
      routingId,
      organizationId: input.organizationId,
      createdAt: requestedAt,
      mode: this.deps.mode,
      routingEngineVersion: ROUTING_ENGINE_VERSION,
      aiUsed: false,
      request: {
        sourceAsset: input.sourceAsset,
        destinationAsset: input.destinationAsset,
        amountMinorUnits: input.amountMinorUnits,
        requestedAt,
      },
      scoringWeights: serializeRoutingWeights(weights),
      routes,
      recommendedRoute: recommended,
      routeScore: recommended?.routeScore ?? null,
      estimatedCost: recommended?.totalCost ?? null,
      estimatedReceiveAmount: recommended?.deliveredAmount ?? null,
      estimatedSettlementTime: recommended?.settlement ?? null,
      routeExplanation: explainRecommendation(recommended),
      plannedRoutes: plannedRoutesOf(input.sourceAsset, input.destinationAsset),
      providerFailures: allFailures,
      pricingRules,
    };

    await auditLogger.record({
      type: 'routing.completed',
      actor: input.actor,
      requestId: input.requestId,
      comparisonId,
      providerId: recommended?.provider.id ?? null,
      payload: {
        routingId,
        routeCount: routes.length,
        recommendedRouteId: recommended?.routeId ?? null,
        routeScore: recommended?.routeScore.toFixed() ?? null,
        failedProviderCount: allFailures.length,
        aiUsed: false,
      },
    });

    return result;
  }

  /**
   * Re-prices stored MultiRail quotes. Used by `/comparisons` replay. Does not fetch providers
   * and does not call the fiat {@link RouteComparisonService}.
   */
  recomputeFromSnapshot(snapshot: RoutingComparisonSnapshot): MultiRailRouting {
    const weights = parseRoutingWeights(snapshot.weights);
    const priced: PricedMultiRailRoute[] = [];
    const pricingFailures: ProviderFailure[] = [];
    const descriptors = new Map(snapshot.providers.map((provider) => [provider.id, provider]));

    for (const quote of snapshot.quotes) {
      const descriptor = descriptors.get(quote.providerId);
      const capabilities = snapshot.capabilities[quote.providerId];
      if (descriptor === undefined || capabilities === undefined) {
        pricingFailures.push({
          providerId: quote.providerId,
          rail: descriptor?.rail ?? null,
          code: 'MISSING_PROVIDER_DESCRIPTOR',
          message: `Snapshot has no descriptor or capabilities for provider "${quote.providerId}".`,
          failedAt: snapshot.request.requestedAt,
        });
        continue;
      }
      try {
        const freshness = quoteFreshnessView(
          quote,
          Date.parse(snapshot.request.requestedAt),
          freshnessPolicyForRail(descriptor.rail),
        );
        priced.push(
          this.deps.costEngine.price(
            quote,
            descriptor,
            capabilities,
            this.platformCharge(
              {
                organizationId: snapshot.organizationId,
                sourceAsset: snapshot.request.sourceAsset,
                destinationAsset: snapshot.request.destinationAsset,
                amountMinorUnits: snapshot.request.amountMinorUnits,
                weights: null,
                actor: 'replay',
                requestId: null,
              },
              descriptor,
              snapshot.pricingRules,
              snapshot.request.requestedAt,
            ),
            freshness,
          ),
        );
      } catch (error) {
        const appError = toAppError(error);
        pricingFailures.push({
          providerId: descriptor.id,
          rail: descriptor.rail,
          code: appError.code,
          message: appError.message,
          failedAt: snapshot.request.requestedAt,
        });
      }
    }

    if (priced.length === 0) {
      throw new NoRoutesAvailableError(
        'Stored quotes could not be re-priced for this comparison.',
        { providerFailures: [...snapshot.providerFailures, ...pricingFailures] },
      );
    }

    const routes = new MultiRailScorer(weights).score(priced);
    const recommended = routes[0] ?? null;
    return {
      routingId: snapshot.routingId,
      organizationId: snapshot.organizationId,
      createdAt: snapshot.request.requestedAt,
      mode: snapshot.mode,
      routingEngineVersion: ROUTING_ENGINE_VERSION,
      aiUsed: false,
      request: {
        sourceAsset: snapshot.request.sourceAsset,
        destinationAsset: snapshot.request.destinationAsset,
        amountMinorUnits: snapshot.request.amountMinorUnits,
        requestedAt: snapshot.request.requestedAt,
      },
      scoringWeights: snapshot.weights,
      routes,
      recommendedRoute: recommended,
      routeScore: recommended?.routeScore ?? null,
      estimatedCost: recommended?.totalCost ?? null,
      estimatedReceiveAmount: recommended?.deliveredAmount ?? null,
      estimatedSettlementTime: recommended?.settlement ?? null,
      routeExplanation: explainRecommendation(recommended),
      plannedRoutes: plannedRoutesOf(snapshot.request.sourceAsset, snapshot.request.destinationAsset),
      providerFailures: [...snapshot.providerFailures, ...pricingFailures],
      pricingRules: snapshot.pricingRules,
    };
  }

  private assertValidCorridor(input: RoutingEngineInput): void {
    if (input.sourceAsset === input.destinationAsset) {
      throw new ValidationError('sourceAsset and destinationAsset must differ.', {
        sourceAsset: input.sourceAsset,
        destinationAsset: input.destinationAsset,
      });
    }
    conversionKindOf(input.sourceAsset, input.destinationAsset);
    AssetAmount.ofMinorUnits(input.sourceAsset, input.amountMinorUnits);
  }

  private async loadPricingRules(
    input: RoutingEngineInput,
  ): Promise<readonly PlatformPricingRule[]> {
    const resolver = this.deps.pricingResolver;
    if (resolver === undefined || input.organizationId === null) {
      return [];
    }

    try {
      return await resolver.rulesFor({
        organizationId: input.organizationId,
        sourceCurrency: input.sourceAsset,
        targetCurrency: input.destinationAsset,
        at: this.deps.clock.nowIso(),
      });
    } catch (error) {
      this.deps.logger.error('Could not load platform pricing; routing without a platform fee', {
        organizationId: input.organizationId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  private platformCharge(
    input: RoutingEngineInput,
    descriptor: ProviderDescriptor,
    pricingRules: readonly PlatformPricingRule[],
    requestedAt: string,
  ): RoutingPlatformCharge {
    if (input.organizationId === null || pricingRules.length === 0) {
      return NO_ROUTING_PLATFORM_CHARGE;
    }

    const rule = selectPricingRule(pricingRules, {
      organizationId: input.organizationId,
      sourceCurrency: input.sourceAsset,
      targetCurrency: input.destinationAsset,
      rail: descriptor.rail,
      providerId: descriptor.id,
      at: requestedAt,
    });
    if (rule === null) {
      return NO_ROUTING_PLATFORM_CHARGE;
    }

    const surchargeBps = rule.surchargeBps === undefined || rule.surchargeBps === null
      ? null
      : parseDecimal(rule.surchargeBps);
    const surcharge =
      surchargeBps === null || surchargeBps.isZero()
        ? null
        : {
            code: rule.surchargeCode ?? 'infrastructure_surcharge',
            label: rule.surchargeLabel ?? 'Configured infrastructure surcharge',
            rateBps: surchargeBps,
          };

    return {
      ruleId: rule.id,
      markupBps: parseDecimal(rule.markupBps),
      discountBps: parseDecimal(rule.discountBps),
      flatFee: flatFeeInSource(rule, input.sourceAsset),
      surcharge,
    };
  }

  private async requestQuote(
    provider: FinancialProvider,
    request: NormalizedQuoteRequest,
    input: RoutingEngineInput,
  ): Promise<QuoteOutcome> {
    const { clock, logger, auditLogger, providerTimeoutMs } = this.deps;
    const providerId = provider.descriptor.id;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    try {
      const pending = provider.getQuote(request, {
        clock,
        logger: logger.child({ providerId }),
        requestId: input.requestId,
        signal: controller.signal,
      });
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
        comparisonId: input.comparisonId ?? null,
        providerId,
        payload: {
          conversionKind: quote.conversionKind,
          sourceAsset: quote.sourceAsset,
          targetAsset: quote.targetAsset,
          indicatedRate: quote.indicatedRate,
          timestamp: quote.timestamp,
          expiresAt: quote.expiresAt,
          executable: false,
        },
      });

      admitNormalizedQuote(quote, provider.descriptor.rail, clock.nowMs());

      return { ok: true, quote, provider };
    } catch (error) {
      const appError = toAppError(error);
      logger.warn('Financial provider failed to quote', {
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
        comparisonId: input.comparisonId ?? null,
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
}

export function plannedRoutesOf(sourceAsset: string, destinationAsset: string): readonly PlannedRoute[] {
  if (assetKind(sourceAsset) !== 'fiat' || assetKind(destinationAsset) !== 'fiat') {
    return [];
  }
  return [
    {
      id: 'future-dex-hop',
      hops: [sourceAsset, 'Stablecoin', 'DEX liquidity', destinationAsset],
      status: 'planned',
      explanation:
        `Route D (${sourceAsset} → stablecoin → DEX liquidity → ${destinationAsset}) is not ` +
        'composed in routing engine 1.0.0. Direct DEX quotes are included when the corridor is ' +
        'on-chain. No hops are executed.',
    },
  ];
}

function parseDecimal(value: string): Decimal {
  return new Dec(value);
}

const USD_PEGGED = new Set(['USD', 'USDC', 'USDT']);

function flatFeeInSource(rule: PlatformPricingRule, sourceAsset: string): AssetAmount | null {
  if (rule.platformFeeMinorUnits === '0') {
    return null;
  }
  const feeAsset = rule.feeCurrency ?? sourceAsset;
  const declared = AssetAmount.ofMinorUnits(feeAsset, rule.platformFeeMinorUnits);
  if (declared.isZero()) {
    return null;
  }
  if (declared.asset === sourceAsset) {
    return declared;
  }
  if (USD_PEGGED.has(declared.asset) && USD_PEGGED.has(sourceAsset)) {
    return AssetAmount.fromDecimal(sourceAsset, declared.toDecimal(), Rounding.HALF_UP);
  }
  return declared.asset === sourceAsset ? declared : null;
}
