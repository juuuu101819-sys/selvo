import {
  systemClock,
  type Clock,
  type FXProvider,
  type Logger,
  type MarketDataProvider,
  type QuoteRecorder,
  noopLogger,
} from '@meridian/core';
import { FXRouteProvider } from '../bridge/fx-route-provider.js';
import { createSandboxAdapters } from '../sandbox/index.js';
import { withResilientFX, withResilientMarketData } from '../resilience/decorators.js';
import type { ResiliencePolicy } from '../resilience/policy.js';
import { DemoFXProvider, type DemoFXProviderOptions } from './demo-fx-provider.js';
import { DemoMarketDataProvider } from './demo-market-data-provider.js';

export interface DemoMarketDataStackOptions {
  readonly clock?: Clock;
  readonly logger?: Logger;
  readonly recorder?: QuoteRecorder;
  readonly policy?: ResiliencePolicy;
  readonly dataDir?: string;
  readonly fx?: Omit<DemoFXProviderOptions, 'marketData'>;
}

export interface DemoMarketDataStack {
  readonly marketData: MarketDataProvider;
  readonly fx: FXProvider;
  /** The same FX provider presented to the routing engine. */
  readonly route: FXRouteProvider;
}

/**
 * Composes the demo market data stack: a reference feed, an FX provider priced against it, both
 * wrapped in the resilience pipeline, and a bridge presenting the result to the routing engine.
 *
 * Wiring this in one place shows the intended assembly order — benchmark, then price, then
 * resilience, then bridge — rather than leaving each caller to rediscover it and get it subtly wrong.
 */
export function createDemoMarketDataStack(
  options: DemoMarketDataStackOptions = {},
): DemoMarketDataStack {
  const clock = options.clock ?? systemClock;
  const logger = options.logger ?? noopLogger;
  const deps = {
    clock,
    logger,
    ...(options.recorder === undefined ? {} : { recorder: options.recorder }),
  };
  const resilience = options.policy === undefined ? {} : { policy: options.policy };

  const sandbox = createSandboxAdapters(
    options.dataDir === undefined ? {} : { dataDir: options.dataDir },
  );

  const marketData = withResilientMarketData(
    new DemoMarketDataProvider({ rates: sandbox.rates }),
    deps,
    resilience,
  );

  const fx = withResilientFX(new DemoFXProvider({ marketData, ...options.fx }), deps, resilience);

  return {
    marketData,
    fx,
    route: new FXRouteProvider({ fx, marketData }),
  };
}

export { DemoFXProvider, type DemoFXProviderOptions } from './demo-fx-provider.js';
export {
  DemoMarketDataProvider,
  type DemoMarketDataProviderOptions,
} from './demo-market-data-provider.js';
export { DemoAmmProvider } from './demo-amm-provider.js';
export { DemoDexAggregatorProvider } from './demo-dex-aggregator.js';
export { DemoDexProvider } from './demo-dex-provider.js';
export { DemoStablecoinRampProvider } from './demo-stablecoin-ramp.js';
export { createFinancialCatalog } from './catalog.js';
