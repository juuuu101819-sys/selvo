import { ASSET_REGISTRY, type AssetDefinition } from './asset.js';
import {
  CHAIN_REGISTRY,
  DEMO_SETTLEMENT_CHAIN_ID,
  type ChainId,
  type ChainMetadata,
} from './chain.js';

/**
 * Venue kinds the DeFi liquidity layer knows how to name.
 *
 * Routing does not switch on these. A DEX, AMM or aggregator is a registry row plus an adapter
 * that implements {@link DeFiLiquiditySource}. Adding a venue is data, not an engine change.
 */
export const DEFI_VENUE_KINDS = ['dex', 'amm', 'aggregator'] as const;
export type DeFiVenueKind = (typeof DEFI_VENUE_KINDS)[number];

export function isDeFiVenueKind(value: unknown): value is DeFiVenueKind {
  return typeof value === 'string' && (DEFI_VENUE_KINDS as readonly string[]).includes(value);
}

/**
 * How a priced route was sourced when the DeFi layer compares across families.
 *
 * `dex` / `amm` / `aggregator` are on-chain venues. `stablecoin` and `traditional` appear when a
 * ramp or FX desk can price the same pair — the engine ranks them together and never assumes one
 * family is cheaper.
 */
export const DEFI_ROUTE_KINDS = [...DEFI_VENUE_KINDS, 'stablecoin', 'traditional'] as const;
export type DeFiRouteKind = (typeof DEFI_ROUTE_KINDS)[number];

export interface DefiPoolDefinition {
  readonly id: string;
  readonly baseAsset: string;
  readonly quoteAsset: string;
  readonly defaultChainId: ChainId;
  readonly status: 'available' | 'planned';
  /** Always false. Meridian never holds pool inventory. */
  readonly custodiedByPlatform: false;
}

/**
 * Demo liquidity pools. Bidirectional quoting is an adapter concern; the registry names the pair.
 *
 * Adding a pool is a row here plus rates on each venue adapter. The router asks
 * `supportsNormalized`, not "is this USDC/USDT".
 */
export const DEFI_POOL_REGISTRY: readonly DefiPoolDefinition[] = [
  {
    id: 'USDC/USDT',
    baseAsset: 'USDC',
    quoteAsset: 'USDT',
    defaultChainId: DEMO_SETTLEMENT_CHAIN_ID,
    status: 'available',
    custodiedByPlatform: false,
  },
  {
    id: 'ETH/USDC',
    baseAsset: 'ETH',
    quoteAsset: 'USDC',
    defaultChainId: DEMO_SETTLEMENT_CHAIN_ID,
    status: 'available',
    custodiedByPlatform: false,
  },
  {
    id: 'ETH/USDT',
    baseAsset: 'ETH',
    quoteAsset: 'USDT',
    defaultChainId: DEMO_SETTLEMENT_CHAIN_ID,
    status: 'available',
    custodiedByPlatform: false,
  },
];

export const DEFI_POOL_ASSETS: readonly string[] = ['ETH', 'USDC', 'USDT'];

export function poolOf(baseAsset: string, quoteAsset: string): DefiPoolDefinition | null {
  return (
    DEFI_POOL_REGISTRY.find(
      (pool) =>
        (pool.baseAsset === baseAsset && pool.quoteAsset === quoteAsset) ||
        (pool.baseAsset === quoteAsset && pool.quoteAsset === baseAsset),
    ) ?? null
  );
}

export function tokensOfPool(pool: DefiPoolDefinition): readonly AssetDefinition[] {
  return [ASSET_REGISTRY[pool.baseAsset], ASSET_REGISTRY[pool.quoteAsset]].filter(
    (asset): asset is AssetDefinition => asset !== undefined,
  );
}

/**
 * Chains a DeFi venue may later quote. Ethereum is available for demo quotes; Base, Arbitrum and
 * Solana are reserved. None are connected.
 */
export function chainsForDeFiVenue(): readonly ChainMetadata[] {
  return Object.values(CHAIN_REGISTRY);
}
