import type { FinancialProvider, RouteProvider } from '@meridian/core';
import { RouteFinancialProvider } from '../bridge/route-financial-provider.js';
import { DemoAmmProvider } from './demo-amm-provider.js';
import { DemoDexAggregatorProvider } from './demo-dex-aggregator.js';
import { DemoDexProvider } from './demo-dex-provider.js';
import { DemoStablecoinRampProvider } from './demo-stablecoin-ramp.js';

export interface FinancialCatalogOptions {
  /**
   * When false, only wrapped `RouteProvider`s are returned. Production must pass false so Helios
   * ramp and the three DeFi demo adapters are never presented as live venues.
   *
   * Default true preserves the sandbox catalog used by local development and existing tests.
   */
  readonly includeDemoAdapters?: boolean;
}

/**
 * Builds the financial-provider catalog.
 *
 * The comparison-engine rails are wrapped so they speak the normalised contract. Dedicated demo
 * adapters cover fiat ↔ stablecoin ramps and read-only DeFi depth. None of them execute. Production
 * must not include those demo adapters.
 */
export function createFinancialCatalog(
  routeProviders: readonly RouteProvider[],
  options: FinancialCatalogOptions = {},
): readonly FinancialProvider[] {
  const wrapped = routeProviders.map((provider) => new RouteFinancialProvider(provider));
  if (options.includeDemoAdapters === false) {
    return wrapped;
  }
  return [
    ...wrapped,
    new DemoStablecoinRampProvider(),
    new DemoAmmProvider(),
    new DemoDexAggregatorProvider(),
    new DemoDexProvider(),
  ];
}
