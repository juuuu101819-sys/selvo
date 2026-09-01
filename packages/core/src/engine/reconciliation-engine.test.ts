import { describe, expect, it } from 'vitest';
import type { MonetizationEvent } from '../domain/monetization.js';
import type { OrchestratedExecution } from '../domain/execution-orchestration.js';
import type { StoredPartnerInstruction } from '../ports/execution-partner.js';
import { reconcileExecution } from './reconciliation-engine.js';

function execution(overrides: Partial<OrchestratedExecution> = {}): OrchestratedExecution {
  return {
    id: 'ex_1',
    organizationId: 'org_demo_meridian',
    agentId: 'agt_demo_treasury',
    mandateId: 'mdt_1',
    routingId: 'rte_1',
    routeId: 'route_1',
    partnerId: 'sandbox-partner-psp-fx',
    partnerInstructionId: 'pex_1',
    status: 'SETTLED',
    sourceAsset: 'USD',
    destinationAsset: 'KRW',
    amountMinorUnits: '50000',
    filledMinorUnits: '50000',
    quoteExpiresAt: '2026-03-01T09:02:00.000Z',
    quotedAt: '2026-03-01T09:00:00.000Z',
    dispatchedAt: '2026-03-01T09:00:01.000Z',
    settledAt: '2026-03-01T09:00:02.000Z',
    receiptId: 'rcpt_1',
    beneficiaryRef: 'merchant-x',
    idempotencyKey: null,
    payloadFingerprint: 'fp',
    failureCode: null,
    blockedReason: null,
    dailyLimitReserved: true,
    instructionHash: 'a'.repeat(64),
    signatureHash: 'b'.repeat(64),
    instructionSignatureKind: 'partner_credential_hmac',
    transferSigned: false,
    fundsMoved: false,
    custody: false,
    meridianKeysUsed: false,
    sandbox: true,
    failoverFrom: [],
    monetizationEventId: 'mon_1',
    createdAt: '2026-03-01T09:00:00.000Z',
    updatedAt: '2026-03-01T09:00:02.000Z',
    ...overrides,
  };
}

function partner(overrides: Partial<StoredPartnerInstruction> = {}): StoredPartnerInstruction {
  return {
    id: 'pex_1',
    organizationId: 'org_demo_meridian',
    partnerId: 'sandbox-partner-psp-fx',
    quotedProviderId: 'sandbox-veridian-payments',
    status: 'settled',
    sourceAsset: 'USD',
    destinationAsset: 'KRW',
    amountMinorUnits: '50000',
    filledMinorUnits: '50000',
    instructionHash: 'a'.repeat(64),
    signatureHash: 'b'.repeat(64),
    failureCode: null,
    sandboxScenario: 'settle',
    failoverFrom: [],
    fundsMoved: false,
    custody: false,
    meridianKeysUsed: false,
    sandbox: true,
    createdAt: '2026-03-01T09:00:01.000Z',
    updatedAt: '2026-03-01T09:00:02.000Z',
    metadata: {},
    ...overrides,
  };
}

function monetization(overrides: Partial<MonetizationEvent> = {}): MonetizationEvent {
  return {
    id: 'mon_1',
    organizationId: 'org_demo_meridian',
    occurredAt: '2026-03-01T09:00:02.000Z',
    transactionType: 'multi_rail_quote',
    revenueSource: 'payment_routing_fee',
    rail: 'payment_institution',
    providerId: 'sandbox-veridian-payments',
    providerName: 'Veridian',
    currency: 'USD',
    asset: 'USD',
    destinationAsset: 'KRW',
    agentId: 'agt_demo_treasury',
    tpvMinorUnits: '50000',
    providerCostMinorUnits: '10',
    platformRevenueMinorUnits: '20',
    partnerCommissionMinorUnits: '5',
    grossProfitMinorUnits: '15',
    takeRateBps: '4',
    fundsMoved: false,
    custody: false,
    realExecution: false,
    routeId: 'route_1',
    quoteId: 'route_1',
    economicStage: 'settled',
    realizedRevenue: false,
    revenueRecognition: 'unrealized',
    invoiceId: null,
    ...overrides,
  };
}

describe('reconcileExecution', () => {
  it('accepts a matching dispatched instruction, partner confirmation, and fee snapshot', () => {
    expect(
      reconcileExecution({
        execution: execution(),
        partner: partner(),
        monetization: monetization(),
      }),
    ).toEqual([]);
  });

  it('flags an instruction-hash mismatch between the execution and the partner confirmation', () => {
    const mismatches = reconcileExecution({
      execution: execution(),
      partner: partner({ instructionHash: 'c'.repeat(64) }),
      monetization: monetization(),
    });
    expect(mismatches.map((row) => row.kind)).toContain('instruction_hash_mismatch');
    expect(mismatches.every((row) => row.fundsMoved === false)).toBe(true);
  });

  it('flags missing partner confirmation and fee TPV disagreement', () => {
    expect(
      reconcileExecution({
        execution: execution(),
        partner: null,
        monetization: monetization(),
      }).map((row) => row.kind),
    ).toContain('missing_partner_confirmation');
    expect(
      reconcileExecution({
        execution: execution(),
        partner: partner(),
        monetization: monetization({ tpvMinorUnits: '1' }),
      }).map((row) => row.kind),
    ).toContain('fee_tpv_mismatch');
  });
});
