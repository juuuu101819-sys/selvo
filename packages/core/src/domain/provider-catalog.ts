import { familyOf, type RailFamily, type RailType } from './rail.js';
import type { ConversionKind } from './conversion.js';

/**
 * Top-level provider category. Aligns with rail families; `traditional` is the catalog name for
 * `tradfi` so the wire contract matches the product language (TRADITIONAL / STABLECOIN / DEFI).
 */
export const PROVIDER_CATEGORIES = ['traditional', 'stablecoin', 'defi'] as const;
export type ProviderCategory = (typeof PROVIDER_CATEGORIES)[number];

/**
 * Capability tags a provider advertises.
 *
 * Orthogonal to {@link ProviderAdapter.capability}, which is *how the platform talks to it*
 * (fx vs payment vs route). These tags are *what it is allowed to be asked about* — a DEX that
 * can quote a stablecoin pair is still not an FX desk.
 */
export const PROVIDER_FEATURE_TAGS = [
  'traditional',
  'stablecoin',
  'defi',
  'fx',
  'fiat',
  'payment',
  'settlement',
  'on_off_ramp',
  'swap',
  'on_chain',
  'amm',
  'aggregator',
] as const;

export type ProviderFeatureTag = (typeof PROVIDER_FEATURE_TAGS)[number];

export interface ProviderCapabilityProfile {
  readonly category: ProviderCategory;
  readonly features: readonly ProviderFeatureTag[];
  readonly conversionKinds: readonly ConversionKind[];
  readonly rails: readonly RailType[];
}

export function categoryOfFamily(family: RailFamily): ProviderCategory {
  return family === 'tradfi' ? 'traditional' : family;
}

export function categoryOfRail(rail: RailType): ProviderCategory {
  return categoryOfFamily(familyOf(rail));
}

export function isProviderCategory(value: unknown): value is ProviderCategory {
  return typeof value === 'string' && (PROVIDER_CATEGORIES as readonly string[]).includes(value);
}

export function isProviderFeatureTag(value: unknown): value is ProviderFeatureTag {
  return typeof value === 'string' && (PROVIDER_FEATURE_TAGS as readonly string[]).includes(value);
}

const TRADITIONAL_FIAT: readonly ConversionKind[] = ['fiat_fiat'];
const STABLECOIN_CONVERSIONS: readonly ConversionKind[] = [
  'fiat_fiat',
  'fiat_stablecoin',
  'stablecoin_fiat',
  'stablecoin_stablecoin',
];
const DEFI_CONVERSIONS: readonly ConversionKind[] = [
  'stablecoin_stablecoin',
  'stablecoin_crypto',
  'crypto_stablecoin',
  'crypto_fiat',
];

/** Default catalog profile for a rail. Individual providers may advertise a subset. */
export function defaultProfileForRail(rail: RailType): ProviderCapabilityProfile {
  const category = categoryOfRail(rail);
  switch (rail) {
    case 'bank_fx':
      return {
        category,
        features: ['traditional', 'fx', 'fiat'],
        conversionKinds: TRADITIONAL_FIAT,
        rails: [rail],
      };
    case 'payment_institution':
      return {
        category,
        features: ['traditional', 'payment', 'fiat'],
        conversionKinds: TRADITIONAL_FIAT,
        rails: [rail],
      };
    case 'liquidity_provider':
      return {
        category,
        features: ['traditional', 'fx', 'fiat'],
        conversionKinds: TRADITIONAL_FIAT,
        rails: [rail],
      };
    case 'treasury_product':
      return {
        category,
        features: ['traditional', 'fiat'],
        conversionKinds: TRADITIONAL_FIAT,
        rails: [rail],
      };
    case 'stablecoin_settlement':
      return {
        category,
        features: ['stablecoin', 'settlement'],
        conversionKinds: STABLECOIN_CONVERSIONS,
        rails: [rail],
      };
    case 'dex_liquidity':
      return {
        category,
        features: ['defi', 'swap', 'on_chain', 'stablecoin'],
        conversionKinds: DEFI_CONVERSIONS,
        rails: [rail],
      };
  }
}
