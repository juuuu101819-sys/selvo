import { describe, expect, it } from 'vitest';
import {
  FORBIDDEN_INSTRUCTION_PAYLOAD_KEYS,
  PARTNER_INSTRUCTION_PAYLOAD_KEYS,
  assertNonCustodialExecution,
  type OrchestratedExecution,
} from '../domain/execution-orchestration.js';
import {
  assertInstructionPayloadKeys,
  partnerInstructionHmacPayload,
  signPartnerInstructionHmac,
} from '../engine/instruction-hmac.js';

function row(overrides: Partial<OrchestratedExecution> = {}): OrchestratedExecution {
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
    idempotencyKey: 'idem-exec-1',
    payloadFingerprint: 'abc',
    failureCode: null,
    blockedReason: null,
    dailyLimitReserved: true,
    instructionHash: 'h'.repeat(64),
    signatureHash: 's'.repeat(64),
    instructionSignatureKind: 'partner_credential_hmac',
    transferSigned: false,
    fundsMoved: false,
    custody: false,
    meridianKeysUsed: false,
    sandbox: true,
    failoverFrom: [],
    monetizationEventId: 'mon_1',
    createdAt: '2026-03-01T09:00:00.000Z',
    updatedAt: '2026-03-01T09:00:00.000Z',
    ...overrides,
  };
}

describe('non-custodial orchestrated execution', () => {
  it('admits every lifecycle status only when funds, custody, keys, and transfers stay false', () => {
    const statuses = [
      'CREATED',
      'ROUTED',
      'COMPLIANCE_PASSED',
      'COMPLIANCE_REVIEW',
      'BLOCKED',
      'EXPIRED',
      'DISPATCHED',
      'SETTLING',
      'SETTLED',
      'FAILED',
    ] as const;
    for (const status of statuses) {
      expect(() => assertNonCustodialExecution(row({ status }))).not.toThrow();
    }
  });

  it('rejects a row that claims funds moved or a transfer signature', () => {
    expect(() =>
      assertNonCustodialExecution(row({ fundsMoved: true as unknown as false })),
    ).toThrow(/non-custodial/);
    expect(() =>
      assertNonCustodialExecution(row({ transferSigned: true as unknown as false })),
    ).toThrow(/funds transfer/);
  });

  it('HMACs an instruction envelope that cannot name accounts, wallets, or keys', () => {
    const payload = partnerInstructionHmacPayload({
      quoteReference: 'rte_1',
      sourceAsset: 'USD',
      destinationAsset: 'KRW',
      amountMinorUnits: '50000',
      beneficiaryRef: 'merchant-x',
      signedAt: '2026-03-01T09:00:00.000Z',
      sandboxScenario: 'settle',
    });
    expect(payload.purpose).toBe('partner_instruction');
    expect(Object.keys(payload).sort()).toEqual([...PARTNER_INSTRUCTION_PAYLOAD_KEYS].sort());
    for (const forbidden of FORBIDDEN_INSTRUCTION_PAYLOAD_KEYS) {
      expect(payload).not.toHaveProperty(forbidden);
    }
    const signature = signPartnerInstructionHmac(payload, 'sandbox-instruction-hmac:psp');
    expect(signature).toMatch(/^[a-f0-9]{64}$/);
    expect(() =>
      assertInstructionPayloadKeys({ ...payload, accountNumber: 'not-allowed' }),
    ).toThrow(/not permitted/);
  });
});
