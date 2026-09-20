import { describe, expect, it } from 'vitest';
import { deriveDataEncryptionKeyHex } from '../crypto/encryption.js';
import { ProviderCredentialVault } from '../crypto/provider-credential-vault.js';
import type {
  ProviderCredentialStore,
  StoredProviderCredential,
} from '../ports/provider-credentials.js';
import {
  MERIDIAN_SIGNATURE_ATTESTS,
  MERIDIAN_SIGNATURE_DOES_NOT_ATTEST,
  SETTLEMENT_INSTRUCTION_PURPOSE,
  SETTLEMENT_INSTRUCTION_VERSION,
  type SettlementInstructionPayload,
} from '../domain/settlement-instruction.js';
import { canonicalJson } from '../reproducibility/canonical-json.js';
import { verifyEd25519 } from '../crypto/ed25519.js';
import {
  canonicalizeInstructionPayload,
  hashCanonicalInstruction,
  instructionJwks,
  loadInstructionKeyRing,
  rotateInstructionSigningKey,
  signInstructionPayload,
  verifyInstructionSignature,
} from './settlement-instruction-signing.js';

const NOW = '2026-03-01T09:00:00.000Z';

/** A vault backed by a map, so key rotation is exercised against real encrypt/decrypt. */
class MemoryCredentialStore implements ProviderCredentialStore {
  private readonly rows = new Map<string, StoredProviderCredential>();

  put(input: {
    readonly id: string;
    readonly providerId: string;
    readonly keyName: string;
    readonly ciphertext: string;
    readonly nowIso: string;
  }): Promise<StoredProviderCredential> {
    const stored: StoredProviderCredential = {
      id: input.id,
      providerId: input.providerId,
      keyName: input.keyName,
      ciphertext: input.ciphertext,
      createdAt: input.nowIso,
      updatedAt: input.nowIso,
    };
    this.rows.set(`${input.providerId}:${input.keyName}`, stored);
    return Promise.resolve(stored);
  }

  getCiphertext(providerId: string, keyName: string): Promise<string | null> {
    return Promise.resolve(this.rows.get(`${providerId}:${keyName}`)?.ciphertext ?? null);
  }

  listKeyNames(providerId: string): Promise<readonly string[]> {
    return Promise.resolve(
      [...this.rows.values()]
        .filter((row) => row.providerId === providerId)
        .map((row) => row.keyName),
    );
  }
}

function vault(): ProviderCredentialVault {
  return new ProviderCredentialVault(
    new MemoryCredentialStore(),
    deriveDataEncryptionKeyHex('unit-test-auth-secret-not-for-production-use', {
      productionLocked: false,
    }),
  );
}

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
    createdAt: NOW,
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
    authorization: { paymentIntentId: 'pay_1', executionIntentId: 'eit_1', policyEvaluated: true },
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

describe('canonicalization', () => {
  it('is independent of the order fields were built in', () => {
    // The property that makes offline verification possible: a customer reconstructing the payload
    // from their own records must arrive at the same bytes Meridian signed.
    const forward = payload();
    const reversed = Object.fromEntries(
      Object.entries(forward).reverse(),
    ) as unknown as SettlementInstructionPayload;
    expect(canonicalizeInstructionPayload(reversed)).toBe(
      canonicalizeInstructionPayload(forward),
    );
  });

  it('produces the same bytes as the shared canonicalizer', () => {
    // Reuses `canonical-json` rather than defining a second serializer, so receipts, fingerprints
    // and instructions cannot drift into disagreeing about what canonical means.
    expect(canonicalizeInstructionPayload(payload())).toBe(canonicalJson(payload()));
  });

  it('hashes to a stable 64-character digest', () => {
    const hash = hashCanonicalInstruction(canonicalizeInstructionPayload(payload()));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashCanonicalInstruction(canonicalizeInstructionPayload(payload()))).toBe(hash);
  });

  it('changes the hash when any signed value changes', () => {
    const base = hashCanonicalInstruction(canonicalizeInstructionPayload(payload()));
    const altered = hashCanonicalInstruction(
      canonicalizeInstructionPayload(
        payload({ costs: { ...payload().costs, platformFeeMinorUnits: '251' } }),
      ),
    );
    expect(altered).not.toBe(base);
  });

  it('refuses a float anywhere in a signed money field', () => {
    // A binary float in a signed artifact is the money-model bug wearing a signature, which makes
    // it authoritative as well as wrong.
    expect(() =>
      canonicalizeInstructionPayload(
        payload({
          costs: { ...payload().costs, platformFeeMinorUnits: 2.5 as unknown as string },
        }),
      ),
    ).toThrow(/fractional/);
  });
});

