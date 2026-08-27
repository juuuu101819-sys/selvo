import { ValidationError } from '../errors/index.js';
import { Dec, formatDecimal, toDecimal, type Decimal } from '../money/index.js';
import { isAssetNode, isVenueNode } from './types.js';
import { graphPathId } from './ids.js';
import { explainGraphPath, explainPathDiscovery } from './explanation.js';
import type { FinancialRouteGraph } from './graph.js';
import {
  DEFAULT_GRAPH_MAX_HOPS,
  GRAPH_ENGINE_VERSION,
  GRAPH_MAX_HOPS_CAP,
  type GraphEdge,
  type GraphNode,
  type GraphPath,
  type GraphRejection,
  type GraphSearchConstraints,
  type PathDiscoveryResult,
} from './types.js';

const MAX_REJECTIONS = 48;

export interface DiscoverPathsInput {
  readonly sourceAsset: string;
  readonly destinationAsset: string;
  readonly constraints?: Partial<{
    readonly maxHops: number;
    readonly maxExpectedCostBps: string | null;
    readonly minLiquidityMinorUnits: string | null;
    readonly liquidityAsset: string | null;
    readonly supportedAssets: readonly string[] | null;
  }>;
}

/**
 * Depth-first discovery of asset→venue→asset walks.
 *
 * Deterministic: outgoing edges are pre-sorted by id, ranking is hops then cost then path id.
 * Cycles are refused by never revisiting an asset on the current walk. Venues may be reused
 * (on-ramp then off-ramp through the same settlement provider is a real route).
 *
 * This does not fetch quotes, submit a swap, or talk to a chain.
 */
