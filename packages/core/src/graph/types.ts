import type { ConversionKind } from '../domain/conversion.js';
import type { Decimal } from '../money/index.js';

/**
 * Version of the financial route *graph* and its path-discovery semantics.
 *
 * Independent of {@link ENGINE_VERSION} (fiat comparison, 2.0.0) and
 * {@link ROUTING_ENGINE_VERSION} (multi-rail quoting, 1.0.0). Bump this when a change would alter
 * which paths are discovered for an unchanged graph and constraint set. Do not bump either quote
 * engine from here — this layer does not price a route.
 */
export const GRAPH_ENGINE_VERSION = '1.0.0';

/**
 * Closed set of graph node kinds. Assets (what moves) and venues (who converts or transfers) share
 * one enum so a walk can be serialised without a second discriminator.
 */
export const GRAPH_NODE_KINDS = [
  'FIAT',
  'STABLECOIN',
  'CRYPTO_ASSET',
  'BANK',
  'FX_PROVIDER',
  'PAYMENT_PROVIDER',
  'DEX',
  'AMM',
  'LIQUIDITY_POOL',
  'SETTLEMENT_PROVIDER',
] as const;

export type GraphNodeKind = (typeof GRAPH_NODE_KINDS)[number];

export const ASSET_NODE_KINDS = ['FIAT', 'STABLECOIN', 'CRYPTO_ASSET'] as const;
export type AssetNodeKind = (typeof ASSET_NODE_KINDS)[number];

export const VENUE_NODE_KINDS = [
  'BANK',
  'FX_PROVIDER',
  'PAYMENT_PROVIDER',
  'DEX',
  'AMM',
  'LIQUIDITY_POOL',
  'SETTLEMENT_PROVIDER',
] as const;
export type VenueNodeKind = (typeof VENUE_NODE_KINDS)[number];

export function isGraphNodeKind(value: unknown): value is GraphNodeKind {
  return typeof value === 'string' && (GRAPH_NODE_KINDS as readonly string[]).includes(value);
}

export function isAssetNodeKind(value: unknown): value is AssetNodeKind {
  return typeof value === 'string' && (ASSET_NODE_KINDS as readonly string[]).includes(value);
}

export function isVenueNodeKind(value: unknown): value is VenueNodeKind {
  return typeof value === 'string' && (VENUE_NODE_KINDS as readonly string[]).includes(value);
}

export interface GraphAssetNode {
  readonly id: string;
  readonly kind: AssetNodeKind;
  readonly label: string;
  readonly asset: string;
}

export interface GraphVenueNode {
  readonly id: string;
  readonly kind: VenueNodeKind;
  readonly label: string;
  readonly providerId: string;
  /** When false, every edge through this venue is treated as unavailable. */
  readonly available: boolean;
}

export type GraphNode = GraphAssetNode | GraphVenueNode;

export function isAssetNode(node: GraphNode): node is GraphAssetNode {
  return isAssetNodeKind(node.kind);
}

export function isVenueNode(node: GraphNode): node is GraphVenueNode {
  return isVenueNodeKind(node.kind);
}

/**
 * A directed conversion or transfer: source asset → destination asset, via a venue.
 *
 * The walk a caller sees interpolates the venue: `USD → FX Provider → KRW` is one hop (one edge).
 * Cost and liquidity here are indicative graph metadata used to prune search. They are not a live
 * quote and they are never executable.
 */
export interface GraphEdge {
  readonly id: string;
  readonly fromNodeId: string;
  readonly toNodeId: string;
  readonly viaNodeId: string;
  readonly providerId: string;
  readonly conversionKind: ConversionKind;
  readonly available: boolean;
  readonly costBps: Decimal;
  /**
   * Disclosed depth in minor units of {@link liquidityAsset}, or `null` when the venue publishes
   * none. `null` does not fail a minimum-liquidity constraint.
   */
  readonly liquidityMinorUnits: bigint | null;
  readonly liquidityAsset: string | null;
  readonly complianceEligible: boolean;
  readonly executable: false;
}

export const GRAPH_REJECTION_REASONS = [
  'UNAVAILABLE_EDGE',
  'PROVIDER_UNAVAILABLE',
  'COMPLIANCE_INELIGIBLE',
  'HIGH_COST',
  'INSUFFICIENT_LIQUIDITY',
  'UNSUPPORTED_ASSET',
  'CYCLE',
  'MAX_HOPS',
] as const;

export type GraphRejectionReason = (typeof GRAPH_REJECTION_REASONS)[number];

export interface GraphRejection {
  readonly reason: GraphRejectionReason;
  readonly edgeId: string;
  readonly detail: string;
}

export interface GraphSearchConstraints {
  /** Maximum conversion hops. A hop is one asset→venue→asset conversion. */
  readonly maxHops: number;
  /** Cumulative indicative cost ceiling in basis points, or `null` for unbounded. */
  readonly maxExpectedCostBps: Decimal | null;
  /**
   * Minimum disclosed depth, in minor units of {@link liquidityAsset}. Applied only to edges whose
   * `liquidityAsset` matches. `null` disables the check.
   */
  readonly minLiquidityMinorUnits: bigint | null;
  readonly liquidityAsset: string | null;
  /**
   * Allow-list of asset codes that may appear on a path (source, destination and every
   * intermediate). `null` means every registered asset is allowed.
   */
  readonly supportedAssets: ReadonlySet<string> | null;
}

export const DEFAULT_GRAPH_MAX_HOPS = 4;
export const GRAPH_MAX_HOPS_CAP = 8;

export interface GraphPath {
  readonly pathId: string;
  readonly hops: number;
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  readonly assets: readonly string[];
  readonly providers: readonly string[];
  readonly totalCostBps: Decimal;
  readonly minLiquidityMinorUnits: bigint | null;
  readonly minLiquidityAsset: string | null;
  readonly explanation: string;
  readonly executable: false;
}

export interface PathDiscoveryResult {
  readonly graphEngineVersion: typeof GRAPH_ENGINE_VERSION;
  readonly sourceAsset: string;
  readonly destinationAsset: string;
  readonly constraints: {
    readonly maxHops: number;
    readonly maxExpectedCostBps: string | null;
    readonly minLiquidityMinorUnits: string | null;
    readonly liquidityAsset: string | null;
    readonly supportedAssets: readonly string[] | null;
  };
  readonly paths: readonly GraphPath[];
  readonly recommendedPath: GraphPath | null;
  readonly rejections: readonly GraphRejection[];
  readonly explanation: string;
  readonly aiUsed: false;
  readonly executable: false;
}
