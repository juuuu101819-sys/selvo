import type { PlatformMode, ProviderFailure } from '../domain/index.js';
import { assertStablecoinCorridor } from '../domain/stablecoin.js';
import {
  ProviderTimeoutError,
  UnsupportedCorridorError,
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
import { MultiRailCostEngine, NO_ROUTING_PLATFORM_CHARGE } from './routing-cost.js';
import { STABLECOIN_ROUTING_ENGINE_VERSION } from './stablecoin-config.js';
import { explainStablecoinRouting, projectStablecoinRoute } from './stablecoin-project.js';
import type { StablecoinRouting } from './stablecoin-types.js';

export interface StablecoinRoutingInput {
  readonly organizationId: string | null;
  readonly sourceAsset: string;
  readonly destinationAsset: string;
  readonly amountMinorUnits: string;
  readonly actor: string;
  readonly requestId: string | null;
}

export interface StablecoinRouterDependencies {
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
 * Stablecoin routing layer: fiat ↔ stablecoin and stablecoin ↔ stablecoin only.
 *
 * Uses the financial catalog and {@link MultiRailCostEngine} so a new stablecoin is a registry
 * row plus adapter coverage — this class does not switch on USDC or USDT. It never connects to
 * a chain, never creates a wallet, and never holds a key.
 */
export class StablecoinRouter {
  constructor(private readonly deps: StablecoinRouterDependencies) {}

  async evaluate(input: StablecoinRoutingInput): Promise<StablecoinRouting> {
    const conversionKind = assertStablecoinCorridor(input.sourceAsset, input.destinationAsset);
    AssetAmount.ofMinorUnits(input.sourceAsset, input.amountMinorUnits);

    const requestedAt = this.deps.clock.nowIso();
    const request: NormalizedQuoteRequest = {
      sourceAsset: input.sourceAsset,
      targetAsset: input.destinationAsset,
      amountMinorUnits: input.amountMinorUnits,
      requestedAt,
    };
    const routingId = this.deps.ids.generate('stb');

    await this.deps.auditLogger.record({
      type: 'routing.stablecoin.requested',
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
      } satisfies JsonObject,
    });

    const eligible = this.deps.registry.eligible(request).filter((provider) =>
      provider.getCapabilities().conversionKinds.includes(conversionKind),
    );

    if (eligible.length === 0) {
      await this.deps.auditLogger.record({
        type: 'routing.stablecoin.failed',
        actor: input.actor,
        requestId: input.requestId,
        comparisonId: null,
        providerId: null,
        payload: {
          routingId,
          reason: 'no eligible stablecoin provider',
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
        type: 'routing.stablecoin.failed',
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

    const priced = quotes.map(({ quote, provider }) =>
      this.deps.costEngine.price(
        quote,
        provider.descriptor,
        provider.getCapabilities(),
        NO_ROUTING_PLATFORM_CHARGE,
      ),
    );
    priced.sort((left, right) => {
      const cost = left.totalCostBps.comparedTo(right.totalCostBps);
      if (cost !== 0) {
        return cost;
      }
      if (left.settlement.p50Seconds !== right.settlement.p50Seconds) {
        return left.settlement.p50Seconds - right.settlement.p50Seconds;
      }
      return left.routeId.localeCompare(right.routeId, 'en');
    });

    const routes = priced.map((route, index) =>
      projectStablecoinRoute(route, index + 1, index === 0),
    );
    const recommended = routes[0] ?? null;

    await this.deps.auditLogger.record({
      type: 'routing.stablecoin.completed',
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
        custody: false,
        connectedToMainnet: false,
        stablecoinRoutingEngineVersion: STABLECOIN_ROUTING_ENGINE_VERSION,
      } satisfies JsonObject,
    });

    return {
      routingId,
      organizationId: input.organizationId,
      createdAt: requestedAt,
      mode: this.deps.mode,
      stablecoinRoutingEngineVersion: STABLECOIN_ROUTING_ENGINE_VERSION,
      conversionKind,
      aiUsed: false,
      custody: false,
      connectedToMainnet: false,
      walletsCreated: false,
      privateKeysGenerated: false,
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
      providerFailures: failures,
      explanation: explainStablecoinRouting(
        input.sourceAsset,
        input.destinationAsset,
        routes.length,
      ),
    };
  }

  private async requestQuote(
    provider: FinancialProvider,
    request: NormalizedQuoteRequest,
    input: StablecoinRoutingInput,
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
          layer: 'stablecoin',
        } satisfies JsonObject,
      });

      return { ok: true, quote, provider };
    } catch (error) {
      const appError = toAppError(error);
      logger.warn('Stablecoin provider failed to quote', {
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
        payload: { code: failure.code, layer: 'stablecoin' } satisfies JsonObject,
      });
      return { ok: false, failure };
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }
}
