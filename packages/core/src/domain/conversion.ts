import { ValidationError } from '../errors/index.js';
import { assetKind, type AssetKind } from './asset.js';

/**
 * The conversion a normalised quote represents.
 *
 * This is the quote *model*, not a promise that every provider will price every pair. A DEX may
 * quote `stablecoin_crypto` and refuse `fiat_fiat`; an FX desk does the reverse. The engine's
 * existing `QuoteRequest` remains fiat → fiat.
 */
export const CONVERSION_KINDS = [
  'fiat_fiat',
  'fiat_stablecoin',
  'stablecoin_fiat',
  'stablecoin_stablecoin',
  'stablecoin_crypto',
  'crypto_stablecoin',
  'crypto_fiat',
] as const;

export type ConversionKind = (typeof CONVERSION_KINDS)[number];

const KIND_BY_PAIR: Readonly<Record<`${AssetKind}_${AssetKind}`, ConversionKind | null>> = {
  fiat_fiat: 'fiat_fiat',
  fiat_stablecoin: 'fiat_stablecoin',
  fiat_crypto: null,
  stablecoin_fiat: 'stablecoin_fiat',
  stablecoin_stablecoin: 'stablecoin_stablecoin',
  stablecoin_crypto: 'stablecoin_crypto',
  crypto_fiat: 'crypto_fiat',
  crypto_stablecoin: 'crypto_stablecoin',
  crypto_crypto: null,
};

export function isConversionKind(value: unknown): value is ConversionKind {
  return typeof value === 'string' && (CONVERSION_KINDS as readonly string[]).includes(value);
}

export function conversionKindOf(sourceAsset: string, targetAsset: string): ConversionKind {
  const source = assetKind(sourceAsset);
  const target = assetKind(targetAsset);
  const kind = KIND_BY_PAIR[`${source}_${target}`];
  if (kind === null) {
    throw new ValidationError(
      `No normalised conversion kind for ${source} → ${target} (${sourceAsset} to ${targetAsset}).`,
      { sourceAsset, targetAsset, sourceKind: source, targetKind: target },
    );
  }
  return kind;
}
