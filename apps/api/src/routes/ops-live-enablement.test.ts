import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { provisionDemoTenants } from '../auth/provision-demo.js';
import { API_V1_PREFIX } from './index.js';
import { createTestHarness, type TestHarness } from '../testing/harness.js';

const OPERATOR = 'unit-test-live-enablement-operator-secret-ok';
const OPERATOR_HEADER = { 'x-onboarding-operator-key': OPERATOR };
const PREVIOUS_OPERATOR_SECRET = process.env['ONBOARDING_OPERATOR_SECRET'];

const USD_KRW_SIGNOFF = {
  approvedBy: 'counsel@meridian.example',
  licenseBasis:
    'KR foreign-exchange (외국환) + Specified Financial Information Act (특금) + Electronic Financial Transactions Act (전자금융) opinion 2026-01; US MSB not relied upon',
  approvedAt: '2026-01-15T00:00:00.000Z',
  expiresAt: '2027-01-15T00:00:00.000Z',
  checklistRef: 'GO_LIVE_CHECKLIST.md#usd-krw',
};

describe('live enablement and billing live gates', () => {
  let harness: TestHarness;

  beforeAll(async () => {
    process.env['ONBOARDING_OPERATOR_SECRET'] = OPERATOR;
    harness = await createTestHarness({ ONBOARDING_OPERATOR_SECRET: OPERATOR });
    await provisionDemoTenants({
      identity: harness.container.persistence.identity,
      dashboard: harness.container.persistence.dashboard,
    });
  });

  afterAll(async () => {
    await harness.close();
    if (PREVIOUS_OPERATOR_SECRET === undefined) {
      delete process.env['ONBOARDING_OPERATOR_SECRET'];
    } else {
      process.env['ONBOARDING_OPERATOR_SECRET'] = PREVIOUS_OPERATOR_SECRET;
    }
  });

  it('refuses live conversion without legal sign-off metadata and audits the refusal', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/ops/live-enablement`,
      headers: OPERATOR_HEADER,
      payload: {
        scope: 'corridor',
        scopeKey: 'USD|KRW',
        region: 'KR',
      },
    });
    expect(response.statusCode).toBe(400);

    const emptySignOff = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/ops/live-enablement`,
      headers: OPERATOR_HEADER,
      payload: {
        scope: 'corridor',
        scopeKey: 'USD|KRW',
        region: 'KR',
        signOff: {},
      },
    });
    expect(emptySignOff.statusCode).toBe(400);
    expect(emptySignOff.json<{ error: { message: string } }>().error.message).toMatch(/sign-off/i);

    const listed = await harness.app.inject({
      method: 'GET',
      url: `${API_V1_PREFIX}/ops/live-enablement`,
      headers: OPERATOR_HEADER,
    });
    expect(listed.statusCode).toBe(200);
    const body = listed.json<{
      data: { records: { enabled: boolean; scopeKey: string }[]; partnerLiveEnabled: boolean };
    }>().data;
    expect(body.partnerLiveEnabled).toBe(false);
    expect(body.records.some((row) => row.scopeKey === 'USD|KRW' && row.enabled)).toBe(false);

    const events = await harness.auditEvents();
    expect(events.some((event) => event.type === 'live_enablement.refused')).toBe(true);
    expect(events.some((event) => event.type === 'live_enablement.enabled')).toBe(false);
  });

  it('records sign-off but still keeps live funds movement inactive', async () => {
    const enabled = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/ops/live-enablement`,
      headers: OPERATOR_HEADER,
      payload: {
        scope: 'corridor',
        scopeKey: 'USD|KRW',
        region: 'KR',
        signOff: USD_KRW_SIGNOFF,
      },
    });
    expect(enabled.statusCode).toBe(200);
    const payload = enabled.json<{
      data: { liveFundsMovementActive: boolean; sandbox: boolean; record: { enabled: boolean } };
    }>().data;
    expect(payload.record.enabled).toBe(true);
    expect(payload.liveFundsMovementActive).toBe(false);
    expect(payload.sandbox).toBe(true);

    const partner = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/ops/live-enablement`,
      headers: OPERATOR_HEADER,
      payload: {
        scope: 'partner',
        scopeKey: 'example-licensed-partner',
        region: 'KR',
        signOff: {
          ...USD_KRW_SIGNOFF,
          checklistRef: 'GO_LIVE_CHECKLIST.md#partners',
        },
      },
    });
    expect(partner.statusCode).toBe(200);

    const evaluation = await harness.app.inject({
      method: 'GET',
      url: `${API_V1_PREFIX}/ops/live-enablement/evaluate?sourceAsset=USD&destinationAsset=KRW&partnerId=example-licensed-partner`,
      headers: OPERATOR_HEADER,
    });
    expect(evaluation.statusCode).toBe(200);
    const funds = evaluation.json<{
      data: {
        funds: {
          liveFundsMovementActive: boolean;
          fundsMoved: boolean;
          corridorSignedOffAndCurrent: boolean;
          partnerSignedOffAndCurrent: boolean;
          blockingReasons: string[];
        };
      };
    }>().data.funds;
    expect(funds.liveFundsMovementActive).toBe(false);
    expect(funds.fundsMoved).toBe(false);
    expect(funds.corridorSignedOffAndCurrent).toBe(true);
    expect(funds.partnerSignedOffAndCurrent).toBe(true);
    expect(funds.blockingReasons).toContain('PARTNER_LIVE_ENABLED=false');
    expect(funds.blockingReasons).toContain('live_adapters_not_implemented');
  });

  it('fail-closes automatically when partner licence metadata expires', async () => {
    const rewindMs = 400 * 24 * 60 * 60 * 1000;
    harness.clock.advance(rewindMs);
    try {
      const evaluation = await harness.app.inject({
        method: 'GET',
        url: `${API_V1_PREFIX}/ops/live-enablement/evaluate?sourceAsset=USD&destinationAsset=KRW&partnerId=example-licensed-partner`,
        headers: OPERATOR_HEADER,
      });
      const funds = evaluation.json<{
        data: {
          funds: {
            liveFundsMovementActive: boolean;
            corridorSignedOffAndCurrent: boolean;
            partnerSignedOffAndCurrent: boolean;
            blockingReasons: string[];
          };
        };
      }>().data.funds;
      expect(funds.liveFundsMovementActive).toBe(false);
      expect(funds.corridorSignedOffAndCurrent).toBe(false);
      expect(funds.partnerSignedOffAndCurrent).toBe(false);
      expect(funds.blockingReasons.some((reason) => reason.includes('license_expired'))).toBe(true);
    } finally {
      harness.clock.advance(-rewindMs);
    }
  });

  it('fail-closes the corridor when the region kill switch is engaged', async () => {
    const killed = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/ops/routing/overrides`,
      headers: OPERATOR_HEADER,
      payload: {
        target: { kind: 'region', region: 'KR' },
        reason: 'KR licensing incident — fail-close live corridors',
      },
    });
    expect(killed.statusCode).toBe(200);

    const evaluation = await harness.app.inject({
      method: 'GET',
      url: `${API_V1_PREFIX}/ops/live-enablement/evaluate?sourceAsset=USD&destinationAsset=KRW&partnerId=example-licensed-partner`,
      headers: OPERATOR_HEADER,
    });
    const funds = evaluation.json<{
      data: { funds: { regionOpen: boolean; liveFundsMovementActive: boolean; blockingReasons: string[] } };
    }>().data.funds;
    expect(funds.regionOpen).toBe(false);
    expect(funds.liveFundsMovementActive).toBe(false);
    expect(funds.blockingReasons.some((reason) => reason.startsWith('region_kill_switch'))).toBe(true);

    await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/ops/routing/overrides/release`,
      headers: OPERATOR_HEADER,
      payload: {
        target: { kind: 'region', region: 'KR' },
        reason: 'test cleanup',
      },
    });
  });

  it('does not collect when BILLING_LIVE_ENABLED is false', async () => {
    expect(harness.config.billingLiveEnabled).toBe(false);
    const collect = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/ops/billing/collect`,
      headers: OPERATOR_HEADER,
      payload: {},
    });
    expect(collect.statusCode).toBe(403);
    const error = collect.json<{
      error: { details: { collected: boolean; fundsMoved: boolean; reasons: string[] } };
    }>().error.details;
    expect(error.collected).toBe(false);
    expect(error.fundsMoved).toBe(false);
    expect(error.reasons).toContain('BILLING_LIVE_ENABLED=false');

    const subscriptions = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/ops/billing/subscriptions/run`,
      headers: OPERATOR_HEADER,
    });
    expect(subscriptions.statusCode).toBe(403);
    expect(
      subscriptions.json<{ error: { details: { subscriptionsCharged: number } } }>().error.details
        .subscriptionsCharged,
    ).toBe(0);

    const payouts = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/ops/billing/partner-payouts/run`,
      headers: OPERATOR_HEADER,
    });
    expect(payouts.statusCode).toBe(403);
    const payoutDetails = payouts.json<{
      error: { details: { payoutsDisbursed: number; payableRowsCreated: number; fundsMoved: boolean } };
    }>().error.details;
    expect(payoutDetails.payoutsDisbursed).toBe(0);
    expect(payoutDetails.payableRowsCreated).toBe(0);
    expect(payoutDetails.fundsMoved).toBe(false);

    const events = await harness.auditEvents();
    expect(events.some((event) => event.type === 'billing.collection.refused')).toBe(true);
    expect(events.some((event) => event.type === 'billing.subscription.refused')).toBe(true);
    expect(events.some((event) => event.type === 'billing.partner_payout.refused')).toBe(true);
  });

  it('refuses a corridor that has no GO_LIVE_CHECKLIST.md section', async () => {
    const response = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/ops/live-enablement`,
      headers: OPERATOR_HEADER,
      payload: {
        scope: 'corridor',
        scopeKey: 'USD|NGN',
        region: 'NG',
        signOff: {
          ...USD_KRW_SIGNOFF,
          checklistRef: 'GO_LIVE_CHECKLIST.md#usd-ngn',
        },
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ error: { message: string } }>().error.message).toMatch(/checklist/i);
  });
});