export function discoverPaths(
  graph: FinancialRouteGraph,
  input: DiscoverPathsInput,
): PathDiscoveryResult {
  if (input.sourceAsset === input.destinationAsset) {
    throw new ValidationError('sourceAsset and destinationAsset must differ.', {
      sourceAsset: input.sourceAsset,
      destinationAsset: input.destinationAsset,
    });
  }

  const source = graph.assetNode(input.sourceAsset);
  const destination = graph.assetNode(input.destinationAsset);
  if (source === null) {
    throw new ValidationError(`Source asset "${input.sourceAsset}" is not on the route graph.`, {
      sourceAsset: input.sourceAsset,
    });
  }
  if (destination === null) {
    throw new ValidationError(
      `Destination asset "${input.destinationAsset}" is not on the route graph.`,
      { destinationAsset: input.destinationAsset },
    );
  }

  const constraints = resolveConstraints(input);
  if (
    constraints.supportedAssets !== null &&
    (!constraints.supportedAssets.has(input.sourceAsset) ||
      !constraints.supportedAssets.has(input.destinationAsset))
  ) {
    const empty = emptyResult(input, constraints, [], []);
    return empty;
  }

  const paths: GraphPath[] = [];
  const rejections: GraphRejection[] = [];
  const seenRejection = new Set<string>();

  const reject = (reason: GraphRejection['reason'], edge: GraphEdge, detail: string): void => {
    const key = `${reason}:${edge.id}`;
    if (seenRejection.has(key) || rejections.length >= MAX_REJECTIONS) {
      return;
    }
    seenRejection.add(key);
    rejections.push({ reason, edgeId: edge.id, detail });
  };

  const walk = (
    currentAsset: string,
    pathEdges: readonly GraphEdge[],
    visitedAssets: ReadonlySet<string>,
    hops: number,
    cost: Decimal,
  ): void => {
    if (currentAsset === input.destinationAsset && hops >= 1) {
      paths.push(materialisePath(graph, pathEdges, cost));
      return;
    }
    if (hops >= constraints.maxHops) {
      return;
    }

    for (const edge of graph.outgoingFromAsset(currentAsset)) {
      const via = graph.requireNode(edge.viaNodeId);
      if (!isVenueNode(via)) {
        continue;
      }
      const nextNode = graph.requireNode(edge.toNodeId);
      if (!isAssetNode(nextNode)) {
        continue;
      }
      const nextAsset = nextNode.asset;

      if (!via.available) {
        reject('PROVIDER_UNAVAILABLE', edge, `${via.label} is not available.`);
        continue;
      }
      if (!edge.available) {
        reject('UNAVAILABLE_EDGE', edge, `Conversion ${currentAsset} → ${nextAsset} is unavailable.`);
        continue;
      }
      if (!edge.complianceEligible) {
        reject(
          'COMPLIANCE_INELIGIBLE',
          edge,
          `Conversion ${currentAsset} → ${nextAsset} via ${via.label} is not compliance-eligible.`,
        );
        continue;
      }
      if (hops + 1 > constraints.maxHops) {
        reject(
          'MAX_HOPS',
          edge,
          `Taking ${currentAsset} → ${nextAsset} would exceed maxHops ${String(constraints.maxHops)}.`,
        );
        continue;
      }
      if (visitedAssets.has(nextAsset)) {
        reject(
          'CYCLE',
          edge,
          `Conversion ${currentAsset} → ${nextAsset} would revisit ${nextAsset}.`,
        );
        continue;
      }
      if (constraints.supportedAssets !== null && !constraints.supportedAssets.has(nextAsset)) {
        reject(
          'UNSUPPORTED_ASSET',
          edge,
          `${nextAsset} is not in the supported-assets allow-list.`,
        );
        continue;
      }

      const nextCost = cost.add(edge.costBps);
      if (
        constraints.maxExpectedCostBps !== null &&
        nextCost.greaterThan(constraints.maxExpectedCostBps)
      ) {
        reject(
          'HIGH_COST',
          edge,
          `Cumulative cost ${formatDecimal(nextCost)} bps exceeds max ${formatDecimal(constraints.maxExpectedCostBps)} bps.`,
        );
        continue;
      }

      if (
        constraints.minLiquidityMinorUnits !== null &&
        constraints.liquidityAsset !== null &&
        edge.liquidityMinorUnits !== null &&
        edge.liquidityAsset === constraints.liquidityAsset &&
        edge.liquidityMinorUnits < constraints.minLiquidityMinorUnits
      ) {
        reject(
          'INSUFFICIENT_LIQUIDITY',
          edge,
          `Disclosed depth ${edge.liquidityMinorUnits.toString()} ${edge.liquidityAsset} is below the minimum ${constraints.minLiquidityMinorUnits.toString()}.`,
        );
        continue;
      }

      const nextVisited = new Set(visitedAssets);
      nextVisited.add(nextAsset);
      walk(nextAsset, [...pathEdges, edge], nextVisited, hops + 1, nextCost);
    }
  };

  walk(input.sourceAsset, [], new Set([input.sourceAsset]), 0, new Dec(0));

  paths.sort(comparePaths);
  return emptyResult(input, constraints, paths, rejections);
}

function resolveConstraints(input: DiscoverPathsInput): GraphSearchConstraints {
  const raw = input.constraints ?? {};
  const maxHops = raw.maxHops ?? DEFAULT_GRAPH_MAX_HOPS;
  if (!Number.isInteger(maxHops) || maxHops < 1 || maxHops > GRAPH_MAX_HOPS_CAP) {
    throw new ValidationError(
      `maxHops must be an integer between 1 and ${String(GRAPH_MAX_HOPS_CAP)}.`,
      { maxHops },
    );
  }

  let maxExpectedCostBps: Decimal | null = null;
  if (raw.maxExpectedCostBps !== undefined && raw.maxExpectedCostBps !== null) {
    maxExpectedCostBps = toDecimal(raw.maxExpectedCostBps);
    if (maxExpectedCostBps.isNegative()) {
      throw new ValidationError('maxExpectedCostBps cannot be negative.', {
        maxExpectedCostBps: raw.maxExpectedCostBps,
      });
    }
  }

  let minLiquidityMinorUnits: bigint | null = null;
  if (raw.minLiquidityMinorUnits !== undefined && raw.minLiquidityMinorUnits !== null) {
    if (!/^\d+$/.test(raw.minLiquidityMinorUnits)) {
      throw new ValidationError('minLiquidityMinorUnits must be a non-negative integer string.', {
        minLiquidityMinorUnits: raw.minLiquidityMinorUnits,
      });
    }
    minLiquidityMinorUnits = BigInt(raw.minLiquidityMinorUnits);
  }

  const supportedAssets =
    raw.supportedAssets === undefined || raw.supportedAssets === null
      ? null
      : new Set(raw.supportedAssets);

  return {
    maxHops,
    maxExpectedCostBps,
    minLiquidityMinorUnits,
    liquidityAsset: raw.liquidityAsset ?? (minLiquidityMinorUnits === null ? null : input.sourceAsset),
    supportedAssets,
  };
}

