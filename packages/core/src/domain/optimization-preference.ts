/**
 * AI-facing optimization preferences.
 *
 * These name *what to optimize for*. They are not prices. Mapping them onto routing weights is the
 * routing engine's job; the natural-language interpreter must not invent rates, fees, slippage or
 * settlement amounts.
 */

export const OPTIMIZATION_PREFERENCES = [
  'LOWEST_COST',
  'FASTEST',
  'BALANCED',
  'LOWEST_SLIPPAGE',
  'HIGH_LIQUIDITY',
] as const;

export type OptimizationPreference = (typeof OPTIMIZATION_PREFERENCES)[number];

export const NL_PIPELINE_STAGES = [
  'natural_language',
  'intent_parser',
  'structured_payment_intent',
  'policy_engine',
  'routing_engine',
  'provider_quote',
  'route_selection',
  'execution_intent',
] as const;

export type NlPipelineStage = (typeof NL_PIPELINE_STAGES)[number];

export const NL_INTERPRETER = 'deterministic_parser' as const;

export const NL_DID_NOT_COMPUTE = [
  'exchange_rates',
  'fees',
  'slippage',
  'settlement_amounts',
] as const;

export type NlDidNotCompute = (typeof NL_DID_NOT_COMPUTE)[number];

/** Persistable snake_case twin of {@link OptimizationPreference}, plus `recommended` (balanced). */
export const ROUTE_PREFERENCE_VALUES = [
  'lowest_cost',
  'fastest',
  'recommended',
  'balanced',
  'lowest_slippage',
  'high_liquidity',
] as const;

export type RoutePreferenceValue = (typeof ROUTE_PREFERENCE_VALUES)[number];

export function isOptimizationPreference(value: unknown): value is OptimizationPreference {
  return (
    typeof value === 'string' &&
    (OPTIMIZATION_PREFERENCES as readonly string[]).includes(value)
  );
}

export function isRoutePreferenceValue(value: unknown): value is RoutePreferenceValue {
  return (
    typeof value === 'string' && (ROUTE_PREFERENCE_VALUES as readonly string[]).includes(value)
  );
}

export function routePreferenceFromOptimization(
  preference: OptimizationPreference,
): RoutePreferenceValue {
  if (preference === 'LOWEST_COST') {
    return 'lowest_cost';
  }
  if (preference === 'FASTEST') {
    return 'fastest';
  }
  if (preference === 'LOWEST_SLIPPAGE') {
    return 'lowest_slippage';
  }
  if (preference === 'HIGH_LIQUIDITY') {
    return 'high_liquidity';
  }
  return 'balanced';
}

export function optimizationFromRoutePreference(
  preference: RoutePreferenceValue | null,
): OptimizationPreference | null {
  if (preference === 'lowest_cost') {
    return 'LOWEST_COST';
  }
  if (preference === 'fastest') {
    return 'FASTEST';
  }
  if (preference === 'lowest_slippage') {
    return 'LOWEST_SLIPPAGE';
  }
  if (preference === 'high_liquidity') {
    return 'HIGH_LIQUIDITY';
  }
  if (preference === 'balanced' || preference === 'recommended') {
    return 'BALANCED';
  }
  return null;
}

/**
 * Scoring weights the multi-rail engine already understands.
 *
 * Sum is exactly 1. `BALANCED` returns null so the engine uses platform defaults — the parser does
 * not invent a second scoring model. `LOWEST_SLIPPAGE` does not compute slippage: it asks the
 * engine to prefer cheaper, deeper fills using existing cost, liquidity and settlement-confidence
 * factors (DeFi cost already includes engine-computed slippage).
 */
export function weightsForOptimizationPreference(
  preference: OptimizationPreference | RoutePreferenceValue | null,
): {
  readonly cost: string;
  readonly speed: string;
  readonly finality: string;
  readonly fxRate: string;
  readonly slippage: string;
  readonly liquidity: string;
  readonly compliance: string;
} | null {
  if (preference === 'LOWEST_COST' || preference === 'lowest_cost') {
    return {
      cost: '1',
      speed: '0',
      finality: '0',
      fxRate: '0',
      slippage: '0',
      liquidity: '0',
      compliance: '0',
    };
  }
  if (preference === 'FASTEST' || preference === 'fastest') {
    return {
      cost: '0',
      speed: '1',
      finality: '0',
      fxRate: '0',
      slippage: '0',
      liquidity: '0',
      compliance: '0',
    };
  }
  if (preference === 'HIGH_LIQUIDITY' || preference === 'high_liquidity') {
    return {
      cost: '0',
      speed: '0',
      finality: '0',
      fxRate: '0',
      slippage: '0',
      liquidity: '1',
      compliance: '0',
    };
  }
  if (preference === 'LOWEST_SLIPPAGE' || preference === 'lowest_slippage') {
    return {
      cost: '0',
      speed: '0',
      finality: '0',
      fxRate: '0',
      slippage: '1',
      liquidity: '0',
      compliance: '0',
    };
  }
  return null;
}
