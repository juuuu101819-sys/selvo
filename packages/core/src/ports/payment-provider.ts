import type { JsonObject } from '../domain/json.js';
import type { SettlementEstimate } from '../domain/quote.js';
import type { CurrencyCode } from '../money/currency.js';
import type {
  ProviderAdapter,
  ProviderContext,
  ProviderFee,
  ProviderQuoteEnvelope,
} from './provider-adapter.js';

export interface PaymentQuoteRequest {
  readonly baseCurrency: CurrencyCode;
  readonly quoteCurrency: CurrencyCode;
  readonly amountMinorUnits: string;
  /** Optional narrowing when the destination market has several payout rails. */
  readonly payoutMethod?: string | undefined;
}

/**
 * A licensed payment institution's price for moving value and paying out locally.
 *
 * Distinct from {@link FXProvider} because the conversion is only half of what is being priced: the
 * payout rail, its cut-off and its local charges are the other half, and they frequently dominate
 * the cost on emerging-market corridors. Modelling them separately is what stops a keen headline
 * rate hiding an expensive last mile.
 */
export interface PaymentQuote extends ProviderQuoteEnvelope {
  readonly baseCurrency: CurrencyCode;
  readonly quoteCurrency: CurrencyCode;
  readonly rate: string;
  readonly midMarketRate: string | null;
  readonly providerFee: ProviderFee | null;
  readonly additionalFees: readonly ProviderFee[];
  readonly amountMinorUnits: string;
  /** The rail the beneficiary is paid over, e.g. `"local_ach"`, `"rtgs"`, `"swift"`. */
  readonly payoutMethod: string;
  readonly settlement: SettlementEstimate;
  /** Non-secret operational notes: cut-off behaviour, supported beneficiary types. */
  readonly metadata: JsonObject;
}

export interface PaymentProvider extends ProviderAdapter {
  readonly capability: 'payment';
  supports(request: PaymentQuoteRequest): boolean;
  getPaymentQuote(request: PaymentQuoteRequest, context: ProviderContext): Promise<PaymentQuote>;
}
