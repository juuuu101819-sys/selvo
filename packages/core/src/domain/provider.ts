import type { RailType } from './rail.js';

/** Stable identifier for a liquidity source, e.g. `"sandbox-global-bank"`. */
export type ProviderId = string;

export const PLATFORM_MODES = ['sandbox', 'production'] as const;
export type PlatformMode = (typeof PLATFORM_MODES)[number];

/**
 * The regulatory posture of a provider. The registry uses this to decide whether an adapter may
 * be served in a given platform mode, so a sandbox price can never reach a production caller.
 */
export const PROVIDER_LICENSING = [
  /** Synthetic reference pricing. Indicative only, sandbox mode only. */
  'unlicensed_sandbox',
  /** A licensed institution supplying its own quotes under a commercial agreement. */
  'licensed_partner',
  /** An internal pricing model, e.g. a benchmark or a modelled DEX curve. */
  'internal_model',
] as const;

export type ProviderLicensing = (typeof PROVIDER_LICENSING)[number];

/** Short UI/API labels. Do not relabel sandbox adapters as licensed (PA-C01 / PHASE 30). */
export const PROVIDER_LICENSING_LABELS: Record<ProviderLicensing, string> = {
  unlicensed_sandbox: 'Sandbox',
  licensed_partner: 'Licensed partner',
  internal_model: 'Internal model',
};

export const PROVIDER_LICENSING_HINTS: Record<ProviderLicensing, string> = {
  unlicensed_sandbox: 'Unlicensed sandbox pricing. Indicative only; not a licensed institution.',
  licensed_partner: 'Licensed partner quote under a commercial agreement.',
  internal_model: 'Internal pricing model (benchmark or modelled curve), not a live licensed quote.',
};

export function isProviderLicensing(value: unknown): value is ProviderLicensing {
  return typeof value === 'string' && (PROVIDER_LICENSING as readonly string[]).includes(value);
}

export function providerLicensingLabel(licensing: string): string {
  return isProviderLicensing(licensing) ? PROVIDER_LICENSING_LABELS[licensing] : 'Unknown source';
}

export interface ProviderDescriptor {
  readonly id: ProviderId;
  readonly name: string;
  readonly rail: RailType;
  readonly licensing: ProviderLicensing;
  /** Modes this provider may be registered in. */
  readonly modes: readonly PlatformMode[];
  /** ISO 3166-1 alpha-2 codes the provider is authorised to serve, or `["*"]` for global. */
  readonly jurisdictions: readonly string[];
  readonly description: string;
  /** Version of the pricing dataset or upstream API contract behind this adapter. */
  readonly pricingVersion: string;
}
