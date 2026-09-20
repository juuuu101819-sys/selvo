import { describe, expect, it } from 'vitest';
import { ValidationError } from '../errors/index.js';
import {
  BILLING_LIVE_SCOPE_KEY,
  GO_LIVE_CHECKLIST_CORRIDORS,
  GO_LIVE_CHECKLIST_PATH,
  assertCorridorMayGoLive,
  evaluateEnablementRecord,
  evaluateLiveBilling,
  evaluateLiveFundsMovement,
  parseLegalSignOff,
  requiredChecklistRef,
  regionsForCorridor,
  type LiveEnablementRecord,
} from './live-enablement.js';

const NOW = '2026-03-01T09:00:00.000Z';

function signOffBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    approvedBy: 'counsel@meridian.example',
    licenseBasis: 'KR MSB licence 2026-001; FX (외국환) + AML (특금) + e-finance (전자금융) sign-off',
    approvedAt: '2026-01-15T00:00:00.000Z',
    expiresAt: '2027-01-15T00:00:00.000Z',
    checklistRef: `${GO_LIVE_CHECKLIST_PATH}#usd-krw`,
    ...overrides,
  };
}

function record(overrides: Partial<LiveEnablementRecord> = {}): LiveEnablementRecord {
  return {
    id: 'lve_1',
    scope: 'corridor',
    scopeKey: 'USD|KRW',
    region: 'KR',
    enabled: true,
    signOff: parseLegalSignOff(signOffBody(), { scope: 'corridor', scopeKey: 'USD|KRW', nowIso: NOW }),
    createdAt: NOW,
    updatedAt: NOW,
    disabledAt: null,
    disabledReason: null,
    ...overrides,
  };
}

describe('legal sign-off', () => {
  it('refuses live conversion when sign-off metadata is missing', () => {
    expect(() =>
      parseLegalSignOff(undefined, { scope: 'corridor', scopeKey: 'USD|KRW', nowIso: NOW }),
    ).toThrow(ValidationError);
    expect(() =>
      parseLegalSignOff({}, { scope: 'corridor', scopeKey: 'USD|KRW', nowIso: NOW }),
    ).toThrow(/required/);
  });

  it('refuses a corridor that has no checklist section', () => {
    expect(() => assertCorridorMayGoLive('USD|NGN')).toThrow(/no GO_LIVE_CHECKLIST/);
    expect(assertCorridorMayGoLive('usd|krw')).toBe('USD|KRW');
    expect(GO_LIVE_CHECKLIST_CORRIDORS).toContain('USD|KRW');
  });

  it('requires the exact checklist anchor', () => {
    expect(() =>
      parseLegalSignOff(signOffBody({ checklistRef: 'GO_LIVE_CHECKLIST.md#made-up' }), {
        scope: 'corridor',
        scopeKey: 'USD|KRW',
        nowIso: NOW,
      }),
    ).toThrow(/checklistRef/);
  });

  it('refuses already-expired licence metadata at enable time', () => {
    expect(() =>
      parseLegalSignOff(signOffBody({ expiresAt: '2026-02-01T00:00:00.000Z' }), {
        scope: 'corridor',
        scopeKey: 'USD|KRW',
        nowIso: NOW,
      }),
    ).toThrow(/not in the future/);
  });
});

describe('licence expiry fail-close', () => {
  it('treats a still-enabled row as inactive once expiresAt is reached', () => {
    const enabled = record();
    expect(evaluateEnablementRecord(enabled, NOW).current).toBe(true);
    const expired = evaluateEnablementRecord(enabled, '2027-01-15T00:00:00.000Z');
    expect(expired.current).toBe(false);
    expect(expired.reason).toBe('license_expired');
  });
});

describe('live funds movement evaluation', () => {
  it('never activates live funds movement, even with complete sign-off', () => {
    const evaluation = evaluateLiveFundsMovement({
      nowIso: NOW,
      partnerLiveEnabled: true,
      corridor: 'USD|KRW',
      partnerId: 'example-licensed-partner',
      corridorRecord: record(),
      partnerRecord: record({
        scope: 'partner',
        scopeKey: 'example-licensed-partner',
        signOff: parseLegalSignOff(
          {
            ...signOffBody(),
            checklistRef: requiredChecklistRef('partner', 'example-licensed-partner'),
          },
          { scope: 'partner', scopeKey: 'example-licensed-partner', nowIso: NOW },
        ),
      }),
      engagedRegions: [],
    });
    expect(evaluation.liveFundsMovementActive).toBe(false);
    expect(evaluation.fundsMoved).toBe(false);
    expect(evaluation.sandbox).toBe(true);
    expect(evaluation.corridorSignedOffAndCurrent).toBe(true);
    expect(evaluation.partnerSignedOffAndCurrent).toBe(true);
    expect(evaluation.adaptersImplemented).toBe(false);
    expect(evaluation.blockingReasons).toContain('live_adapters_not_implemented');
  });

  it('fail-closes when a touched region kill switch is engaged', () => {
    const evaluation = evaluateLiveFundsMovement({
      nowIso: NOW,
      partnerLiveEnabled: true,
      corridor: 'USD|KRW',
      partnerId: 'example-licensed-partner',
      corridorRecord: record(),
      partnerRecord: record({
        scope: 'partner',
        scopeKey: 'example-licensed-partner',
        signOff: parseLegalSignOff(
          {
            ...signOffBody(),
            checklistRef: requiredChecklistRef('partner', 'example-licensed-partner'),
          },
          { scope: 'partner', scopeKey: 'example-licensed-partner', nowIso: NOW },
        ),
      }),
      engagedRegions: ['KR'],
    });
    expect(evaluation.regionOpen).toBe(false);
    expect(evaluation.liveFundsMovementActive).toBe(false);
    expect(evaluation.blockingReasons.some((reason) => reason.startsWith('region_kill_switch'))).toBe(
      true,
    );
  });

  it('maps corridor assets to licensing regions', () => {
    expect(regionsForCorridor('USD', 'KRW')).toEqual(['KR', 'US']);
    expect(regionsForCorridor('EUR', 'KRW')).toEqual(['EU', 'KR']);
  });
});

