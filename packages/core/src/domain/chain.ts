/**
 * Chain metadata.
 *
 * CAIP-2 identifiers only. This process never opens an RPC, never holds a key, and never
 * submits a transaction. `connected` is therefore always false, including for Ethereum mainnet
 * which is listed so quotes can name a settlement rail without implying a node connection.
 *
 * Adding a chain later is a registry row, not a change to routing logic. Ethereum, Base,
 * Arbitrum and Solana are listed so a future adapter can attach without touching the engine.
 */
export const CHAIN_NAMESPACES = ['eip155', 'solana'] as const;
export type ChainNamespace = (typeof CHAIN_NAMESPACES)[number];

export const CHAIN_IDS = [
  'eip155:1',
  'eip155:8453',
  'eip155:42161',
  'eip155:11155111',
  'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
] as const;
export type ChainId = (typeof CHAIN_IDS)[number];

export interface ChainMetadata {
  readonly id: ChainId;
  readonly namespace: ChainNamespace;
  readonly reference: string;
  readonly name: string;
  readonly nativeAsset: string | null;
  readonly testnet: boolean;
  /** Status of quoting on this chain, not of a live connection. */
  readonly quoting: 'available' | 'planned';
  /** Always false: Meridian does not connect to a node. */
  readonly connected: false;
  /** Always null: there is no RPC client in this process. */
  readonly rpcUrl: null;
}

export const CHAIN_REGISTRY: Readonly<Record<ChainId, ChainMetadata>> = {
  'eip155:1': {
    id: 'eip155:1',
    namespace: 'eip155',
    reference: '1',
    name: 'Ethereum',
    nativeAsset: 'ETH',
    testnet: false,
    quoting: 'available',
    connected: false,
    rpcUrl: null,
  },
  'eip155:8453': {
    id: 'eip155:8453',
    namespace: 'eip155',
    reference: '8453',
    name: 'Base',
    nativeAsset: 'ETH',
    testnet: false,
    quoting: 'planned',
    connected: false,
    rpcUrl: null,
  },
  'eip155:42161': {
    id: 'eip155:42161',
    namespace: 'eip155',
    reference: '42161',
    name: 'Arbitrum',
    nativeAsset: 'ETH',
    testnet: false,
    quoting: 'planned',
    connected: false,
    rpcUrl: null,
  },
  'eip155:11155111': {
    id: 'eip155:11155111',
    namespace: 'eip155',
    reference: '11155111',
    name: 'Sepolia',
    nativeAsset: 'ETH',
    testnet: true,
    quoting: 'planned',
    connected: false,
    rpcUrl: null,
  },
  'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp': {
    id: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
    namespace: 'solana',
    reference: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
    name: 'Solana',
    nativeAsset: null,
    testnet: false,
    quoting: 'planned',
    connected: false,
    rpcUrl: null,
  },
};

export const DEMO_SETTLEMENT_CHAIN_ID: ChainId = 'eip155:1';

export function isChainId(value: unknown): value is ChainId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(CHAIN_REGISTRY, value);
}

export function chainMetadata(chainId: string | null): ChainMetadata | null {
  if (chainId === null || !isChainId(chainId)) {
    return null;
  }
  return CHAIN_REGISTRY[chainId];
}

export function requireChainMetadata(chainId: ChainId): ChainMetadata {
  return CHAIN_REGISTRY[chainId];
}
