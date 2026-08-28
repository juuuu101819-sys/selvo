import { assetKind } from '../domain/asset.js';
import { conversionKindOf } from '../domain/conversion.js';
import { buildDemoFinancialGraph } from './demo-graph.js';
import {
  FinancialRouteGraph,
  buildAssetNode,
  buildConversionEdge,
  buildVenueNode,
} from './graph.js';
import type { AssetNodeKind, GraphAssetNode, GraphEdge, GraphVenueNode, VenueNodeKind } from './types.js';

/**
 * Indicative conversion advertised by a licensed venue.
 *
 * Cost and liquidity here are topology metadata for path discovery. They are not a live quote and
 * they are never executable. Tests inject these objects; production does not fabricate them.
 */
export interface LicensedVenueEdgeMetadata {
  readonly fromAsset: string;
  readonly toAsset: string;
  readonly costBps: string;
  readonly liquidityMinorUnits?: string | null | undefined;
  readonly available?: boolean | undefined;
}

/**
 * Configured venue metadata used when demo adapters are disabled.
 *
 * This is not a licensed adapter and does not execute. An empty list must produce an empty graph.
 */
export interface LicensedVenueMetadata {
  readonly providerId: string;
  readonly label: string;
  readonly kind: VenueNodeKind;
  readonly available?: boolean | undefined;
  readonly edges: readonly LicensedVenueEdgeMetadata[];
}

export interface BuildFinancialRouteGraphOptions {
  /**
   * When true, the sandbox demo topology is used (including graph-only demo venues).
   * When false, the graph is built only from {@link licensedVenueMetadata}.
   */
  readonly includeDemoAdapters: boolean;
  readonly licensedVenueMetadata?: readonly LicensedVenueMetadata[] | undefined;
}

const ASSET_KIND_TO_NODE: Readonly<Record<ReturnType<typeof assetKind>, AssetNodeKind>> = {
  fiat: 'FIAT',
  stablecoin: 'STABLECOIN',
  crypto: 'CRYPTO_ASSET',
};

/**
 * Builds the financial route graph for the running environment.
 *
 * Fail-closed: demo adapters off and no licensed venue metadata → empty graph, never a silent
 * demo fallback. Licensed metadata is never invented here.
 */
export function buildFinancialRouteGraph(
  options: BuildFinancialRouteGraphOptions,
): FinancialRouteGraph {
  if (options.includeDemoAdapters) {
    return buildDemoFinancialGraph();
  }
  const licensed = options.licensedVenueMetadata ?? [];
  if (licensed.length === 0) {
    return FinancialRouteGraph.create([], []);
  }
  return graphFromLicensedVenues(licensed);
}

export function graphFromLicensedVenues(
  venues: readonly LicensedVenueMetadata[],
): FinancialRouteGraph {
  const assets = new Map<string, GraphAssetNode>();
  const venueNodes: GraphVenueNode[] = [];
  const edges: GraphEdge[] = [];

  for (const venue of venues) {
    const node = buildVenueNode({
      providerId: venue.providerId,
      kind: venue.kind,
      label: venue.label,
      ...(venue.available === undefined ? {} : { available: venue.available }),
    });
    venueNodes.push(node);

    for (const edge of venue.edges) {
      rememberAsset(assets, edge.fromAsset);
      rememberAsset(assets, edge.toAsset);
      const liquidityRaw = edge.liquidityMinorUnits;
      edges.push(
        buildConversionEdge({
          fromAsset: edge.fromAsset,
          toAsset: edge.toAsset,
          via: node,
          conversionKind: conversionKindOf(edge.fromAsset, edge.toAsset),
          costBps: edge.costBps,
          ...(edge.available === undefined ? {} : { available: edge.available }),
          ...(liquidityRaw === undefined || liquidityRaw === null
            ? {}
            : { liquidityMinorUnits: BigInt(liquidityRaw), liquidityAsset: edge.fromAsset }),
        }),
      );
    }
  }

  return FinancialRouteGraph.create([...assets.values(), ...venueNodes], edges);
}

function rememberAsset(assets: Map<string, GraphAssetNode>, code: string): void {
  if (assets.has(code)) {
    return;
  }
  const kind = ASSET_KIND_TO_NODE[assetKind(code)];
  assets.set(code, buildAssetNode(code, kind));
}
