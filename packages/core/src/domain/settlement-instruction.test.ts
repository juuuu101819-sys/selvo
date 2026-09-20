import { describe, expect, it } from 'vitest';
import {
  BOUNDARY_MODES,
  DISPATCH_SUGGESTING_TOKENS,
  FORBIDDEN_SETTLEMENT_INSTRUCTION_KEYS,
  MERIDIAN_SIGNATURE_ATTESTS,
  MERIDIAN_SIGNATURE_DOES_NOT_ATTEST,
  SETTLEMENT_INSTRUCTION_PAYLOAD_KEYS,
  SETTLEMENT_INSTRUCTION_PURPOSE,
  SETTLEMENT_INSTRUCTION_VERSION,
  assertBoundaryModeNeverDispatches,
  assertInstructionPayloadShape,
  instructionFreshness,
  isBoundaryMode,
  type SettlementInstructionPayload,
} from './settlement-instruction.js';

function payload(
  overrides: Partial<SettlementInstructionPayload> = {},
): SettlementInstructionPayload {
  return {
    instructionVersion: SETTLEMENT_INSTRUCTION_VERSION,
    purpose: SETTLEMENT_INSTRUCTION_PURPOSE,
    instructionId: 'msi_1',
    organizationId: 'org_1',
    boundaryMode: 'RETURN_TO_CUSTOMER',
    originEnv: 'PRODUCTION',
    createdAt: '2026-03-01T09:00:00.000Z',
    expiresAt: '2026-03-01T09:15:00.000Z',
    quoteExpiresAt: '2026-03-01T09:10:00.000Z',
    route: {
      routingId: 'rte_1',
      routeId: 'route_1',
      providerId: 'prv_1',
      providerName: 'Northgate Bank',
      providerLicensing: 'licensed_partner',
      rail: 'bank_fx',
      railFamily: 'fiat',
      category: 'bank',
      conversionKind: 'fiat_to_fiat',
      legs: [{ sequence: 1, hop: 'USD->KRW' }],
      sourceAsset: 'USD',
      destinationAsset: 'KRW',
      sendMinorUnits: '50000',
      sendExponent: 2,
      deliveredMinorUnits: '66000000',
      deliveredExponent: 0,
      indicatedRate: '1320.5',
      effectiveRate: '1318.2',
      recommended: true,
      rank: 1,
      competingRouteCount: 4,
      bestExecutionRationaleHash: 'a'.repeat(64),
    },
    costs: {
      totalCostMinorUnits: '1250',
      totalCostAsset: 'USD',
      totalCostBps: '25',
      providerFeeMinorUnits: '1000',
      platformFeeMinorUnits: '250',
      networkFeeMinorUnits: '0',
      spreadBps: '12',
      slippageBps: '3',
    },
    authorization: {
      paymentIntentId: 'pay_1',
      executionIntentId: 'eit_1',
      policyEvaluated: true,
    },
    compliance: {
      eligible: true,
      kycRequired: true,
      sanctionsScreeningRequired: true,
      licensing: 'licensed_partner',
      jurisdictions: ['US', 'KR'],
      notes: 'Eligibility only.',
    },
    signatureAttests: MERIDIAN_SIGNATURE_ATTESTS,
    signatureDoesNotAttest: MERIDIAN_SIGNATURE_DOES_NOT_ATTEST,
    meridianTransmits: false,
    meridianIsPayer: false,
    fundsMoved: false,
    custody: false,
    transferSigned: false,
    meridianKeysUsed: false,
    ...overrides,
  };
}

describe('boundary modes', () => {
  /**
   * The vocabulary is the invariant.
   *
   * Pattern C is kept out of the system by not having a word for it: if no boundary mode means
   * "Meridian sends it", no configuration, database row, or future handler can put an instruction
   * into that state. These tests guard the vocabulary, not a code path.
   */

  it('offers only modes in which someone other than Meridian acts', () => {
    expect([...BOUNDARY_MODES]).toEqual(['RETURN_TO_CUSTOMER', 'PARTNER_EXECUTES']);
  });

  it('contains no mode that could be read as Meridian dispatching', () => {
    for (const mode of BOUNDARY_MODES) {
      for (const token of DISPATCH_SUGGESTING_TOKENS) {
        expect(mode.toUpperCase(), `${mode} suggests dispatch`).not.toContain(token);
      }
    }
  });

  it('rejects a dispatch-shaped mode even if one were introduced', () => {
    // Defence behind the type: a value arriving from a database row or an older client is checked
    // rather than assumed, and the failure names the reason rather than just "invalid".
    expect(() => assertBoundaryModeNeverDispatches('MERIDIAN_EXECUTES')).toThrow(/never dispatches/);
    expect(() => assertBoundaryModeNeverDispatches('DISPATCH_TO_PARTNER')).toThrow(
      /never dispatches/,
    );
    expect(() => assertBoundaryModeNeverDispatches('SOMETHING_ELSE')).toThrow(/Unknown boundary/);
  });

  it('accepts the two real modes', () => {
    for (const mode of BOUNDARY_MODES) {
      expect(() => assertBoundaryModeNeverDispatches(mode)).not.toThrow();
      expect(isBoundaryMode(mode)).toBe(true);
    }
    expect(isBoundaryMode('DISPATCH')).toBe(false);
  });
});

