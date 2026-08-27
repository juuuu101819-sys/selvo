import type { FinancialProvider, RouteProvider } from '@meridian/core';
import { RouteFinancialProvider } from '../bridge/route-financial-provider.js';
import { DemoAmmProvider } from './demo-amm-provider.js';
import { DemoDexAggregatorProvider } from './demo-dex-aggregator.js';
import { DemoStablecoinRampProvider } from './demo-stablecoin-ramp.js';

/**
 * Builds the sandbox financial-provider catalog.
 *
 * The four comparison-engine rails are wrapped so they speak the normalised contract. Dedicated
 * demo adapters cover fiat ↔ stablecoin ramps and read-only DeFi depth. None of them execute.
 */
export function createFinancialCatalog(
  routeProviders: readonly RouteProvider[],
): readonly FinancialProvider[] {
  const wrapped = routeProviders.map((provider) => new RouteFinancialProvider(provider));
  return [
    ...wrapped,
    new DemoStablecoinRampProvider(),
    new DemoAmmProvider(),
    new DemoDexAggregatorProvider(),
  ];
}
