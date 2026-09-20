import { describe, expect, it } from 'vitest';
import { ValidationError } from '../errors/index.js';
import {
  BILLING_LIVE_SCOPE_KEY,
  requiredChecklistRef,
  type LiveEnablementRecord,
  type LiveEnablementScope,
} from './live-enablement.js';
import type { PlatformMode } from './provider.js';
import {
  HIGH_RISK_PRICING_SHAPES,
  NO_PRICING_SHAPES_ACTIVE,
  PRICING_SHAPES,
  PRICING_SHAPE_ENABLEMENT_SCOPE,
  assertPricingShapeAdmissionSafe,
  evaluatePricingShapeAdmission,
  flagNameFor,
  simulationPricingShapeAdmission,
  type PricingLegalOpinionRefs,
  type PricingShape,
  type PricingShapeFlags,
} from './pricing-shape.js';

const NOW = '2026-06-01T00:00:00.000Z';
const OPINION_ID = 'OPN-AD-VALOREM-2026-04';

/** Launch defaults from §18.3: the size-independent shape on, every other shape off. */
const LAUNCH_FLAGS: PricingShapeFlags = {
  flat_txn: true,
  tiered_txn: false,
  ad_valorem: false,
  gain_share: false,
  tpv: false,
};

function flags(overrides: Partial<PricingShapeFlags> = {}): PricingShapeFlags {
  return { ...LAUNCH_FLAGS, ...overrides };
}

function determination(
  scope: LiveEnablementScope,
  overrides: {
    readonly licenseBasis?: string;
    readonly region?: string;
    readonly enabled?: boolean;
    readonly expiresAt?: string;
  } = {},
): LiveEnablementRecord {
  return {
    id: `lve_${scope}`,
    scope,
    scopeKey: BILLING_LIVE_SCOPE_KEY,
    region: overrides.region ?? 'US',
    enabled: overrides.enabled ?? true,
    signOff: {
      approvedBy: 'counsel@selvo.example',
      licenseBasis: overrides.licenseBasis ?? `Written determination ${OPINION_ID} (US)`,
      approvedAt: '2026-04-01T00:00:00.000Z',
      expiresAt: overrides.expiresAt ?? '2027-04-01T00:00:00.000Z',
      checklistRef: requiredChecklistRef(scope, BILLING_LIVE_SCOPE_KEY),
    },
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
    disabledAt: null,
    disabledReason: null,
  };
}

function admit(input: {
  readonly mode: PlatformMode;
  readonly flags?: PricingShapeFlags;
  readonly legalOpinions?: PricingLegalOpinionRefs;
  readonly records?: readonly LiveEnablementRecord[];
  readonly nowIso?: string;
}) {
  const enablementRecords: Partial<Record<LiveEnablementScope, LiveEnablementRecord>> = {};
  for (const record of input.records ?? []) {
    enablementRecords[record.scope] = record;
  }
  return evaluatePricingShapeAdmission({
    mode: input.mode,
    flags: input.flags ?? LAUNCH_FLAGS,
    legalOpinions: input.legalOpinions ?? {},
    enablementRecords,
    nowIso: input.nowIso ?? NOW,
  });
}

describe('§18.3 launch defaults', () => {
  it('admits only the size-independent shape in production', () => {
    const admission = admit({ mode: 'production' });
    expect(admission.activeShapes).toEqual(['flat_txn']);
    for (const shape of ['tiered_txn', 'ad_valorem', 'gain_share', 'tpv'] as const) {
      expect(admission.decisions[shape].blockingReasons).toContain(`${flagNameFor(shape)}=false`);
    }
  });

  it('does not require a determination for the low-risk shapes', () => {
    // flat and tiered are fixed amounts per decision, so there is nothing for an opinion to
    // characterise. Requiring a document for them would make the gate noise rather than signal.
    const admission = admit({
      mode: 'production',
      flags: flags({ tiered_txn: true }),
    });
    expect(admission.isActive('flat_txn')).toBe(true);
    expect(admission.isActive('tiered_txn')).toBe(true);
    expect(PRICING_SHAPE_ENABLEMENT_SCOPE.flat_txn).toBeNull();
    expect(PRICING_SHAPE_ENABLEMENT_SCOPE.tiered_txn).toBeNull();
  });

  it('follows flags alone outside production so revenue models can be simulated', () => {
    const admission = admit({
      mode: 'sandbox',
      flags: Object.fromEntries(
        PRICING_SHAPES.map((shape) => [shape, true]),
      ) as unknown as PricingShapeFlags,
    });
    expect(admission.activeShapes).toEqual([...PRICING_SHAPES]);
  });

  it('closes every shape when configuration is unavailable', () => {
    expect(NO_PRICING_SHAPES_ACTIVE.activeShapes).toEqual([]);
    for (const shape of PRICING_SHAPES) {
      expect(NO_PRICING_SHAPES_ACTIVE.isActive(shape)).toBe(false);
      expect(NO_PRICING_SHAPES_ACTIVE.decisions[shape].blockingReasons).toContain(
        'pricing_configuration_unavailable',
      );
    }
  });
});

