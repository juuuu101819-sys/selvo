import type { Merchant } from './agent-payments.js';
import type { OptimizationPreference } from './optimization-preference.js';

/**
 * Structured payment intent produced by the natural-language interpreter.
 *
 * Amount is decimal-safe (no IEEE floats). The interpreter never fills exchange rates, fees,
 * slippage or settlement amounts — those come from the routing engine after this object exists.
 */
export interface StructuredNlPaymentIntent {
  readonly amount: {
    readonly asset: string;
    readonly minorUnits: string;
    readonly decimal: string;
    readonly exponent: number;
  };
  readonly sourceAsset: string;
  readonly destinationAsset: string;
  readonly recipient: string;
  readonly optimizationPreference: OptimizationPreference | null;
  readonly instruction: string;
  readonly interpreter: 'deterministic_parser';
  readonly aiUsed: false;
  readonly financialsComputedBy: null;
  readonly didNotCompute: readonly [
    'exchange_rates',
    'fees',
    'slippage',
    'settlement_amounts',
  ];
  readonly merchant: Merchant;
}
