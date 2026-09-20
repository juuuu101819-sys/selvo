import { createHash } from 'node:crypto';
import {
  fingerprintPublicKeyPem,
  generateEd25519KeyPair,
  publicKeyPemFromPrivate,
  signEd25519,
  verifyEd25519,
  type Ed25519KeyPair,
} from '../crypto/ed25519.js';
import { canonicalJson } from '../reproducibility/canonical-json.js';
import {
  RECEIPT_CANONICALIZATION,
  RECEIPT_SIGNATURE_ALGORITHM,
  RECEIPT_VAULT_KEY_NAME,
  RECEIPT_VAULT_PROVIDER_ID,
  assertReceiptPayloadKeys,
  type ExecutionReceiptPayload,
  type ReceiptVerificationResult,
} from '../domain/execution-receipt.js';
import type { ProviderCredentialVault } from '../crypto/provider-credential-vault.js';

export type ReceiptKeyPair = Ed25519KeyPair;

export { fingerprintPublicKeyPem, publicKeyPemFromPrivate };

export function generateReceiptKeyPair(): ReceiptKeyPair {
  return generateEd25519KeyPair();
}

export function signCanonicalReceipt(payloadCanonical: string, privateKeyPem: string): string {
  return signEd25519(payloadCanonical, privateKeyPem);
}

export function verifyCanonicalReceipt(
  payloadCanonical: string,
  signature: string,
  publicKeyPem: string,
): boolean {
  return verifyEd25519(payloadCanonical, signature, publicKeyPem);
}

export function canonicalizeReceiptPayload(payload: ExecutionReceiptPayload): string {
  assertReceiptPayloadKeys(payload);
  return canonicalJson(payload);
}

export function verifyExecutionReceipt(input: {
  readonly payload: ExecutionReceiptPayload;
  readonly signature: string;
  readonly publicKeyPem: string;
}): ReceiptVerificationResult {
  const payloadCanonical = canonicalizeReceiptPayload(input.payload);
  const payloadHash = createHash('sha256').update(payloadCanonical, 'utf8').digest('hex');
  if (!verifyCanonicalReceipt(payloadCanonical, input.signature, input.publicKeyPem)) {
    return {
      valid: false,
      payloadHash,
      reason: 'signature_invalid',
      fundsMoved: false,
      custody: false,
    };
  }
  return {
    valid: true,
    payloadHash,
    reason: null,
    fundsMoved: false,
    custody: false,
  };
}

export async function loadOrCreateReceiptSigningKey(
  vault: ProviderCredentialVault,
  nowIso: string,
): Promise<ReceiptKeyPair> {
  const existing = await vault.getPlaintext(RECEIPT_VAULT_PROVIDER_ID, RECEIPT_VAULT_KEY_NAME);
  if (existing !== null) {
    const publicKeyPem = publicKeyPemFromPrivate(existing);
    return {
      privateKeyPem: existing,
      publicKeyPem,
      publicKeyFingerprint: fingerprintPublicKeyPem(publicKeyPem),
    };
  }
  const generated = generateReceiptKeyPair();
  await vault.putPlaintext(
    RECEIPT_VAULT_PROVIDER_ID,
    RECEIPT_VAULT_KEY_NAME,
    generated.privateKeyPem,
    nowIso,
  );
  return generated;
}

export const RECEIPT_VERIFICATION_DOCS = {
  algorithm: RECEIPT_SIGNATURE_ALGORITHM,
  canonicalization: RECEIPT_CANONICALIZATION,
  vaultProviderId: RECEIPT_VAULT_PROVIDER_ID,
  vaultKeyName: RECEIPT_VAULT_KEY_NAME,
  steps: [
    'Canonicalize receipt.payload with sorted-key JSON (canonical-json).',
    'SHA-256 the canonical UTF-8 bytes to obtain payloadHash.',
    'Decode receipt.signature as base64url.',
    'Verify Ed25519 over the canonical bytes with receipt.verification.publicKeyPem.',
    'Confirm fundsMoved, custody, transferSigned, and meridianKeysUsed are false.',
  ],
} as const;