describe('§18.4 a high-risk shape needs a document, not a flag', () => {
  it('refuses a flipped flag with no referenced opinion and no recorded row', () => {
    const admission = admit({ mode: 'production', flags: flags({ ad_valorem: true }) });
    const decision = admission.decisions.ad_valorem;
    expect(decision.flagEnabled).toBe(true);
    expect(decision.active).toBe(false);
    expect(decision.blockingReasons).toContain('legal_opinion_not_referenced');
    expect(decision.blockingReasons).toContain('pricing_ad_valorem:not_enabled');
  });

  it('refuses a referenced opinion that has no recorded determination behind it', () => {
    // The config half of the gate is satisfied and the shape is still closed: an id in an env var
    // is a claim, and the LiveEnablement row is the record of someone having made the call.
    const admission = admit({
      mode: 'production',
      flags: flags({ ad_valorem: true }),
      legalOpinions: { ad_valorem: { legalOpinionId: OPINION_ID, jurisdiction: 'US' } },
    });
    expect(admission.decisions.ad_valorem.active).toBe(false);
    expect(admission.decisions.ad_valorem.blockingReasons).toEqual([
      'pricing_ad_valorem:not_enabled',
    ]);
  });

  it('admits the shape once the flag, the opinion, and the row agree', () => {
    const admission = admit({
      mode: 'production',
      flags: flags({ ad_valorem: true }),
      legalOpinions: { ad_valorem: { legalOpinionId: OPINION_ID, jurisdiction: 'US' } },
      records: [determination('pricing_ad_valorem')],
    });
    expect(admission.decisions.ad_valorem.active).toBe(true);
    expect(admission.decisions.ad_valorem.blockingReasons).toEqual([]);
    expect(admission.activeShapes).toEqual(['flat_txn', 'ad_valorem']);
  });

  it('refuses a row whose license basis names a different opinion', () => {
    const admission = admit({
      mode: 'production',
      flags: flags({ ad_valorem: true }),
      legalOpinions: { ad_valorem: { legalOpinionId: OPINION_ID, jurisdiction: 'US' } },
      records: [
        determination('pricing_ad_valorem', {
          licenseBasis: 'Written determination OPN-SOMETHING-ELSE (US)',
        }),
      ],
    });
    expect(admission.decisions.ad_valorem.blockingReasons).toContain('legal_opinion_id_mismatch');
  });

  it('refuses a determination written for another jurisdiction', () => {
    const admission = admit({
      mode: 'production',
      flags: flags({ ad_valorem: true }),
      legalOpinions: { ad_valorem: { legalOpinionId: OPINION_ID, jurisdiction: 'US' } },
      records: [determination('pricing_ad_valorem', { region: 'KR' })],
    });
    expect(admission.decisions.ad_valorem.blockingReasons).toContain(
      'legal_opinion_jurisdiction_mismatch',
    );
  });

  it('closes the shape at the instant the determination expires', () => {
    const base = {
      mode: 'production' as const,
      flags: flags({ ad_valorem: true }),
      legalOpinions: { ad_valorem: { legalOpinionId: OPINION_ID, jurisdiction: 'US' } },
      records: [determination('pricing_ad_valorem', { expiresAt: '2026-07-01T00:00:00.000Z' })],
    };
    expect(admit({ ...base, nowIso: '2026-06-30T23:59:59.999Z' }).isActive('ad_valorem')).toBe(true);
    const lapsed = admit({ ...base, nowIso: '2026-07-01T00:00:00.000Z' });
    expect(lapsed.isActive('ad_valorem')).toBe(false);
    expect(lapsed.decisions.ad_valorem.blockingReasons).toContain(
      'pricing_ad_valorem:license_expired',
    );
  });

  it('closes the shape when the determination is withdrawn', () => {
    const admission = admit({
      mode: 'production',
      flags: flags({ ad_valorem: true }),
      legalOpinions: { ad_valorem: { legalOpinionId: OPINION_ID, jurisdiction: 'US' } },
      records: [determination('pricing_ad_valorem', { enabled: false })],
    });
    expect(admission.decisions.ad_valorem.blockingReasons).toContain(
      'pricing_ad_valorem:not_enabled',
    );
  });

  it('does not let one activity’s determination authorize another', () => {
    // A gain-share row is a determination about sharing in the customer's outcome. It says nothing
    // about charging a percentage of notional, so it must not open ad valorem.
    const admission = admit({
      mode: 'production',
      flags: flags({ ad_valorem: true, gain_share: true }),
      legalOpinions: {
        ad_valorem: { legalOpinionId: OPINION_ID, jurisdiction: 'US' },
        gain_share: { legalOpinionId: OPINION_ID, jurisdiction: 'US' },
      },
      records: [determination('pricing_gain_share')],
    });
    expect(admission.isActive('gain_share')).toBe(true);
    expect(admission.isActive('ad_valorem')).toBe(false);
    expect(admission.decisions.ad_valorem.blockingReasons).toContain(
      'pricing_ad_valorem:not_enabled',
    );
  });

  it('does not let a live-execution determination authorize a pricing shape', () => {
    const admission = admit({
      mode: 'production',
      flags: flags({ tpv: true }),
      legalOpinions: { tpv: { legalOpinionId: OPINION_ID, jurisdiction: 'US' } },
      records: [determination('corridor'), determination('partner'), determination('billing')],
    });
    expect(admission.isActive('tpv')).toBe(false);
    expect(admission.decisions.tpv.blockingReasons).toContain('pricing_tpv:not_enabled');
  });
});

