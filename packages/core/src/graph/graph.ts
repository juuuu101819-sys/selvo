import { ValidationError } from '../errors/index.js';
import { toDecimal } from '../money/index.js';
import { assetNodeId, conversionEdgeId, venueNodeId } from './ids.js';
import {
  isAssetNode,
  isVenueNode,
  type GraphAssetNode,
  type GraphEdge,
  type GraphNode,
  type GraphVenueNode,
} from './types.js';

export interface GraphEdgeInput {
  readonly fromAsset: string;
  readonly toAsset: string;
  readonly via: GraphVenueNode;
  readonly conversionKind: GraphEdge['conversionKind'];
  readonly available?: boolean;
  readonly costBps: string;
  readonly liquidityMinorUnits?: bigint | null;
  readonly liquidityAsset?: string | null;
  readonly complianceEligible?: boolean;
}

/**
 * Directed financial-route graph: asset and venue nodes, conversion edges between assets.
 *
 * Immutable after construction. Search is a pure walk; nothing here talks to a chain, a bank or a
 * quote API.
 */
export class FinancialRouteGraph {
  private readonly nodesById: ReadonlyMap<string, GraphNode>;
  private readonly outgoingByFrom: ReadonlyMap<string, readonly GraphEdge[]>;

  private constructor(
    readonly nodes: readonly GraphNode[],
    readonly edges: readonly GraphEdge[],
  ) {
    this.nodesById = new Map(nodes.map((node) => [node.id, node]));

    const grouped = new Map<string, GraphEdge[]>();
    for (const edge of edges) {
      const list = grouped.get(edge.fromNodeId) ?? [];
      list.push(edge);
      grouped.set(edge.fromNodeId, list);
    }
    for (const [from, list] of grouped) {
      list.sort((left, right) => left.id.localeCompare(right.id, 'en'));
      grouped.set(from, list);
    }
    this.outgoingByFrom = grouped;
  }

  static create(nodes: readonly GraphNode[], edges: readonly GraphEdge[]): FinancialRouteGraph {
    const seenNodes = new Set<string>();
    for (const node of nodes) {
      if (seenNodes.has(node.id)) {
        throw new ValidationError(`Duplicate graph node "${node.id}".`, { nodeId: node.id });
      }
      seenNodes.add(node.id);
    }

    const seenEdges = new Set<string>();
    for (const edge of edges) {
      if (seenEdges.has(edge.id)) {
        throw new ValidationError(`Duplicate graph edge "${edge.id}".`, { edgeId: edge.id });
      }
      seenEdges.add(edge.id);
      assertEdgeEndpoints(edge, nodes);
    }

    const sortedNodes = [...nodes].sort((left, right) => left.id.localeCompare(right.id, 'en'));
    const sortedEdges = [...edges].sort((left, right) => left.id.localeCompare(right.id, 'en'));
    return new FinancialRouteGraph(sortedNodes, sortedEdges);
  }

  node(id: string): GraphNode | null {
    return this.nodesById.get(id) ?? null;
  }

  requireNode(id: string): GraphNode {
    const node = this.node(id);
    if (node === null) {
      throw new ValidationError(`Unknown graph node "${id}".`, { nodeId: id });
    }
    return node;
  }

  assetNode(asset: string): GraphAssetNode | null {
    const node = this.node(assetNodeId(asset));
    if (node === null || !isAssetNode(node)) {
      return null;
    }
    return node;
  }

  venueNode(providerId: string): GraphVenueNode | null {
    const node = this.node(venueNodeId(providerId));
    if (node === null || !isVenueNode(node)) {
      return null;
    }
    return node;
  }

  outgoingFromAsset(asset: string): readonly GraphEdge[] {
    return this.outgoingByFrom.get(assetNodeId(asset)) ?? [];
  }

  get size(): { readonly nodes: number; readonly edges: number } {
    return { nodes: this.nodes.length, edges: this.edges.length };
  }
}

export function buildAssetNode(
  asset: string,
  kind: GraphAssetNode['kind'],
  label: string = asset,
): GraphAssetNode {
  return { id: assetNodeId(asset), kind, label, asset };
}

export function buildVenueNode(input: {
  readonly providerId: string;
  readonly kind: GraphVenueNode['kind'];
  readonly label: string;
  readonly available?: boolean;
}): GraphVenueNode {
  return {
    id: venueNodeId(input.providerId),
    kind: input.kind,
    label: input.label,
    providerId: input.providerId,
    available: input.available ?? true,
  };
}

export function buildConversionEdge(input: GraphEdgeInput): GraphEdge {
  if (input.fromAsset === input.toAsset) {
    throw new ValidationError('A conversion edge cannot start and end on the same asset.', {
      asset: input.fromAsset,
    });
  }
  const costBps = toDecimal(input.costBps);
  if (costBps.isNegative()) {
    throw new ValidationError('Edge costBps cannot be negative.', {
      fromAsset: input.fromAsset,
      toAsset: input.toAsset,
      costBps: input.costBps,
    });
  }
  const liquidity = input.liquidityMinorUnits ?? null;
  if (liquidity !== null && liquidity < 0n) {
    throw new ValidationError('Edge liquidity cannot be negative.', {
      fromAsset: input.fromAsset,
      toAsset: input.toAsset,
    });
  }
  return {
    id: conversionEdgeId(input.fromAsset, input.via.providerId, input.toAsset),
    fromNodeId: assetNodeId(input.fromAsset),
    toNodeId: assetNodeId(input.toAsset),
    viaNodeId: input.via.id,
    providerId: input.via.providerId,
    conversionKind: input.conversionKind,
    available: input.available ?? true,
    costBps,
    liquidityMinorUnits: liquidity,
    liquidityAsset: liquidity === null ? null : (input.liquidityAsset ?? input.fromAsset),
    complianceEligible: input.complianceEligible ?? true,
    executable: false,
  };
}

function assertEdgeEndpoints(edge: GraphEdge, nodes: readonly GraphNode[]): void {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const from = byId.get(edge.fromNodeId);
  const to = byId.get(edge.toNodeId);
  const via = byId.get(edge.viaNodeId);
  if (from === undefined || !isAssetNode(from)) {
    throw new ValidationError(`Edge "${edge.id}" from-node must be an asset.`, { edgeId: edge.id });
  }
  if (to === undefined || !isAssetNode(to)) {
    throw new ValidationError(`Edge "${edge.id}" to-node must be an asset.`, { edgeId: edge.id });
  }
  if (via === undefined || !isVenueNode(via)) {
    throw new ValidationError(`Edge "${edge.id}" via-node must be a venue.`, { edgeId: edge.id });
  }
  if (via.providerId !== edge.providerId) {
    throw new ValidationError(`Edge "${edge.id}" providerId does not match its venue.`, {
      edgeId: edge.id,
    });
  }
}
