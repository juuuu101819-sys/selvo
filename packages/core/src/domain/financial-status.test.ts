import { describe, expect, it } from 'vitest';
import { PAYMENT_INTENT_STATUSES } from './agent-payments.js';
import { EXECUTION_INTENT_STATUS } from '../ports/execution-intent.js';
import {
  API_FINANCIAL_STATUS_DOCS,
  DOCUMENTED_EXECUTION_INTENT_STATUS,
  EXECUTION_INTENT_STATUS_DOCS,
  PAYMENT_INTENT_STATUS_DOCS,
  QUOTE_STATUS_DOCS,
  QUOTE_STATUSES,
  REALIZED_REVENUE,
  RETIRED_PAYMENT_INTENT_STATUSES,
  TRANSACTION_REQUEST_STATUS_DOCS,
  TRANSACTION_REQUEST_STATUSES,
} from './financial-status.js';

describe('API financial status catalog', () => {
  it('documents every payment-intent status and none of the retired settlement-like names', () => {
    expect(Object.keys(PAYMENT_INTENT_STATUS_DOCS).sort()).toEqual(
      [...PAYMENT_INTENT_STATUSES].sort(),
    );
    for (const retired of RETIRED_PAYMENT_INTENT_STATUSES) {
      expect(PAYMENT_INTENT_STATUSES as readonly string[]).not.toContain(retired);
    }
  });

  it('documents execution-intent, transaction-request, and quote statuses', () => {
    expect(DOCUMENTED_EXECUTION_INTENT_STATUS).toBe(EXECUTION_INTENT_STATUS);
    expect(Object.keys(EXECUTION_INTENT_STATUS_DOCS)).toEqual([DOCUMENTED_EXECUTION_INTENT_STATUS]);
    expect(Object.keys(TRANSACTION_REQUEST_STATUS_DOCS).sort()).toEqual(
      [...TRANSACTION_REQUEST_STATUSES].sort(),
    );
    expect(Object.keys(QUOTE_STATUS_DOCS).sort()).toEqual([...QUOTE_STATUSES].sort());
  });

  it('never implies funds movement, provider execution, settlement, or realized revenue', () => {
    expect(API_FINANCIAL_STATUS_DOCS.length).toBeGreaterThan(0);
    for (const entry of API_FINANCIAL_STATUS_DOCS) {
      expect(entry.impliesFundsMoved).toBe(false);
      expect(entry.impliesExternalProviderExecution).toBe(false);
      expect(entry.impliesVerifiedSettlement).toBe(false);
      expect(entry.impliesRealizedRevenue).toBe(REALIZED_REVENUE);
      expect(entry.meaning.length).toBeGreaterThan(20);
      expect(entry.meaning).not.toContain('|');
    }
  });
});
