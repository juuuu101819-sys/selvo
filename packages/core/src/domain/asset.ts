import { InvalidAmountError, UnsupportedCurrencyError, ValidationError } from '../errors/index.js';
import { CURRENCY_REGISTRY, isCurrencyCode, type CurrencyCode } from '../money/currency.js';
import { Dec, Rounding } from '../money/decimal.js';

/**
 * What an asset is, independent of how it moves.
 *
 * Fiat stays in {@link CURRENCY_REGISTRY} (ISO 4217). Stablecoins and crypto live here so the
 * comparison API can keep quoting ISO currencies while the provider catalog can talk about USDC
 * and ETH without pretending they are ISO codes or stuffing them into `VARCHAR(3)` currency rows.
 */
export const ASSET_KINDS = ['fiat', 'stablecoin', 'crypto'] as const;
export type AssetKind = (typeof ASSET_KINDS)[number];

export interface AssetDefinition {
  readonly code: string;
  readonly kind: AssetKind;
  /** Minor-unit exponent. `2` for USD, `6` for USDC, `18` for ETH. */
  readonly exponent: number;
  readonly name: string;
  /**
   * CAIP-2 chain id when the asset is on-chain, otherwise `null`.
   *
   * Informational: Meridian never connects to a node, holds a key or submits a transaction.
   */
  readonly chainId: string | null;
}

const FIAT_ASSETS: Record<string, AssetDefinition> = Object.fromEntries(
  Object.values(CURRENCY_REGISTRY).map((currency) => [
    currency.code,
    {
      code: currency.code,
      kind: 'fiat' as const,
      exponent: currency.exponent,
      name: currency.name,
      chainId: null,
    },
  ]),
);

const NON_FIAT_ASSETS = {
  USDC: {
    code: 'USDC',
    kind: 'stablecoin',
    exponent: 6,
    name: 'USD Coin',
    chainId: 'eip155:1',
  },
  USDT: {
    code: 'USDT',
    kind: 'stablecoin',
    exponent: 6,
    name: 'Tether USD',
    chainId: 'eip155:1',
  },
  ETH: {
    code: 'ETH',
    kind: 'crypto',
    exponent: 18,
    name: 'Ether',
    chainId: 'eip155:1',
  },
} as const satisfies Record<string, AssetDefinition>;

export const ASSET_REGISTRY: Readonly<Record<string, AssetDefinition>> = {
  ...FIAT_ASSETS,
  ...NON_FIAT_ASSETS,
};

export type AssetCode = keyof typeof ASSET_REGISTRY;

export const SUPPORTED_ASSETS: readonly string[] = Object.keys(ASSET_REGISTRY).sort((left, right) =>
  left.localeCompare(right, 'en'),
);

export function isAssetCode(value: unknown): value is string {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ASSET_REGISTRY, value);
}

export function assertAssetCode(value: unknown): string {
  if (!isAssetCode(value)) {
    throw new ValidationError(`Asset "${String(value)}" is not supported.`, {
      asset: String(value),
      supported: SUPPORTED_ASSETS,
    });
  }
  return value;
}

export function assetDefinition(code: string): AssetDefinition {
  const asset = ASSET_REGISTRY[assertAssetCode(code)];
  if (asset === undefined) {
    throw new ValidationError(`Asset "${code}" is not supported.`, { asset: code });
  }
  return asset;
}

export function assetExponent(code: string): number {
  return assetDefinition(code).exponent;
}

export function assetKind(code: string): AssetKind {
  return assetDefinition(code).kind;
}

/** Fiat assets are ISO 4217 codes the comparison engine already understands. */
export function fiatCodeOf(asset: string): CurrencyCode {
  const definition = assetDefinition(asset);
  if (definition.kind !== 'fiat' || !isCurrencyCode(definition.code)) {
    throw new UnsupportedCurrencyError(asset, Object.keys(CURRENCY_REGISTRY));
  }
  return definition.code;
}

export function isFiatAsset(code: string): boolean {
  return isAssetCode(code) && assetKind(code) === 'fiat';
}

/**
 * Converts a major-unit decimal string into integer minor units of the asset.
 *
 * More fractional digits than the asset's exponent is a validation error, not a round: a request
 * for `1.0000001 USDC` is ambiguous.
 */
export function toAssetMinorUnits(asset: string, amount: string): string {
  const definition = assetDefinition(asset);
  if (!/^\d{1,24}(\.\d{1,24})?$/.test(amount.trim())) {
    throw new InvalidAmountError(`Amount "${amount}" is not a positive decimal.`, {
      asset,
      amount,
    });
  }
  const [, fraction = ''] = amount.split('.');
  if (fraction.replace(/0+$/, '').length > definition.exponent) {
    throw new ValidationError(
      `${asset} supports ${definition.exponent} decimal place` +
        `${definition.exponent === 1 ? '' : 's'}; "${amount}" is more precise than the asset allows.`,
      { asset, amount, exponent: definition.exponent },
    );
  }
  const scaled = new Dec(amount.trim()).times(new Dec(10).pow(definition.exponent));
  const minor = scaled.toDecimalPlaces(0, Rounding.DOWN);
  if (minor.lte(0)) {
    throw new InvalidAmountError('Amount must be greater than zero.', { asset, amount });
  }
  return minor.toFixed(0);
}
