import type { CurrencyCode } from '../money/index.js';
import type { FeeSchedule } from './fees.js';
import type { JsonObject } from './json.js';
import type { ProviderId } from './provider.js';
import type { RailType } from './rail.js';

export interface SettlementEstimate {
  /** Median settlement time in whole seconds. */
  readonly p50Seconds: number;
  /** 95th-percentile settlement time in whole seconds. */
  readonly p95Seconds: number;
  /** True when the clock only advances during banking hours in the destination market. */
  readonly businessDaysOnly: boolean;
  /** Daily cut-off after which settlement rolls to the next window, as `"HH:MM"` UTC. */
  readonly cutoffUtc: string | null;
  readonly notes: string | null;
}

/** No execution slippage — a principal quote at a firm rate. */
export interface NoSlippageModel {
  readonly kind: 'none';
}

/**
 * Slippage expressed as basis points that step up with notional. Tiers must be sorted ascending
 * by threshold; the final tier carries a `null` threshold meaning "and above".
 */
export interface TieredSlippageModel {
  readonly kind: 'tiered';
  /** Currency the tier thresholds are denominated in. */
  readonly notionalCurrency: CurrencyCode;
  readonly tiers: readonly {
    readonly upToNotionalMinorUnits: string | null;
    readonly bps: string;
  }[];
}

export type SlippageModel = NoSlippageModel | TieredSlippageModel;

/**
 * Raw pricing input from one liquidity source.
 *
 * Deliberately a set of *primitives*, not a result: there is no `totalCost` field a provider
 * could assert. Cost is derived by {@link RouteCostEngine} so that every route in a comparison is
 * measured the same way, and so a provider cannot define its own definition of "cheap".
 */
export interface ProviderQuote {
  /** Rule 12: every quote is attributable to a provider. */
  readonly providerId: ProviderId;
  readonly rail: RailType;
  /** Rule 11: every quote is timestamped. ISO-8601 with a `Z` offset. */
  readonly quotedAt: string;
  /** When the price stops being indicative, if the provider commits to a window. */
  readonly expiresAt: string | null;
  /** The upstream provider's own reference for this quote, for reconciliation. */
  readonly quoteReference: string | null;
  readonly sourceCurrency: CurrencyCode;
  readonly targetCurrency: CurrencyCode;
  /** Interbank mid-market rate the provider observed, used as the cost benchmark. */
  readonly midMarketRate: string;
  /** The rate the provider offers the customer. */
  readonly offeredRate: string;
  readonly fees: FeeSchedule;
  readonly settlement: SettlementEstimate;
  readonly slippage: SlippageModel;
  /** Historical settlement success rate, `0`..`1`, as a decimal string. */
  readonly reliabilityScore: string;
  /** Asset used for the middle leg, where a rail has one (e.g. `"USDC"`). Never held by us. */
  readonly intermediaryAsset: string | null;
  /** Version of the pricing dataset or upstream contract that produced this quote. */
  readonly pricingVersion: string;
  /**
   * Depth the provider will fill at this price, where the rail has a meaningful notion of it.
   *
   * Optional because most rails do not: a bank's FX desk or a payment institution's payout network
   * has no order book to publish. Absent depth means "not a constraint", not "no liquidity".
   */
  readonly liquidity?:
    | {
        /** In minor units of `sourceCurrency`. */
        readonly availableDepthMinorUnits: string | null;
      }
    | undefined;
  /**
   * Counterparty and settlement risk signals, where the provider or an internal model supplies them.
   *
   * Optional, and scored neutrally when absent — a provider is not penalised for a signal the
   * platform has not yet gathered about it.
   */
  readonly risk?:
    | {
        readonly settlementRiskBps: string | null;
        readonly jurisdictionRisk: 'low' | 'medium' | 'high' | null;
      }
    | undefined;
  /** Verbatim upstream payload, persisted for audit and dispute resolution. */
  readonly raw: JsonObject;
}

export interface QuoteRequest {
  readonly sourceCurrency: CurrencyCode;
  readonly targetCurrency: CurrencyCode;
  /** Send amount in integer minor units of `sourceCurrency`, as a string. */
  readonly amountMinorUnits: string;
  /** Restrict the comparison to these rails. `null` means every registered rail. */
  readonly rails: readonly RailType[] | null;
  /** ISO-8601 timestamp the request was accepted, from the injected clock. */
  readonly requestedAt: string;
}
