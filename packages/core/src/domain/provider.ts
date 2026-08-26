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
