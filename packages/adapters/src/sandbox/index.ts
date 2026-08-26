import type { RouteProvider } from '@meridian/core';
import { loadReferenceRates, loadSandboxPricing, resolvePricingDataDir } from '../data/load.js';
import { StaticReferenceRateSource } from '../reference-rates.js';
import { DataDrivenSandboxProvider } from './data-driven-provider.js';

export interface SandboxAdapterSet {
  readonly providers: readonly RouteProvider[];
  readonly rates: StaticReferenceRateSource;
  readonly pricingVersion: string;
  readonly referenceRatesVersion: string;
  readonly dataDir: string;
  readonly disclaimer: string;
}

/**
 * Builds the sandbox rail adapters from the pricing dataset.
 *
 * Adding a rail is a data change, not a code change. A live partner in Phase 3 arrives as a new
 * `RouteProvider` implementation registered alongside these, with no change to the engine.
 */
export function createSandboxAdapters(options: { dataDir?: string } = {}): SandboxAdapterSet {
  const dataDir = resolvePricingDataDir(options.dataDir);
  const rateData = loadReferenceRates(dataDir);
  const pricing = loadSandboxPricing(dataDir);
  const rates = new StaticReferenceRateSource(rateData);

  const providers = pricing.providers.map(
    (profile) =>
      new DataDrivenSandboxProvider({
        profile,
        rates,
        currencyGroups: pricing.currencyGroups,
        pricingVersion: pricing.version,
      }),
  );

  return {
    providers,
    rates,
    pricingVersion: pricing.version,
    referenceRatesVersion: rateData.version,
    dataDir,
    disclaimer: pricing.disclaimer,
  };
}

export { DataDrivenSandboxProvider, type SandboxProviderOptions } from './data-driven-provider.js';
