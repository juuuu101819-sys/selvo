import type { ComparisonInput } from './comparison-service.js';
import {
  serializeComparisonFromRouting,
  routingWeightsFromComparisonInput,
} from './comparison-from-routing.js';
import { ROUTING_ENGINE_VERSION } from './routing-config.js';
import type { MultiRailRouter } from './routing-engine.js';
import type { FinancialProviderRegistry } from './financial-registry.js';
import {
  isRoutingComparisonSnapshot,
  snapshotFromRouting,
  type RoutingComparisonSnapshot,
} from './routing-snapshot.js';
import type { ComparisonDto, ReplayResultDto } from '../serialization/dto.js';
import type { ProviderCapabilityProfile } from '../domain/provider-catalog.js';
import { NotFoundError } from '../errors/index.js';
import { fingerprint } from '../reproducibility/index.js';
import type {
  AuditLogger,
  Clock,
  ComparisonRepository,
  IdGenerator,
  Logger,
} from '../ports/index.js';
import type { MultiRailRouting } from './routing-types.js';

export interface RoutingBackedComparison {
  readonly comparisonId: string;
  readonly createdAt: string;
  readonly organizationId: string | null;
  readonly fingerprint: string;
  readonly dto: ComparisonDto;
  readonly routing: MultiRailRouting;
  readonly snapshot: RoutingComparisonSnapshot;
}

export interface ComparisonRoutingServiceDependencies {
  readonly routing: MultiRailRouter;
  readonly registry: FinancialProviderRegistry;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly auditLogger: AuditLogger;
  readonly comparisons: ComparisonRepository;
  readonly logger: Logger;
}

/**
 * `/comparisons` facade over {@link MultiRailRouter}.
 *
 * This is the only ranking path reachable from HTTP. {@link RouteComparisonService} remains for
 * unit tests and seed data and is not constructed into a request handler.
 */
export class ComparisonRoutingService {
  constructor(private readonly deps: ComparisonRoutingServiceDependencies) {}

  async compare(input: ComparisonInput): Promise<RoutingBackedComparison> {
    const { comparisons, logger, auditLogger, ids } = this.deps;

    if (input.idempotencyKey !== null) {
      const existing = await comparisons.findByIdempotencyKey(input.idempotencyKey);
      if (existing !== null) {
        logger.info('Returning comparison from idempotency key', {
          comparisonId: existing.comparisonId,
        });
        return rehydrateStored(existing);
      }
    }

    const comparisonId = ids.generate('cmp');

    await auditLogger.record({
      type: 'comparison.requested',
      actor: input.actor,
      requestId: input.requestId,
      comparisonId,
      providerId: null,
      payload: {
        sourceCurrency: input.sourceCurrency,
        targetCurrency: input.targetCurrency,
        amountMinorUnits: input.amountMinorUnits,
        rails: input.rails === null ? null : [...input.rails],
        engine: 'multi_rail',
        routingEngineVersion: ROUTING_ENGINE_VERSION,
      },
    });

    const routing = await this.deps.routing.evaluate({
      organizationId: input.organizationId,
      sourceAsset: input.sourceCurrency,
      destinationAsset: input.targetCurrency,
      amountMinorUnits: input.amountMinorUnits,
      weights: routingWeightsFromComparisonInput(input.weights),
      actor: input.actor,
      requestId: input.requestId,
      rails: input.rails,
      comparisonId,
    });

    const snapshot = snapshotFromRouting(
      routing,
      input.rails,
      routing.pricingRules,
      capabilitiesOf(routing, this.deps.registry),
    );
    const digest = fingerprint(snapshot);
    const dto = serializeComparisonFromRouting({
      comparisonId,
      fingerprint: digest,
      rails: input.rails,
      routing,
    });

    await comparisons.save({
      comparisonId,
      createdAt: routing.createdAt,
      mode: routing.mode,
      engineVersion: ROUTING_ENGINE_VERSION,
      fingerprint: digest,
      sourceCurrency: input.sourceCurrency,
      targetCurrency: input.targetCurrency,
      amountMinorUnits: input.amountMinorUnits,
      idempotencyKey: input.idempotencyKey,
      organizationId: input.organizationId,
      snapshot,
      result: dto,
    });

    await auditLogger.record({
      type: 'comparison.completed',
      actor: input.actor,
      requestId: input.requestId,
      comparisonId,
      providerId: routing.recommendedRoute?.provider.id ?? null,
      payload: {
        fingerprint: digest,
        routeCount: routing.routes.length,
        recommendedRouteId: routing.recommendedRoute?.routeId ?? null,
        failedProviderCount: routing.providerFailures.length,
        routingEngineVersion: ROUTING_ENGINE_VERSION,
        rankingEngine: 'MultiRailRouter',
      },
    });

    return {
      comparisonId,
      createdAt: routing.createdAt,
      organizationId: input.organizationId,
      fingerprint: digest,
      dto,
      routing,
      snapshot,
    };
  }

