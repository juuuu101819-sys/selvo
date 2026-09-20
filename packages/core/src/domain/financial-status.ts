import { PAYMENT_INTENT_STATUSES, type PaymentIntentStatus } from './agent-payments.js';
import { INVOICE_COLLECTION_STATUSES, type InvoiceCollectionStatus } from './billing.js';

/** Must stay identical to `EXECUTION_INTENT_STATUS` in `ports/execution-intent.ts`. */
export const DOCUMENTED_EXECUTION_INTENT_STATUS = 'recorded' as const;

/**
 * Financial meaning of every lifecycle status the API can return.
 *
 * None of these values mean money moved, a partner executed, settlement was verified, or revenue
 * was realized. `POST /api/v1/executions` remains 501. This catalog is the source of truth for
 * `docs/API.md` coverage tests — a new status without an entry here (and without an API.md row)
 * fails CI.
 *
 * Route View ≠ Route Selection ≠ Execution Intent ≠ External Provider Execution ≠ Verified
 * Settlement ≠ Realized Revenue.
 */

export const REALIZED_REVENUE = false;

export interface FinancialStatusDoc {
  readonly family: 'payment_intent' | 'execution_intent' | 'transaction_request' | 'quote' | 'invoice';
  readonly value: string;
  /** One-line financial meaning. Does not use `|` so API.md tables stay parseable. */
  readonly meaning: string;
  readonly impliesFundsMoved: false;
  readonly impliesExternalProviderExecution: false;
  readonly impliesVerifiedSettlement: false;
  readonly impliesRealizedRevenue: false;
}

function doc(
  family: FinancialStatusDoc['family'],
  value: string,
  meaning: string,
): FinancialStatusDoc {
  return {
    family,
    value,
    meaning,
    impliesFundsMoved: false,
    impliesExternalProviderExecution: false,
    impliesVerifiedSettlement: false,
    impliesRealizedRevenue: false,
  };
}

/**
 * Names retired in PA-H13 because they read as licensed-rail settlement.
 * Do not reintroduce them as payment-intent statuses.
 */
export const RETIRED_PAYMENT_INTENT_STATUSES = [
  'AUTHORIZED',
  'EXECUTION_PENDING',
  'COMPLETED',
] as const;

export const PAYMENT_INTENT_STATUS_DOCS: Record<PaymentIntentStatus, FinancialStatusDoc> = {
  CREATED: doc(
    'payment_intent',
    'CREATED',
    'Intent accepted. No quote yet. No funds reserved or moved.',
  ),
  QUOTING: doc(
    'payment_intent',
    'QUOTING',
    'Router is collecting indicative quotes. Not an execution in flight.',
  ),
  QUOTED: doc(
    'payment_intent',
    'QUOTED',
    'Indicative quotes attached. Route view only. Not a selection and not a payment.',
  ),
  ROUTED: doc(
    'payment_intent',
    'ROUTED',
    'A quoted route was selected. Daily simulated spend is reserved. Not provider execution.',
  ),
  POLICY_APPROVED: doc(
    'payment_intent',
    'POLICY_APPROVED',
    'Policy Engine approved the selected route. Not card authorization and not a funds hold.',
  ),
  SIMULATION_PENDING: doc(
    'payment_intent',
    'SIMULATION_PENDING',
    'Sandbox simulator is about to run. No external provider is instructed.',
  ),
  SIMULATION_COMPLETED: doc(
    'payment_intent',
    'SIMULATION_COMPLETED',
    'Sandbox simulator finished. fundsMoved stays false. Not verified settlement or realized revenue.',
  ),
  FAILED: doc(
    'payment_intent',
    'FAILED',
    'Intent processing failed (policy or simulation). No rail payment was submitted, so none failed at a partner.',
  ),
  EXPIRED: doc(
    'payment_intent',
    'EXPIRED',
    'Intent or quote validity window elapsed. Pricing must be re-quoted. No funds moved.',
  ),
};

export const TRANSACTION_REQUEST_STATUSES = [
  'draft',
  'quoted',
  'quotes_expired',
  'quote_selected',
  'cancelled',
] as const;
export type TransactionRequestStatus = (typeof TRANSACTION_REQUEST_STATUSES)[number];