function materialisePath(
  graph: FinancialRouteGraph,
  edges: readonly GraphEdge[],
  totalCostBps: Decimal,
): GraphPath {
  const first = edges[0];
  if (first === undefined) {
    throw new ValidationError('A discovered path must contain at least one conversion edge.', {});
  }
  const nodes: GraphNode[] = [graph.requireNode(first.fromNodeId)];
  for (const edge of edges) {
    nodes.push(graph.requireNode(edge.viaNodeId));
    nodes.push(graph.requireNode(edge.toNodeId));
  }

  const assets = nodes.filter(isAssetNode).map((node) => node.asset);
  const providers = edges.map((edge) => edge.providerId);

  let minLiquidityMinorUnits: bigint | null = null;
  let minLiquidityAsset: string | null = null;
  for (const edge of edges) {
    if (edge.liquidityMinorUnits === null || edge.liquidityAsset === null) {
      continue;
    }
    if (minLiquidityMinorUnits === null || edge.liquidityMinorUnits < minLiquidityMinorUnits) {
      minLiquidityMinorUnits = edge.liquidityMinorUnits;
      minLiquidityAsset = edge.liquidityAsset;
    }
  }

  const path: GraphPath = {
    pathId: graphPathId(edges.map((edge) => edge.id)),
    hops: edges.length,
    nodes,
    edges,
    assets,
    providers,
    totalCostBps,
    minLiquidityMinorUnits,
    minLiquidityAsset,
    explanation: '',
    executable: false,
  };
  return { ...path, explanation: explainGraphPath(path) };
}

function comparePaths(left: GraphPath, right: GraphPath): number {
  if (left.hops !== right.hops) {
    return left.hops - right.hops;
  }
  const cost = left.totalCostBps.comparedTo(right.totalCostBps);
  if (cost !== 0) {
    return cost;
  }
  return left.pathId.localeCompare(right.pathId, 'en');
}

function emptyResult(
  input: DiscoverPathsInput,
  constraints: GraphSearchConstraints,
  paths: readonly GraphPath[],
  rejections: readonly GraphRejection[],
): PathDiscoveryResult {
  const recommended = paths[0] ?? null;
  return {
    graphEngineVersion: GRAPH_ENGINE_VERSION,
    sourceAsset: input.sourceAsset,
    destinationAsset: input.destinationAsset,
    constraints: {
      maxHops: constraints.maxHops,
      maxExpectedCostBps:
        constraints.maxExpectedCostBps === null
          ? null
          : formatDecimal(constraints.maxExpectedCostBps),
      minLiquidityMinorUnits:
        constraints.minLiquidityMinorUnits === null
          ? null
          : constraints.minLiquidityMinorUnits.toString(),
      liquidityAsset: constraints.liquidityAsset,
      supportedAssets:
        constraints.supportedAssets === null ? null : [...constraints.supportedAssets].sort(),
    },
    paths,
    recommendedPath: recommended,
    rejections,
    explanation: explainPathDiscovery(input.sourceAsset, input.destinationAsset, paths, rejections),
    aiUsed: false,
    executable: false,
  };
}