  async replay(
    comparisonId: string,
    context: { readonly actor: string; readonly requestId: string | null },
  ): Promise<ReplayResultDto> {
    const stored = await this.deps.comparisons.findById(comparisonId);
    if (stored === null) {
      throw new NotFoundError('Comparison', comparisonId);
    }

    const replayedAt = this.deps.clock.nowIso();

    if (!isRoutingComparisonSnapshot(stored.snapshot)) {
      await this.deps.auditLogger.record({
        type: 'comparison.replayed',
        actor: context.actor,
        requestId: context.requestId,
        comparisonId,
        providerId: null,
        payload: {
          reproducible: false,
          divergence: 'engine_version_changed',
          originalEngineVersion: stored.engineVersion,
          replayEngineVersion: ROUTING_ENGINE_VERSION,
          rankingEngine: 'MultiRailRouter',
        },
      });
      return {
        comparisonId,
        reproducible: false,
        divergence: 'engine_version_changed',
        originalFingerprint: stored.fingerprint,
        replayedFingerprint: stored.fingerprint,
        originalEngineVersion: stored.engineVersion,
        replayEngineVersion: ROUTING_ENGINE_VERSION,
        replayedAt,
        comparison: stored.result as ComparisonDto,
      };
    }

    const replayedRouting = this.deps.routing.recomputeFromSnapshot(stored.snapshot);
    const replayedFingerprint = fingerprint(stored.snapshot);
    const dto = serializeComparisonFromRouting({
      comparisonId: stored.comparisonId,
      fingerprint: replayedFingerprint,
      rails: stored.snapshot.request.rails,
      routing: replayedRouting,
    });
    const fingerprintMatches = replayedFingerprint === stored.fingerprint;
    const engineMatches = stored.snapshot.engineVersion === ROUTING_ENGINE_VERSION;
    const reproducible = fingerprintMatches && engineMatches;
    const divergence = !fingerprintMatches
      ? 'fingerprint_mismatch'
      : engineMatches
        ? null
        : 'engine_version_changed';

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
        replayedFingerprint,
        originalEngineVersion: stored.snapshot.engineVersion,
        replayEngineVersion: ROUTING_ENGINE_VERSION,
        rankingEngine: 'MultiRailRouter',
      },
    });

    return {
      comparisonId,
      reproducible,
      divergence,
      originalFingerprint: stored.fingerprint,
      replayedFingerprint,
      originalEngineVersion: stored.snapshot.engineVersion,
      replayEngineVersion: ROUTING_ENGINE_VERSION,
      replayedAt,
      comparison: dto,
    };
  }
}

function capabilitiesOf(
  routing: MultiRailRouting,
  registry: FinancialProviderRegistry,
): Readonly<Record<string, ProviderCapabilityProfile>> {
  const capabilities: Record<string, ProviderCapabilityProfile> = {};
  for (const route of routing.routes) {
    const live = registry.get(route.provider.id);
    capabilities[route.provider.id] =
      live?.getCapabilities() ?? {
        category: route.category,
        features: [],
        conversionKinds: [route.conversionKind],
        rails: [route.rail],
      };
  }
  return capabilities;
}

function rehydrateStored(stored: {
  readonly comparisonId: string;
  readonly createdAt: string;
  readonly organizationId?: string | null;
  readonly fingerprint: string;
  readonly result: unknown;
  readonly snapshot: unknown;
}): RoutingBackedComparison {
  if (!isRoutingComparisonSnapshot(stored.snapshot)) {
    throw new NotFoundError('Comparison', stored.comparisonId);
  }
  return {
    comparisonId: stored.comparisonId,
    createdAt: stored.createdAt,
    organizationId: stored.organizationId ?? null,
    fingerprint: stored.fingerprint,
    dto: stored.result as ComparisonDto,
    routing: {
      routingId: stored.snapshot.routingId,
      organizationId: stored.organizationId ?? null,
      createdAt: stored.createdAt,
      mode: stored.snapshot.mode,
      routingEngineVersion: stored.snapshot.engineVersion,
      aiUsed: false,
      request: {
        sourceAsset: stored.snapshot.request.sourceAsset,
        destinationAsset: stored.snapshot.request.destinationAsset,
        amountMinorUnits: stored.snapshot.request.amountMinorUnits,
        requestedAt: stored.snapshot.request.requestedAt,
      },
      scoringWeights: stored.snapshot.weights,
      routes: [],
      recommendedRoute: null,
      routeScore: null,
      estimatedCost: null,
      estimatedReceiveAmount: null,
      estimatedSettlementTime: null,
      routeExplanation: '',
      plannedRoutes: [],
      providerFailures: stored.snapshot.providerFailures,
      pricingRules: stored.snapshot.pricingRules,
    },
    snapshot: stored.snapshot,
  };
}