export const TRANSACTION_REQUEST_STATUS_DOCS: Record<TransactionRequestStatus, FinancialStatusDoc> =
  {
    draft: doc(
      'transaction_request',
      'draft',
      'Customer request recorded, not yet priced. Not a payment.',
    ),
    quoted: doc(
      'transaction_request',
      'quoted',
      'At least one live indicative quote. Route view only.',
    ),
    quotes_expired: doc(
      'transaction_request',
      'quotes_expired',
      'Every quote passed expiry. Re-quote required. No funds moved.',
    ),
    quote_selected: doc(
      'transaction_request',
      'quote_selected',
      'Customer indicated which quote they intend to use. Non-binding. No funds move.',
    ),
    cancelled: doc(
      'transaction_request',
      'cancelled',
      'Withdrawn by the customer or the platform. Not a reversed settlement.',
    ),
  };

export const QUOTE_STATUSES = ['active', 'expired', 'superseded', 'withdrawn'] as const;
export type StoredQuoteStatus = (typeof QUOTE_STATUSES)[number];

export const QUOTE_STATUS_DOCS: Record<StoredQuoteStatus, FinancialStatusDoc> = {
  active: doc('quote', 'active', 'Indicative quote still inside its freshness window. Non-binding.'),
  expired: doc('quote', 'expired', 'Quote past expiresAt. Must not be ranked or selected.'),
  superseded: doc(
    'quote',
    'superseded',
    'Replaced by a newer quote from the same provider for the same request.',
  ),
  withdrawn: doc('quote', 'withdrawn', 'Provider withdrew or declined the price. Not a chargeback.'),
};

export const EXECUTION_INTENT_STATUS_DOCS: Record<
  typeof DOCUMENTED_EXECUTION_INTENT_STATUS,
  FinancialStatusDoc
> = {
  recorded: doc(
    'execution_intent',
    DOCUMENTED_EXECUTION_INTENT_STATUS,
    'Route choice persisted. executable and submitted stay false. Not provider execution.',
  ),
};

export const INVOICE_STATUS_DOCS: Record<'issued' | InvoiceCollectionStatus, FinancialStatusDoc> = {
  issued: doc(
    'invoice',
    'issued',
    'Platform-fee invoice generated from monetization snapshots. Not cash received and not realized revenue.',
  ),
  uncollected: doc(
    'invoice',
    'uncollected',
    'No money has been requested against this invoice. Issuing one is not confirmed payment or realized revenue.',
  ),
  // `collected` is the one status that is a *precondition* of realized revenue, which is why it
  // still declares `impliesRealizedRevenue: false` rather than being an exception to the rule.
  // Realization needs three facts (see `resolveRevenueLifecycle`): a production origin, a
  // provider-confirmed settlement, and this collection. A collected invoice supplies the third
  // only. It also moves no customer settlement funds — the fee paid here is SELVO's own, which is
  // why `impliesFundsMoved` stays false in the non-custodial sense the field carries everywhere.
  collected: doc(
    'invoice',
    'collected',
    'Platform fee confirmed paid to the platform against a processor reference. Customer settlement funds did not move, and realization still requires a production origin and provider-confirmed finality.',
  ),
};

export const API_FINANCIAL_STATUS_DOCS: readonly FinancialStatusDoc[] = [
  ...PAYMENT_INTENT_STATUSES.map((status) => PAYMENT_INTENT_STATUS_DOCS[status]),
  EXECUTION_INTENT_STATUS_DOCS[DOCUMENTED_EXECUTION_INTENT_STATUS],
  ...TRANSACTION_REQUEST_STATUSES.map((status) => TRANSACTION_REQUEST_STATUS_DOCS[status]),
  ...QUOTE_STATUSES.map((status) => QUOTE_STATUS_DOCS[status]),
  INVOICE_STATUS_DOCS.issued,
  ...INVOICE_COLLECTION_STATUSES.map((status) => INVOICE_STATUS_DOCS[status]),
];

export function financialStatusDocFor(
  family: FinancialStatusDoc['family'],
  value: string,
): FinancialStatusDoc | null {
  return API_FINANCIAL_STATUS_DOCS.find((entry) => entry.family === family && entry.value === value) ??
    null;
}
