import { assetDefinition, assetKind, isAssetCode } from './asset.js';
import {
  CHAIN_REGISTRY,
  DEMO_SETTLEMENT_CHAIN_ID,
  chainMetadata,
  type ChainId,
  type ChainMetadata,
} from './chain.js';
import { CONVERSION_KINDS, conversionKindOf, type ConversionKind } from './conversion.js';
import { ValidationError } from '../errors/index.js';

/**
 * Issued stablecoins this deployment knows how to name.
 *
 * Routing does not switch on these codes. It asks {@link isStablecoinAsset} (the asset kind) and
 * {@link STABLECOIN_CONVERSION_KINDS}. Adding a stablecoin is a registry row plus adapter rates —
 * not a change to the path finder or the cost engine.
 */
export interface StablecoinDefinition {
  readonly code: string;
  readonly name: string;
  readonly exponent: number;
  readonly pegCurrency: string;
  readonly issuer: string;
  readonly defaultChainId: ChainId;
  readonly chains: readonly {
    readonly chainId: ChainId;
    readonly status: 'available' | 'planned';
  }[];
  /** Always false. Meridian never holds the token. */
  readonly custodiedByPlatform: false;
}

export const STABLECOIN_CONVERSION_KINDS = [
  'fiat_stablecoin',
  'stablecoin_fiat',
  'stablecoin_stablecoin',
] as const satisfies readonly ConversionKind[];

export type StablecoinConversionKind = (typeof STABLECOIN_CONVERSION_KINDS)[number];

const DEMO_CHAINS: StablecoinDefinition['chains'] = [
  { chainId: DEMO_SETTLEMENT_CHAIN_ID, status: 'available' },
  { chainId: 'eip155:8453', status: 'planned' },
];

export const STABLECOIN_REGISTRY: Readonly<Record<string, StablecoinDefinition>> = {
  USDC: {
    code: 'USDC',
    name: 'USD Coin',
    exponent: 6,
    pegCurrency: 'USD',
    issuer: 'Circle (demo metadata; not a live issuer connection)',
    defaultChainId: DEMO_SETTLEMENT_CHAIN_ID,
    chains: DEMO_CHAINS,
    custodiedByPlatform: false,
  },
  USDT: {
    code: 'USDT',
    name: 'Tether USD',
    exponent: 6,
    pegCurrency: 'USD',
    issuer: 'Tether (demo metadata; not a live issuer connection)',
    defaultChainId: DEMO_SETTLEMENT_CHAIN_ID,
    chains: DEMO_CHAINS,
    custodiedByPlatform: false,
  },
};

export const SUPPORTED_STABLECOINS: readonly string[] = Object.keys(STABLECOIN_REGISTRY).sort(
  (left, right) => left.localeCompare(right, 'en'),
);

export function isStablecoinAsset(code: string): boolean {
  return isAssetCode(code) && assetKind(code) === 'stablecoin';
}

export function isStablecoinConversionKind(value: ConversionKind): value is StablecoinConversionKind {
  return (STABLECOIN_CONVERSION_KINDS as readonly string[]).includes(value);
}

export function stablecoinDefinition(code: string): StablecoinDefinition | null {
  return STABLECOIN_REGISTRY[code] ?? null;
}

export function chainsOfStablecoin(code: string): readonly ChainMetadata[] {
  const definition = STABLECOIN_REGISTRY[code];
  if (definition === undefined) {
    const fallback = chainMetadata(assetDefinition(code).chainId);
    return fallback === null ? [] : [fallback];
  }
  return definition.chains.map((entry) => CHAIN_REGISTRY[entry.chainId]);
}

/**
 * The chain a quote names for an asset. Fiat has none. On-chain assets use their registered
 * default. Never implies an RPC session.
 */
export function chainOfAsset(asset: string): ChainMetadata | null {
  if (!isAssetCode(asset) || assetKind(asset) === 'fiat') {
    return null;
  }
  const listed = STABLECOIN_REGISTRY[asset];
  if (listed !== undefined) {
    return CHAIN_REGISTRY[listed.defaultChainId];
  }
  return chainMetadata(assetDefinition(asset).chainId);
}

export function assertStablecoinCorridor(
  sourceAsset: string,
  destinationAsset: string,
): StablecoinConversionKind {
  if (sourceAsset === destinationAsset) {
    throw new ValidationError('sourceAsset and destinationAsset must differ.', {
      sourceAsset,
      destinationAsset,
    });
  }
  const kind = conversionKindOf(sourceAsset, destinationAsset);
  if (!isStablecoinConversionKind(kind)) {
    throw new ValidationError(
      `The stablecoin routing layer prices ${STABLECOIN_CONVERSION_KINDS.join(', ')} only. ` +
        `${sourceAsset} → ${destinationAsset} is ${kind}.`,
      {
        sourceAsset,
        destinationAsset,
        conversionKind: kind,
        supported: [...STABLECOIN_CONVERSION_KINDS],
        allConversionKinds: [...CONVERSION_KINDS],
      },
    );
  }
  if (!isStablecoinAsset(sourceAsset) && !isStablecoinAsset(destinationAsset)) {
    throw new ValidationError('A stablecoin route must involve a registered stablecoin.', {
      sourceAsset,
      destinationAsset,
      supportedStablecoins: SUPPORTED_STABLECOINS,
    });
  }
  return kind;
}