describe('assertPricingShapeAdmissionSafe refuses to boot a misconfigured production process', () => {
  it('throws when a high-risk flag is on without a current determination', () => {
    for (const shape of HIGH_RISK_PRICING_SHAPES) {
      const admission = admit({
        mode: 'production',
        flags: flags({ [shape]: true }),
        legalOpinions: { [shape]: { legalOpinionId: OPINION_ID, jurisdiction: 'US' } },
      });
      expect(() => assertPricingShapeAdmissionSafe(admission), shape).toThrow(ValidationError);
      expect(() => assertPricingShapeAdmissionSafe(admission), shape).toThrow(
        /high-risk pricing shape is enabled in production/,
      );
    }
  });

  it('names the offending shape and why it is closed', () => {
    const admission = admit({ mode: 'production', flags: flags({ gain_share: true }) });
    try {
      assertPricingShapeAdmissionSafe(admission);
      throw new Error('expected a refusal');
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      const details = (error as ValidationError).details as {
        shapes: readonly { shape: PricingShape; flag: string; blockingReasons: string[] }[];
      };
      expect(details.shapes).toHaveLength(1);
      expect(details.shapes[0]?.shape).toBe('gain_share');
      expect(details.shapes[0]?.flag).toBe('GAIN_SHARE_ENABLED');
      expect(details.shapes[0]?.blockingReasons).toContain('legal_opinion_not_referenced');
    }
  });

  it('boots the launch configuration', () => {
    expect(() => assertPricingShapeAdmissionSafe(admit({ mode: 'production' }))).not.toThrow();
  });

  it('boots a production process whose high-risk shape is fully documented', () => {
    const admission = admit({
      mode: 'production',
      flags: flags({ gain_share: true }),
      legalOpinions: { gain_share: { legalOpinionId: OPINION_ID, jurisdiction: 'US' } },
      records: [determination('pricing_gain_share')],
    });
    expect(() => assertPricingShapeAdmissionSafe(admission)).not.toThrow();
  });

  it('does not police non-production processes, where all five shapes may run', () => {
    expect(() =>
      assertPricingShapeAdmissionSafe(simulationPricingShapeAdmission()),
    ).not.toThrow();
    expect(simulationPricingShapeAdmission().mode).toBe('sandbox');
  });
});
