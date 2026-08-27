import type { JsonObject } from '../domain/json.js';
import type { PlatformMode } from '../domain/provider.js';
import { ValidationError } from '../errors/index.js';
import type { AuditLogger, Clock, IdGenerator, Logger } from '../ports/index.js';
import { assertAssetCode } from '../domain/asset.js';
import { discoverPaths } from './path-finder.js';
import type { FinancialRouteGraph } from './graph.js';
import { GRAPH_ENGINE_VERSION, type PathDiscoveryResult } from './types.js';

export interface RouteGraphServiceDependencies {
  readonly mode: PlatformMode;
  readonly graph: FinancialRouteGraph;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly auditLogger: AuditLogger;
  readonly logger: Logger;
}

export interface GraphSearchInput {
  readonly organizationId: string | null;
  readonly sourceAsset: string;
  readonly destinationAsset: string;
  readonly amountMinorUnits: string | null;
  readonly maxHops?: number;
  readonly maxExpectedCostBps?: string | null;
  readonly minLiquidityMinorUnits?: string | null;
  readonly supportedAssets?: readonly string[] | null;
  readonly actor: string;
  readonly requestId: string | null;
}

export interface GraphSearch {
  readonly searchId: string;
  readonly organizationId: string | null;
  readonly createdAt: string;
  readonly mode: PlatformMode;
  readonly discovery: PathDiscoveryResult;
}

/**
 * Graph facade: returns the topology and runs constrained path discovery.
 *
 * Distinct from {@link MultiRailRouter}: this engine walks edges, it does not score live quotes.
 * `aiUsed` is always false. Paths are never executable.
 */
export class RouteGraphService {
  constructor(private readonly deps: RouteGraphServiceDependencies) {}

  getGraph(): FinancialRouteGraph {
    return this.deps.graph;
  }

  async discover(input: GraphSearchInput): Promise<GraphSearch> {
    const sourceAsset = assertAssetCode(input.sourceAsset);
    const destinationAsset = assertAssetCode(input.destinationAsset);
    if (sourceAsset === destinationAsset) {
      throw new ValidationError('sourceAsset and destinationAsset must differ.', {
        sourceAsset,
        destinationAsset,
      });
    }
    const supportedAssets =
      input.supportedAssets === undefined || input.supportedAssets === null
        ? null
        : input.supportedAssets.map((asset) => assertAssetCode(asset));

    const searchId = this.deps.ids.generate('gph');
    const createdAt = this.deps.clock.nowIso();

    await this.deps.auditLogger.record({
      type: 'routing.graph.requested',
      actor: input.actor,
      requestId: input.requestId,
      comparisonId: null,
      providerId: null,
      payload: {
        searchId,
        sourceAsset,
        destinationAsset,
        amountMinorUnits: input.amountMinorUnits,
        organizationId: input.organizationId,
        maxHops: input.maxHops ?? null,
        maxExpectedCostBps: input.maxExpectedCostBps ?? null,
        minLiquidityMinorUnits: input.minLiquidityMinorUnits ?? null,
        supportedAssets,
        aiUsed: false,
      } satisfies JsonObject,
    });

    try {
      const discovery = discoverPaths(this.deps.graph, {
        sourceAsset,
        destinationAsset,
        constraints: {
          ...(typeof input.maxHops === 'number' ? { maxHops: input.maxHops } : {}),
          maxExpectedCostBps: input.maxExpectedCostBps ?? null,
          minLiquidityMinorUnits: input.minLiquidityMinorUnits ?? null,
          liquidityAsset: sourceAsset,
          supportedAssets,
        },
      });

      await this.deps.auditLogger.record({
        type: 'routing.graph.completed',
        actor: input.actor,
        requestId: input.requestId,
        comparisonId: null,
        providerId: discovery.recommendedPath?.providers[0] ?? null,
        payload: {
          searchId,
          pathCount: discovery.paths.length,
          hopCounts: discovery.paths.map((path) => path.hops),
          recommendedPathId: discovery.recommendedPath?.pathId ?? null,
          rejectionCount: discovery.rejections.length,
          graphEngineVersion: GRAPH_ENGINE_VERSION,
          aiUsed: false,
          executable: false,
        } satisfies JsonObject,
      });

      this.deps.logger.info('Route graph search completed', {
        searchId,
        sourceAsset,
        destinationAsset,
        pathCount: discovery.paths.length,
      });

      return {
        searchId,
        organizationId: input.organizationId,
        createdAt,
        mode: this.deps.mode,
        discovery,
      };
    } catch (error) {
      await this.deps.auditLogger.record({
        type: 'routing.graph.failed',
        actor: input.actor,
        requestId: input.requestId,
        comparisonId: null,
        providerId: null,
        payload: {
          searchId,
          reason: error instanceof Error ? error.message : String(error),
        } satisfies JsonObject,
      });
      throw error;
    }
  }
}