describe('BILLING_LIVE_ENABLED=true still does not collect without a legal entity and adapter', () => {
  let harness: TestHarness;

  beforeAll(async () => {
    process.env['ONBOARDING_OPERATOR_SECRET'] = OPERATOR;
    harness = await createTestHarness({
      ONBOARDING_OPERATOR_SECRET: OPERATOR,
      BILLING_LIVE_ENABLED: 'true',
      // The flag can no longer be flipped without a referenced determination (§18.4). Supplying
      // one is what makes this test interesting: the config gate is satisfied and collection is
      // still refused, because the LiveEnablement row and the processor contract are missing.
      BILLING_LEGAL_OPINION_ID: 'OPN-BILLING-TEST',
      BILLING_JURISDICTION: 'US',
    });
  });

  afterAll(async () => {
    await harness.close();
    if (PREVIOUS_OPERATOR_SECRET === undefined) {
      delete process.env['ONBOARDING_OPERATOR_SECRET'];
    } else {
      process.env['ONBOARDING_OPERATOR_SECRET'] = PREVIOUS_OPERATOR_SECRET;
    }
  });

  it('keeps invoices uncollected even when the process flag is on', async () => {
    expect(harness.config.billingLiveEnabled).toBe(true);
    const collect = await harness.app.inject({
      method: 'POST',
      url: `${API_V1_PREFIX}/ops/billing/collect`,
      headers: OPERATOR_HEADER,
    });
    expect(collect.statusCode).toBe(403);
    const details = collect.json<{
      error: { details: { collected: boolean; reasons: string[] } };
    }>().error.details;
    expect(details.collected).toBe(false);
    expect(details.reasons).toContain('legal_entity_unconfirmed');
    expect(details.reasons).toContain('collection_adapter_not_implemented');
  });
});