describe('signing and verification', () => {
  it('signs and verifies through the published key', async () => {
    const ring = await loadInstructionKeyRing(vault(), NOW);
    const signed = signInstructionPayload(payload(), ring.active);

    expect(verifyEd25519(signed.payloadCanonical, signed.signature, ring.active.publicKeyPem)).toBe(
      true,
    );
    const outcome = verifyInstructionSignature({
      payload: payload(),
      signature: signed.signature,
      keyId: signed.keyId,
      keys: ring.verification,
    });
    expect(outcome).toEqual({
      valid: true,
      payloadHash: signed.payloadHash,
      keyId: signed.keyId,
      reason: null,
      fundsMoved: false,
    });
  });

  it('rejects a tampered payload', async () => {
    const ring = await loadInstructionKeyRing(vault(), NOW);
    const signed = signInstructionPayload(payload(), ring.active);
    const outcome = verifyInstructionSignature({
      payload: payload({ organizationId: 'org_someone_else' }),
      signature: signed.signature,
      keyId: signed.keyId,
      keys: ring.verification,
    });
    expect(outcome.valid).toBe(false);
    expect(outcome.reason).toBe('signature_invalid');
  });

  it('reports an unknown key rather than a bad signature', async () => {
    const ring = await loadInstructionKeyRing(vault(), NOW);
    const signed = signInstructionPayload(payload(), ring.active);
    const outcome = verifyInstructionSignature({
      payload: payload(),
      signature: signed.signature,
      keyId: 'msi-1-not-a-real-key',
      keys: ring.verification,
    });
    // Distinguishing the two matters to whoever is debugging: one means "rotate your key cache",
    // the other means "this artifact was altered".
    expect(outcome.reason).toBe('unknown_key');
  });

  it('reports a mismatch when supplied bytes differ from the payload', async () => {
    const ring = await loadInstructionKeyRing(vault(), NOW);
    const signed = signInstructionPayload(payload(), ring.active);
    const outcome = verifyInstructionSignature({
      payload: payload(),
      signature: signed.signature,
      keyId: signed.keyId,
      keys: ring.verification,
      payloadCanonical: '{"not":"the same bytes"}',
    });
    // Re-canonicalizing rather than trusting the supplied string is what stops a caller getting a
    // valid verdict for bytes that differ from the structured payload they also sent.
    expect(outcome.reason).toBe('canonical_mismatch');
  });

  it('never signs a payload the shape guard rejects', async () => {
    const ring = await loadInstructionKeyRing(vault(), NOW);
    expect(() =>
      signInstructionPayload(payload({ fundsMoved: true as unknown as false }), ring.active),
    ).toThrow(/non-custodial/);
  });
});

describe('key ring', () => {
  it('mints a key on first use and reuses it afterwards', async () => {
    const shared = vault();
    const first = await loadInstructionKeyRing(shared, NOW);
    const second = await loadInstructionKeyRing(shared, NOW);
    expect(second.active.keyId).toBe(first.active.keyId);
    expect(second.verification).toHaveLength(1);
  });

  it('derives a key id anyone holding the public key can reproduce', async () => {
    const ring = await loadInstructionKeyRing(vault(), NOW);
    expect(ring.active.keyId).toMatch(/^msi-1-[0-9a-f]{32}$/);
  });

  it('keeps retired keys verifiable after rotation', async () => {
    const shared = vault();
    const before = await loadInstructionKeyRing(shared, NOW);
    const signedBefore = signInstructionPayload(payload(), before.active);

    const after = await rotateInstructionSigningKey(shared, NOW);
    expect(after.active.keyId).not.toBe(before.active.keyId);
    expect(after.active.generation).toBe(2);

    // An artifact already in a customer's hands must keep verifying: rotation is Meridian's
    // operational concern, not something that should invalidate instructions in flight.
    const outcome = verifyInstructionSignature({
      payload: payload(),
      signature: signedBefore.signature,
      keyId: signedBefore.keyId,
      keys: after.verification,
    });
    expect(outcome.valid).toBe(true);
  });

  it('signs with the newest key after rotation', async () => {
    const shared = vault();
    await loadInstructionKeyRing(shared, NOW);
    const after = await rotateInstructionSigningKey(shared, NOW);
    const signed = signInstructionPayload(payload(), after.active);
    expect(signed.keyId).toBe(after.active.keyId);
    expect(after.verification.map((key) => key.generation)).toEqual([1, 2]);
  });
});

describe('JWKS', () => {
  it('publishes an Ed25519 public JWK per key', async () => {
    const shared = vault();
    await loadInstructionKeyRing(shared, NOW);
    const ring = await rotateInstructionSigningKey(shared, NOW);
    const jwks = instructionJwks(ring.verification);

    expect(jwks.keys).toHaveLength(2);
    for (const key of jwks.keys) {
      expect(key.kty).toBe('OKP');
      expect(key.crv).toBe('Ed25519');
      expect(key.alg).toBe('EdDSA');
      expect(key.use).toBe('sig');
      expect(key.x).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it('cannot express a private key', async () => {
    const ring = await loadInstructionKeyRing(vault(), NOW);
    const serialized = JSON.stringify(instructionJwks(ring.verification));
    // `d` is the Ed25519 private scalar. The JWK type has no such field, so this is a check that
    // the mapping did not smuggle one through a spread.
    expect(serialized).not.toMatch(/"d"\s*:/);
    expect(serialized).not.toContain('PRIVATE KEY');
  });
});
