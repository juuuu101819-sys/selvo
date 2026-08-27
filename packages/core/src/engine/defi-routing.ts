import type { PlatformMode, ProviderFailure } from '../domain/index.js';
import { conversionKindOf } from '../domain/conversion.js';
import {
  ProviderTimeoutError,
  UnsupportedCorridorError,
  ValidationError,
  isAppError,
  toAppError,
} from '../errors/index.js';
import type { JsonObject } from '../domain/json.js';
import { AssetAmount } from '../money/asset-amount.js';
import type {
  AuditLogger,
  Clock,
  FinancialProvider,
  IdGenerator,
  Logger,
  NormalizedQuote,
  NormalizedQuoteRequest,
} from '../ports/index.js';
import type { FinancialProviderRegistry } from './financial-registry.js';
import { NO_ROUTING_PLATFORM_CHARGE, type MultiRailCostEngine } from './routing-cost.js';
import { DEFI_ROUTING_ENGINE_VERSION } from './defi-config.js';
import { explainDefiRouting, projectDefiRoute } from './defi-project.js';
import type { DefiRouting } from './defi-types.js';

export interface DefiRoutingInput {
  readonly organizationId: string | null;
  readonly sourceAsset: string;
  readonly destinationAsset: string;
  readonly amountMinorUnits: string;
  readonly actor: string;
  readonly requestId: string | null;
}

export interface DefiRouterDependencies {
  readonly mode: PlatformMode;
  readonly registry: FinancialProviderRegistry;
  readonly costEngine: MultiRailCostEngine;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly auditLogger: AuditLogger;
  readonly logger: Logger;
  readonly providerTimeoutMs: number;
}

type QuoteOutcome =
  | { readonly ok: true; readonly quote: NormalizedQuote; readonly provider: FinancialProvider }
  | { readonly ok: false; readonly failure: ProviderFailure };

/**
 * DeFi liquidity routing layer.
 *
 * Quotes DEX, AMM and aggregator venues through {@link FinancialProvider} (they also implement
 * {@link DeFiLiquiditySource}). When a stablecoin ramp or traditional FX desk can price the same
 * pair, those quotes are ranked in the same set. The engine does not switch on ticker or chain.
 * It never submits a swap, connects a wallet, or holds a key.
 */
export class DefiRouter {
  constructor(private readonly deps: DefiRouterDependencies) {}

  async evaluate(input: DefiRoutingInput): Promise<DefiRouting> {
    if (input.sourceAsset === input.destinationAsset) {
      throw new ValidationError('sourceAsset and destinationAsset must differ.', {
        sourceAsset: input.sourceAsset,
        destinationAsset: input.destinationAsset,
      });
    }
    const conversionKind = conversionKindOf(input.sourceAsset, input.destinationAsset);
    AssetAmount.ofMinorUnits(input.sourceAsset, input.amountMinorUnits);

    const requestedAt = this.deps.clock.nowIso();
    const request: NormalizedQuoteRequest = {
      sourceAsset: input.sourceAsset,
      targetAsset: input.destinationAsset,
      amountMinorUnits: input.amountMinorUnits,
      requestedAt,
    };
    const routingId = this.deps.ids.generate('def');

    await this.deps.auditLogger.record({
      type: 'routing.defi.requested',
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
        conversionKind,
        aiUsed: false,
        custody: false,
        connectedToMainnet: false,
        swapSubmitted: false,
      } satisfies JsonObject,
    });

    const eligible = this.deps.registry.eligible(request);

