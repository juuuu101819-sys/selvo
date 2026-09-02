import { describe, expect, it } from 'vitest';
import {
  BILLING_LIVE_SCOPE_KEY,
  GO_LIVE_CHECKLIST_PATH,
  parseLegalSignOff,
  type LiveEnablementRecord,
} from '../domain/live-enablement.js';
import {
  attemptLiveSubscriptionBilling,
  attemptPartnerPayouts,
  attemptPlatformFeeCollection,
} from './live-billing.js';

const NOW = '2026-03-01T09:00:00.000Z';

function billingRecord(): LiveEnablementRecord {
  return {
    id: 'lve_billing',
    scope: 'billing',
    scopeKey: BILLING_LIVE_SCOPE_KEY,
    region: 'US',
    enabled: true,
    signOff: parseLegalSignOff(
      {
        approvedBy: 'cfo@meridian.example',
        licenseBasis: 'Unconfirmed — test fixture only; not a named legal entity',
        approvedAt: '2026-01-15T00:00:00.000Z',
        expiresAt: '2027-01-15T00:00:00.000Z',
        checklistRef: `${GO_LIVE_CHECKLIST_PATH}#billing-collection`,
      },
      { scope: 'billing', scopeKey: BILLING_LIVE_SCOPE_KEY, nowIso: NOW },
    ),
    createdAt: NOW,
    updatedAt: NOW,
    disabledAt: null,
    disabledReason: null,
  };
}

describe('live billing modules', () => {
  it('does not collect invoices when BILLING_LIVE_ENABLED is false', () => {
    const result = attemptPlatformFeeCollection({
      nowIso: NOW,
      billingLiveEnabled: false,
      billingRecord: billingRecord(),
      invoices: [],
    });
    expect(result.collected).toBe(false);
    expect(result.invoicesCollected).toBe(0);
    expect(result.fundsMoved).toBe(false);
    expect(result.realizedRevenue).toBe(false);
    expect(result.blockingReasons).toContain('BILLING_LIVE_ENABLED=false');
  });

  it('does not run live subscription charges or partner payouts when the flag is off', () => {
    const input = { nowIso: NOW, billingLiveEnabled: false, billingRecord: billingRecord() };
    const subscriptions = attemptLiveSubscriptionBilling(input);
    const payouts = attemptPartnerPayouts(input);
    expect(subscriptions.subscriptionsCharged).toBe(0);
    expect(subscriptions.collected).toBe(false);
    expect(payouts.payoutsDisbursed).toBe(0);
    expect(payouts.payableRowsCreated).toBe(0);
    expect(payouts.fundsMoved).toBe(false);
  });
});