describe('signed payload shape', () => {
  it('accepts a well-formed payload', () => {
    expect(() => assertInstructionPayloadShape(payload())).not.toThrow();
  });

  it('refuses to sign a payload missing a version-1 field', () => {
    const { costs: _costs, ...incomplete } = payload();
    expect(() =>
      assertInstructionPayloadShape(incomplete as unknown as SettlementInstructionPayload),
    ).toThrow(/field set/);
  });

  it('refuses to sign a payload carrying an unexpected field', () => {
    // A widened signed shape means a verifier pinned to version 1 starts failing for reasons
    // unrelated to tampering, so growing the payload has to be a deliberate version bump.
    const widened = { ...payload(), settlementDeadline: '2026-04-01T00:00:00.000Z' };
    expect(() =>
      assertInstructionPayloadShape(widened as unknown as SettlementInstructionPayload),
    ).toThrow(/instructionVersion/);
  });

  it('keeps the declared key list in step with the interface', () => {
    expect([...SETTLEMENT_INSTRUCTION_PAYLOAD_KEYS]).toEqual(Object.keys(payload()).sort());
  });

  it.each([...FORBIDDEN_SETTLEMENT_INSTRUCTION_KEYS])(
    'refuses to sign a payload leaking %s',
    (forbidden) => {
      const leaking = {
        ...payload(),
        compliance: { ...payload().compliance, [forbidden]: 'leaked-value' },
      };
      expect(() =>
        assertInstructionPayloadShape(leaking as unknown as SettlementInstructionPayload),
      ).toThrow(new RegExp(forbidden));
    },
  );

  it('refuses a payload claiming anything custodial', () => {
    for (const claim of [
      { meridianTransmits: true },
      { meridianIsPayer: true },
      { fundsMoved: true },
      { custody: true },
      { transferSigned: true },
      { meridianKeysUsed: true },
    ]) {
      expect(() => assertInstructionPayloadShape(payload(claim))).toThrow(/non-custodial/);
    }
  });

  it('refuses a payload that misstates or drops what the signature means', () => {
    // The disclaimer is inside the signed bytes precisely so it cannot be separated from the
    // artifact. Signing a payload that softened it would defeat the point.
    expect(() =>
      assertInstructionPayloadShape(
        payload({
          signatureAttests: 'Meridian authorizes this payment.' as typeof MERIDIAN_SIGNATURE_ATTESTS,
        }),
      ),
    ).toThrow(/misstates/);
    expect(() =>
      assertInstructionPayloadShape(
        payload({
          signatureDoesNotAttest: '' as typeof MERIDIAN_SIGNATURE_DOES_NOT_ATTEST,
        }),
      ),
    ).toThrow(/disclaimer/);
  });

  it('states inside the signature that it is not a payment authorization', () => {
    expect(MERIDIAN_SIGNATURE_DOES_NOT_ATTEST).toContain('not a payment authorization');
    expect(MERIDIAN_SIGNATURE_DOES_NOT_ATTEST).toContain('does not authorize');
    expect(MERIDIAN_SIGNATURE_ATTESTS).toContain('recommendation');
  });
});

describe('freshness', () => {
  it('is usable before either deadline', () => {
    expect(
      instructionFreshness({ expiresAt: '2026-03-01T09:15:00.000Z', payload: payload() }, '2026-03-01T09:05:00.000Z'),
    ).toEqual({ usable: true, reason: null });
  });

  it('is unusable once the instruction expires', () => {
    expect(
      instructionFreshness({ expiresAt: '2026-03-01T09:15:00.000Z', payload: payload() }, '2026-03-01T09:20:00.000Z'),
    ).toEqual({ usable: false, reason: 'expired' });
  });

  it('is unusable once the quote behind it goes stale, even if the instruction has not expired', () => {
    // The quote is the reason the numbers are true. An instruction that outlives it carries a
    // price no provider will honour, with a signature that makes it look current.
    expect(
      instructionFreshness(
        {
          expiresAt: '2026-03-01T23:00:00.000Z',
          payload: payload({ quoteExpiresAt: '2026-03-01T09:10:00.000Z' }),
        },
        '2026-03-01T09:11:00.000Z',
      ),
    ).toEqual({ usable: false, reason: 'quote_stale' });
  });
});
