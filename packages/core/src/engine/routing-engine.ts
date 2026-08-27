import type {
  PlatformMode,
  PlatformPricingRule,
  ProviderDescriptor,
  ProviderFailure,
} from '../domain/index.js';
import { assetKind, isFiatAsset } from '../domain/asset.js';
import { conversionKindOf } from '../domain/conversion.js';
import {
  NoRoutesAvailableError,
  ProviderTimeoutError,
  UnsupportedCorridorError,
  ValidationError,
  isAppError,
  toAppError,
} from '../errors/index.js';
import { Dec, isCurrencyCode, type Decimal } from '../money/index.js';
import { AssetAmount } from '../money/asset-amount.js';
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

export interface RoutingEngineInput {
  readonly organizationId: string | null;
  readonly sourceAsset: string;
  readonly destinationAsset: string;
  readonly amountMinorUnits: string;
  readonly weights: RoutingWeightsInput | null;
  readonly actor: string;
  readonly requestId: string | null;
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
}

type QuoteOutcome =
  | { readonly ok: true; readonly quote: NormalizedQuote; readonly provider: FinancialProvider }
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

    await auditLogger.record({
      type: 'routing.requested',
      actor: input.actor,
      requestId: input.requestId,
      comparisonId: null,
      providerId: null,
      payload: {
        routingId,
        sourceAsset: input.sourceAsset,
        destinationAsset: input.destinationAsset,
        amountMinorUnits: input.amountMinorUnits,
        organizationId: input.organizationId,
        weights: serializeRoutingWeights(weights),
        aiUsed: false,
      },
    });

    const eligible = registry.eligible(request);
    if (eligible.length === 0) {
      await auditLogger.record({
        type: 'routing.failed',
        actor: input.actor,
        requestId: input.requestId,
        comparisonId: null,
        providerId: null,
        payload: {
          routingId,
          reason: 'no eligible provider',
          registeredProviderCount: registry.all().length,
        },
      });
      throw new UnsupportedCorridorError(input.sourceAsset, input.destinationAsset, {
        amount: AssetAmount.ofMinorUnits(input.sourceAsset, input.amountMinorUnits).toString(),
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
        comparisonId: null,
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
    const priced: PricedMultiRailRoute[] = [];
    const pricingFailures: ProviderFailure[] = [];

    for (const { quote, provider } of quotes) {
      try {
        priced.push(
          this.deps.costEngine.price(
            quote,
            provider.descriptor,
            provider.getCapabilities(),
            this.platformCharge(input, provider.descriptor, pricingRules, requestedAt),
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
    };

    await auditLogger.record({
      type: 'routing.completed',
      actor: input.actor,
      requestId: input.requestId,
      comparisonId: null,
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
    if (
      resolver === undefined ||
      input.organizationId === null ||
      !isFiatAsset(input.sourceAsset) ||
      !isFiatAsset(input.destinationAsset) ||
      !isCurrencyCode(input.sourceAsset) ||
      !isCurrencyCode(input.destinationAsset)
    ) {
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
    if (
      input.organizationId === null ||
      pricingRules.length === 0 ||
      !isCurrencyCode(input.sourceAsset) ||
      !isCurrencyCode(input.destinationAsset)
    ) {
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
    return {
      markupBps: parseDecimal(rule.markupBps),
      discountBps: parseDecimal(rule.discountBps),
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
        comparisonId: null,
        providerId,
        payload: {
          conversionKind: quote.conversionKind,
          sourceAsset: quote.sourceAsset,
          targetAsset: quote.targetAsset,
          indicatedRate: quote.indicatedRate,
          executable: false,
        },
      });

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
        comparisonId: null,
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
