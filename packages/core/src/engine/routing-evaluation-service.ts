import { NotFoundError } from '../errors/index.js';
import { fingerprint } from '../reproducibility/index.js';
import type { AuditLogger, Clock } from '../ports/index.js';
import type {
  RoutingEvaluationRepository,
  RoutingEvaluationSurface,
  StoredRoutingEvaluation,
} from '../ports/routing-evaluation.js';
import type { FinancialQuoteDto, MultiRailRoutingDto } from '../serialization/dto.js';
import { serializeFinancialQuote, serializeMultiRailRouting } from '../serialization/serialize.js';
import { ROUTING_ENGINE_VERSION } from './routing-config.js';
import type { MultiRailRouter } from './routing-engine.js';
import { captureRoutingFingerprint } from './routing-fingerprint.js';
import type { FinancialProviderRegistry } from './financial-registry.js';
import type { MultiRailRouting } from './routing-types.js';
import type { RailType } from '../domain/rail.js';
import { fingerprintableRoutingSnapshot } from './routing-snapshot.js';

export interface RoutingReplayResult {
  readonly routingId: string;
  readonly surface: RoutingEvaluationSurface;
  readonly reproducible: boolean;
  readonly divergence: 'fingerprint_mismatch' | 'engine_version_changed' | null;
  readonly originalFingerprint: string;
  readonly replayedFingerprint: string;
  readonly originalEngineVersion: string;
  readonly replayEngineVersion: string;
  readonly replayedAt: string;
  readonly rankedRouteIds: readonly string[];
  readonly routing: MultiRailRoutingDto | null;
  readonly quote: FinancialQuoteDto | null;
}

export interface RoutingEvaluationServiceDependencies {
  readonly routing: MultiRailRouter;
  readonly registry: FinancialProviderRegistry;
  readonly evaluations: RoutingEvaluationRepository;
  readonly auditLogger: AuditLogger;
  readonly clock: Clock;
}

export class RoutingEvaluationService {
  constructor(private readonly deps: RoutingEvaluationServiceDependencies) {}

  async persist(
    routing: MultiRailRouting,
    rails: readonly RailType[] | null,
    surface: RoutingEvaluationSurface,
  ): Promise<{ readonly fingerprint: string; readonly rankedRouteIds: readonly string[] }> {
    const captured = captureRoutingFingerprint(routing, rails, this.deps.registry);
    await this.deps.evaluations.save({
      routingId: routing.routingId,
      fingerprint: captured.fingerprint,
      engineVersion: ROUTING_ENGINE_VERSION,
      surface,
      organizationId: routing.organizationId,
      createdAt: routing.createdAt,
      rankedRouteIds: captured.rankedRouteIds,
      snapshot: captured.snapshot,
    });
    return { fingerprint: captured.fingerprint, rankedRouteIds: captured.rankedRouteIds };
  }

  async replay(
    routingId: string,
    surface: RoutingEvaluationSurface,
    context: { readonly actor: string; readonly requestId: string | null },
    access: { readonly organizationId: string | null; readonly allowPublic: boolean },
  ): Promise<RoutingReplayResult> {
    const stored = await this.requireStored(routingId, surface, access);

    const replayedAt = this.deps.clock.nowIso();
    const replayedRouting = this.deps.routing.recomputeFromSnapshot(stored.snapshot);
    const replayedFingerprint = fingerprint(fingerprintableRoutingSnapshot(stored.snapshot));
    const fingerprintMatches = replayedFingerprint === stored.fingerprint;
    const engineMatches = stored.snapshot.engineVersion === ROUTING_ENGINE_VERSION;
    const rankedMatches =
      replayedRouting.routes.map((route) => route.routeId).join('\0') ===
      stored.rankedRouteIds.join('\0');
    const reproducible = fingerprintMatches && engineMatches && rankedMatches;
    const divergence = !fingerprintMatches
      ? 'fingerprint_mismatch'
      : engineMatches
        ? null
        : 'engine_version_changed';

    await this.deps.auditLogger.record({
      type: 'routing.replayed',
      actor: context.actor,
      requestId: context.requestId,
      comparisonId: null,
      providerId: replayedRouting.recommendedRoute?.provider.id ?? null,
      payload: {
        routingId,
        surface,
        reproducible,
        divergence,
        originalFingerprint: stored.fingerprint,
        replayedFingerprint,
        originalEngineVersion: stored.engineVersion,
        replayEngineVersion: ROUTING_ENGINE_VERSION,
      },
    });

    return {
      routingId,
      surface,
      reproducible,
      divergence,
      originalFingerprint: stored.fingerprint,
      replayedFingerprint,
      originalEngineVersion: stored.engineVersion,
      replayEngineVersion: ROUTING_ENGINE_VERSION,
      replayedAt,
      rankedRouteIds: replayedRouting.routes.map((route) => route.routeId),
      routing:
        surface === 'routes'
          ? serializeMultiRailRouting(replayedRouting, { fingerprint: replayedFingerprint })
          : null,
      quote:
        surface === 'quote'
          ? serializeFinancialQuote(replayedRouting, context.requestId ?? routingId, {
              fingerprint: replayedFingerprint,
            })
          : null,
    };
  }

  async load(
    routingId: string,
    surface: RoutingEvaluationSurface,
    access: { readonly organizationId: string | null; readonly allowPublic: boolean },
  ): Promise<MultiRailRouting> {
    const stored = await this.requireStored(routingId, surface, access);
    return this.deps.routing.recomputeFromSnapshot(stored.snapshot);
  }

  private async requireStored(
    routingId: string,
    surface: RoutingEvaluationSurface,
    access: { readonly organizationId: string | null; readonly allowPublic: boolean },
  ): Promise<StoredRoutingEvaluation> {
    const stored = await this.deps.evaluations.findById(routingId);
    if (stored === null || stored.surface !== surface) {
      throw new NotFoundError('RoutingEvaluation', routingId);
    }
    if (!canAccessEvaluation(access, stored.organizationId)) {
      throw new NotFoundError('RoutingEvaluation', routingId);
    }
    return stored;
  }
}

export function canAccessEvaluation(
  access: { readonly organizationId: string | null; readonly allowPublic: boolean },
  organizationId: string | null,
): boolean {
  if (organizationId === null) {
    return access.allowPublic;
  }
  return access.organizationId === organizationId;
}
