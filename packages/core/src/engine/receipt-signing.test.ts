import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import type { ExecutionReceiptPayload } from '../domain/execution-receipt.js';
import {
  canonicalizeReceiptPayload,
  generateReceiptKeyPair,
  signCanonicalReceipt,
  verifyCanonicalReceipt,
  verifyExecutionReceipt,
} from './receipt-signing.js';

function payload(): ExecutionReceiptPayload {
  return {
    receiptVersion: '1',
    purpose: 'execution_receipt',
    executionId: 'ex_1',
    organizationId: 'org_demo_meridian',
    sandbox: true,
    fundsMoved: false,
    custody: false,
    transferSigned: false,
    meridianKeysUsed: false,
    mandate: {
      id: 'mdt_1',
      issuer: 'did:example:treasury',
      agentId: 'agt_demo_treasury',
      format: 'ap2_intent',
      payloadHash: 'a'.repeat(64),
      scopeHash: 'b'.repeat(64),
      spendCapAsset: 'USD',
      spendCapMinorUnits: '10000000',
      allowedCorridors: [{ source: 'USD', destination: 'KRW' }],
      allowedCurrencies: ['USD', 'KRW'],
      allowedBeneficiariesHash: 'c'.repeat(64),
      expiresAt: '2026-12-01T00:00:00.000Z',
    },
    route: {
      routingId: 'rte_1',
      routeId: 'route_1',
      providerId: 'sandbox-veridian-payments',
      rail: 'payment_institution',
      sourceAsset: 'USD',
      destinationAsset: 'KRW',
      amountMinorUnits: '50000',
      totalCostBps: '48.12',
      recommended: true,
      competingRouteCount: 4,
      bestExecutionRationale: 'Recommended because the weighted score is highest.',
      bestExecutionRationaleHash: 'd'.repeat(64),
    },
    settlement: {
      partnerId: 'sandbox-partner-psp-fx',
      partnerInstructionId: 'pex_1',
      instructionHash: 'e'.repeat(64),
      signatureHash: 'f'.repeat(64),
      partnerStatus: 'settled',
      filledMinorUnits: '50000',
      confirmationHash: '1'.repeat(64),
    },
    fees: {
      monetizationEventId: 'mon_1',
      takeRateBps: '25',
      platformRevenueMinorUnits: '100',
      partnerCommissionMinorUnits: '25',
      economicStage: 'settled',
      realizedRevenue: false,
    },
    timestamps: {
      quotedAt: '2026-03-01T09:00:00.000Z',
      quoteExpiresAt: '2026-03-01T09:02:00.000Z',
      createdAt: '2026-03-01T09:00:00.000Z',
      dispatchedAt: '2026-03-01T09:00:01.000Z',
      settledAt: '2026-03-01T09:00:02.000Z',
    },
  };
}

describe('receipt Ed25519 signing', () => {
  it('verifies a canonical payload and fails if one signature bit is flipped', () => {
    const keys = generateReceiptKeyPair();
    const body = payload();
    const canonical = canonicalizeReceiptPayload(body);
    const signature = signCanonicalReceipt(canonical, keys.privateKeyPem);
    expect(verifyCanonicalReceipt(canonical, signature, keys.publicKeyPem)).toBe(true);
    expect(verifyExecutionReceipt({ payload: body, signature, publicKeyPem: keys.publicKeyPem }).valid).toBe(
      true,
    );

    const bytes = Buffer.from(signature, 'base64url');
    bytes[0] = (bytes[0] ?? 0) ^ 1;
    const tampered = bytes.toString('base64url');
    expect(verifyCanonicalReceipt(canonical, tampered, keys.publicKeyPem)).toBe(false);
    expect(
      verifyExecutionReceipt({ payload: body, signature: tampered, publicKeyPem: keys.publicKeyPem }),
    ).toMatchObject({ valid: false, reason: 'signature_invalid', fundsMoved: false });
  });

  it('fails verification when one payload field changes', () => {
    const keys = generateReceiptKeyPair();
    const body = payload();
    const canonical = canonicalizeReceiptPayload(body);
    const signature = signCanonicalReceipt(canonical, keys.privateKeyPem);
    const mutated: ExecutionReceiptPayload = {
      ...body,
      timestamps: { ...body.timestamps, settledAt: '2026-03-01T09:00:03.000Z' },
    };
    expect(
      verifyExecutionReceipt({ payload: mutated, signature, publicKeyPem: keys.publicKeyPem }).valid,
    ).toBe(false);
    expect(createHash('sha256').update(canonicalizeReceiptPayload(mutated), 'utf8').digest('hex')).not.toBe(
      createHash('sha256').update(canonical, 'utf8').digest('hex'),
    );
  });
});