    if (eligible.length === 0) {
      await this.deps.auditLogger.record({
        type: 'routing.defi.failed',
        actor: input.actor,
        requestId: input.requestId,
        comparisonId: null,
        providerId: null,
        payload: {
          routingId,
          reason: 'no eligible DeFi, stablecoin or traditional provider',
        } satisfies JsonObject,
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
      await this.deps.auditLogger.record({
        type: 'routing.defi.failed',
        actor: input.actor,
        requestId: input.requestId,
        comparisonId: null,
        providerId: null,
        payload: {
          routingId,
          reason: 'every provider failed to quote',
        } satisfies JsonObject,
      });
      throw new UnsupportedCorridorError(input.sourceAsset, input.destinationAsset, {
        amount: AssetAmount.ofMinorUnits(input.sourceAsset, input.amountMinorUnits).toString(),
      });
    }

    const priced: { priced: ReturnType<MultiRailCostEngine['price']>; provider: FinancialProvider }[] =
      [];
    for (const entry of quotes) {
      try {
        priced.push({
          priced: this.deps.costEngine.price(
            entry.quote,
            entry.provider.descriptor,
            entry.provider.getCapabilities(),
            NO_ROUTING_PLATFORM_CHARGE,
          ),
          provider: entry.provider,
        });
      } catch (error) {
        const appError = toAppError(error);
        this.deps.logger.warn('DeFi-layer provider quote failed cost conversion', {
          providerId: entry.provider.descriptor.id,
          code: appError.code,
          message: appError.message,
        });
        failures.push({
          providerId: entry.provider.descriptor.id,
          rail: entry.provider.descriptor.rail,
          code: appError.code,
          message: appError.message,
          failedAt: this.deps.clock.nowIso(),
        });
      }
    }

    if (priced.length === 0) {
      await this.deps.auditLogger.record({
        type: 'routing.defi.failed',
        actor: input.actor,
        requestId: input.requestId,
        comparisonId: null,
        providerId: null,
        payload: {
          routingId,
          reason: 'every provider failed to quote',
        } satisfies JsonObject,
      });
      throw new UnsupportedCorridorError(input.sourceAsset, input.destinationAsset, {
        amount: AssetAmount.ofMinorUnits(input.sourceAsset, input.amountMinorUnits).toString(),
      });
    }
    priced.sort((left, right) => {
      const cost = left.priced.totalCostBps.comparedTo(right.priced.totalCostBps);
      if (cost !== 0) {
        return cost;
      }
      if (left.priced.settlement.p50Seconds !== right.priced.settlement.p50Seconds) {
        return left.priced.settlement.p50Seconds - right.priced.settlement.p50Seconds;
      }
      return left.priced.routeId.localeCompare(right.priced.routeId, 'en');
    });

    const routes = priced.map((entry, index) =>
      projectDefiRoute(entry.priced, entry.provider, index + 1, index === 0),
    );
    const recommended = routes[0] ?? null;
    const comparedFamilies = uniqueFamilies(routes.map((route) => route.provider.category));

    await this.deps.auditLogger.record({
      type: 'routing.defi.completed',
      actor: input.actor,
      requestId: input.requestId,
      comparisonId: null,
      providerId: recommended?.provider.id ?? null,
      payload: {
        routingId,
        routeCount: routes.length,
        recommendedRouteId: recommended?.routeId ?? null,
        conversionKind,
        executable: false,
        swapSubmitted: false,
        custody: false,
        connectedToMainnet: false,
        defiRoutingEngineVersion: DEFI_ROUTING_ENGINE_VERSION,
      } satisfies JsonObject,
    });

    return {
      routingId,
      organizationId: input.organizationId,
      createdAt: requestedAt,
      mode: this.deps.mode,
      defiRoutingEngineVersion: DEFI_ROUTING_ENGINE_VERSION,
      conversionKind,
      aiUsed: false,
      custody: false,
      connectedToMainnet: false,
      walletsCreated: false,
      walletsConnected: false,
      privateKeysGenerated: false,
      swapSubmitted: false,
      executable: false,
      delegateExecution: false,
      request: {
        sourceAsset: input.sourceAsset,
        destinationAsset: input.destinationAsset,
        amountMinorUnits: input.amountMinorUnits,
        requestedAt,
      },
      routes,
      recommendedRoute: recommended,
      recommendedExecutionRoute: recommended,
      comparedFamilies,
      providerFailures: failures,
      explanation: explainDefiRouting(
        input.sourceAsset,
        input.destinationAsset,
        routes.length,
        comparedFamilies,
      ),
    };
  }

  private async requestQuote(
    provider: FinancialProvider,
    request: NormalizedQuoteRequest,
    input: DefiRoutingInput,
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
          layer: 'defi',
        } satisfies JsonObject,
      });

      return { ok: true, quote, provider };
    } catch (error) {
      const appError = toAppError(error);
      logger.warn('DeFi-layer provider failed to quote', {
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
        payload: { code: failure.code, layer: 'defi' } satisfies JsonObject,
      });
      return { ok: false, failure };
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }
}

function uniqueFamilies(
  categories: readonly string[],
): readonly ('defi' | 'stablecoin' | 'traditional')[] {
  const order = ['defi', 'stablecoin', 'traditional'] as const;
  const seen = new Set(categories);
  return order.filter((family) => seen.has(family));
}