describe('live billing evaluation', () => {
  it('does not collect when BILLING_LIVE_ENABLED is false', () => {
    const evaluation = evaluateLiveBilling({
      nowIso: NOW,
      billingLiveEnabled: false,
      billingRecord: record({
        scope: 'billing',
        scopeKey: BILLING_LIVE_SCOPE_KEY,
        signOff: parseLegalSignOff(
          {
            ...signOffBody(),
            checklistRef: requiredChecklistRef('billing', BILLING_LIVE_SCOPE_KEY),
          },
          { scope: 'billing', scopeKey: BILLING_LIVE_SCOPE_KEY, nowIso: NOW },
        ),
      }),
    });
    expect(evaluation.collectionActive).toBe(false);
    expect(evaluation.collected).toBe(false);
    expect(evaluation.fundsMoved).toBe(false);
    expect(evaluation.blockingReasons).toContain('BILLING_LIVE_ENABLED=false');
  });

  it('still does not collect with a signed-off entity but no processor adapter', () => {
    const evaluation = evaluateLiveBilling({
      nowIso: NOW,
      billingLiveEnabled: true,
      billingRecord: record({
        scope: 'billing',
        scopeKey: BILLING_LIVE_SCOPE_KEY,
        signOff: parseLegalSignOff(
          {
            ...signOffBody(),
            checklistRef: requiredChecklistRef('billing', BILLING_LIVE_SCOPE_KEY),
          },
          { scope: 'billing', scopeKey: BILLING_LIVE_SCOPE_KEY, nowIso: NOW },
        ),
      }),
    });
    // The sign-off record is what attests the entity, tax handling, and processor agreement, so
    // with a current record that fact is satisfied. The adapter is a separate, missing fact.
    expect(evaluation.billingSignedOffAndCurrent).toBe(true);
    expect(evaluation.legalEntityConfirmed).toBe(true);
    expect(evaluation.collectionActive).toBe(false);
    expect(evaluation.collected).toBe(false);
    expect(evaluation.adapterImplemented).toBe(false);
    expect(evaluation.blockingReasons).toContain('collection_adapter_not_implemented');
  });

  it('treats a missing sign-off as an unconfirmed legal entity even with an adapter', () => {
    const evaluation = evaluateLiveBilling({
      nowIso: NOW,
      billingLiveEnabled: true,
      billingRecord: null,
      collectorImplemented: true,
    });
    expect(evaluation.collectionActive).toBe(false);
    expect(evaluation.legalEntityConfirmed).toBe(false);
    expect(evaluation.blockingReasons).toContain('legal_entity_unconfirmed');
    expect(evaluation.blockingReasons).toContain('billing:not_enabled');
  });

  it('opens the gate only when the flag, the sign-off, and the adapter all hold', () => {
    const evaluation = evaluateLiveBilling({
      nowIso: NOW,
      billingLiveEnabled: true,
      billingRecord: record({
        scope: 'billing',
        scopeKey: BILLING_LIVE_SCOPE_KEY,
        signOff: parseLegalSignOff(
          {
            ...signOffBody(),
            checklistRef: requiredChecklistRef('billing', BILLING_LIVE_SCOPE_KEY),
          },
          { scope: 'billing', scopeKey: BILLING_LIVE_SCOPE_KEY, nowIso: NOW },
        ),
      }),
      collectorImplemented: true,
    });
    expect(evaluation.collectionActive).toBe(true);
    expect(evaluation.blockingReasons).toEqual([]);
    // Even an open gate does not itself collect or move funds; it only permits an attempt.
    expect(evaluation.collected).toBe(false);
    expect(evaluation.fundsMoved).toBe(false);
    expect(evaluation.realizedRevenue).toBe(false);
  });
});
