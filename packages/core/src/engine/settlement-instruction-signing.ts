import { createHash } from 'node:crypto';
import {
  fingerprintPublicKeyPem,
  generateEd25519KeyPair,
  publicKeyJwkX,
  publicKeyPemFromPrivate,
  signEd25519,
  verifyEd25519,
} from '../crypto/ed25519.js';
import type { ProviderCredentialVault } from '../crypto/provider-credential-vault.js';
import {
  INSTRUCTION_VAULT_KEY_NAME,
  INSTRUCTION_VAULT_PROVIDER_ID,
  SETTLEMENT_INSTRUCTION_CANONICALIZATION,
  SETTLEMENT_INSTRUCTION_SIGNATURE_ALGORITHM,
  assertInstructionPayloadShape,
  type SettlementInstructionPayload,
} from '../domain/settlement-instruction.js';
import { canonicalJson } from '../reproducibility/canonical-json.js';

/**
 * Signing, verification, and key management for settlement instructions.
 *
 * Deliberately separate from the receipt signer despite sharing Ed25519 primitives: the two sign
 * different things with different meanings, and a shared key would let a receipt verifier accept a
 * settlement instruction. They use different vault entries for the same reason.
 */

export interface InstructionSigningKey {
  readonly keyId: string;
  readonly privateKeyPem: string;
  readonly publicKeyPem: string;
  /** Generation number. Rotation mints `generation + 1` and keeps the old key verifiable. */
  readonly generation: number;
}

export interface InstructionVerificationKey {
  readonly keyId: string;
  readonly publicKeyPem: string;
  readonly generation: number;
}

/**
 * The active signing key plus every retired key still published for verification.
 *
 * Rotation must not invalidate instructions already in customers' hands. An artifact signed last
 * month is verified against the key that signed it, so retired public keys stay in the JWKS until
 * every instruction they signed has expired.
 */
export interface InstructionKeyRing {
  readonly active: InstructionSigningKey;
  readonly verification: readonly InstructionVerificationKey[];
}

/** Key id is the public-key fingerprint, so it is derivable by anyone holding the key. */
export function instructionKeyId(publicKeyPem: string, generation: number): string {
  return `msi-${generation}-${fingerprintPublicKeyPem(publicKeyPem).slice(0, 32)}`;
}

function vaultKeyName(generation: number): string {
  return generation === 1
    ? INSTRUCTION_VAULT_KEY_NAME
    : `${INSTRUCTION_VAULT_KEY_NAME}_g${generation}`;
}

function signingKeyFrom(privateKeyPem: string, generation: number): InstructionSigningKey {
  const publicKeyPem = publicKeyPemFromPrivate(privateKeyPem);
  return {
    keyId: instructionKeyId(publicKeyPem, generation),
    privateKeyPem,
    publicKeyPem,
    generation,
  };
}

/** Generations are probed in order rather than listed, since the vault is a key-value store. */
const MAX_KEY_GENERATIONS = 64;

/**
 * Load the key ring, minting generation 1 on first use.
 *
 * Reads forward from generation 1 until a generation is absent; the last one present is active.
 * Every generation found stays in {@link InstructionKeyRing.verification}.
 */
export async function loadInstructionKeyRing(
  vault: ProviderCredentialVault,
  nowIso: string,
): Promise<InstructionKeyRing> {
  const found: InstructionSigningKey[] = [];
  for (let generation = 1; generation <= MAX_KEY_GENERATIONS; generation += 1) {
    const stored = await vault.getPlaintext(INSTRUCTION_VAULT_PROVIDER_ID, vaultKeyName(generation));
    if (stored === null) {
      break;
    }
    found.push(signingKeyFrom(stored, generation));
  }

  if (found.length === 0) {
    const generated = generateEd25519KeyPair();
    await vault.putPlaintext(
      INSTRUCTION_VAULT_PROVIDER_ID,
      vaultKeyName(1),
      generated.privateKeyPem,
      nowIso,
    );
    found.push(signingKeyFrom(generated.privateKeyPem, 1));
  }

  const active = found[found.length - 1];
  if (active === undefined) {
    throw new Error('Instruction key ring resolved to no active key.');
  }
  return {
    active,
    verification: found.map((key) => ({
      keyId: key.keyId,
      publicKeyPem: key.publicKeyPem,
      generation: key.generation,
    })),
  };
}

/**
 * Mint the next generation and make it active.
 *
 * The previous key is not deleted: instructions it signed are still in customers' hands and must
 * stay verifiable until they expire.
 */
export async function rotateInstructionSigningKey(
  vault: ProviderCredentialVault,
  nowIso: string,
): Promise<InstructionKeyRing> {
  const current = await loadInstructionKeyRing(vault, nowIso);
  const nextGeneration = current.active.generation + 1;
  if (nextGeneration > MAX_KEY_GENERATIONS) {
    throw new Error(`Instruction signing key exhausted ${MAX_KEY_GENERATIONS} generations.`);
  }
  const generated = generateEd25519KeyPair();
  await vault.putPlaintext(
    INSTRUCTION_VAULT_PROVIDER_ID,
    vaultKeyName(nextGeneration),
    generated.privateKeyPem,
    nowIso,
  );
  return loadInstructionKeyRing(vault, nowIso);
}

export function canonicalizeInstructionPayload(payload: SettlementInstructionPayload): string {
  assertInstructionPayloadShape(payload);
  return canonicalJson(payload);
}

export function hashCanonicalInstruction(payloadCanonical: string): string {
  return createHash('sha256').update(payloadCanonical, 'utf8').digest('hex');
}

export interface SignedInstructionBytes {
  readonly payloadCanonical: string;
  readonly payloadHash: string;
  readonly signature: string;
  readonly keyId: string;
}

export function signInstructionPayload(
  payload: SettlementInstructionPayload,
  key: InstructionSigningKey,
): SignedInstructionBytes {
  const payloadCanonical = canonicalizeInstructionPayload(payload);
  return {
    payloadCanonical,
    payloadHash: hashCanonicalInstruction(payloadCanonical),
    signature: signEd25519(payloadCanonical, key.privateKeyPem),
    keyId: key.keyId,
  };
}

export const INSTRUCTION_VERIFICATION_FAILURES = [
  'unknown_key',
  'canonical_mismatch',
  'hash_mismatch',
  'signature_invalid',
] as const;
export type InstructionVerificationFailure = (typeof INSTRUCTION_VERIFICATION_FAILURES)[number];

export interface InstructionVerificationOutcome {
  readonly valid: boolean;
  readonly payloadHash: string;
  readonly keyId: string;
  readonly reason: InstructionVerificationFailure | null;
  /** True regardless of validity: verifying never moves money. */
  readonly fundsMoved: false;
}

/**
 * Verify a signature the way an external party would.
 *
 * Re-canonicalizes the payload rather than trusting a supplied `payloadCanonical`, so a caller
 * cannot get a valid result by presenting bytes that differ from the structured payload they also
 * sent. That mismatch is itself a reported failure.
 */
export function verifyInstructionSignature(input: {
  readonly payload: SettlementInstructionPayload;
  readonly signature: string;
  readonly keyId: string;
  readonly keys: readonly InstructionVerificationKey[];
  readonly payloadCanonical?: string | undefined;
}): InstructionVerificationOutcome {
  const payloadCanonical = canonicalizeInstructionPayload(input.payload);
  const payloadHash = hashCanonicalInstruction(payloadCanonical);
  const base = { payloadHash, keyId: input.keyId, fundsMoved: false } as const;

  if (input.payloadCanonical !== undefined && input.payloadCanonical !== payloadCanonical) {
    return { ...base, valid: false, reason: 'canonical_mismatch' };
  }
  const key = input.keys.find((candidate) => candidate.keyId === input.keyId);
  if (key === undefined) {
    return { ...base, valid: false, reason: 'unknown_key' };
  }
  if (!verifyEd25519(payloadCanonical, input.signature, key.publicKeyPem)) {
    return { ...base, valid: false, reason: 'signature_invalid' };
  }
  return { ...base, valid: true, reason: null };
}

export interface InstructionJwk {
  readonly kty: 'OKP';
  readonly crv: 'Ed25519';
  readonly alg: 'EdDSA';
  readonly use: 'sig';
  readonly kid: string;
  readonly x: string;
}

export interface InstructionJwks {
  readonly keys: readonly InstructionJwk[];
}

/**
 * Publish the ring as a JWKS.
 *
 * Public keys only — {@link InstructionJwk} has no `d`, so a private key is not expressible in the
 * returned type, not merely omitted by the mapping below.
 */
export function instructionJwks(keys: readonly InstructionVerificationKey[]): InstructionJwks {
  return {
    keys: keys.map((key) => ({
      kty: 'OKP',
      crv: 'Ed25519',
      alg: 'EdDSA',
      use: 'sig',
      kid: key.keyId,
      x: publicKeyJwkX(key.publicKeyPem),
    })),
  };
}

export const INSTRUCTION_SIGNING_DOCS = {
  algorithm: SETTLEMENT_INSTRUCTION_SIGNATURE_ALGORITHM,
  canonicalization: SETTLEMENT_INSTRUCTION_CANONICALIZATION,
  vaultProviderId: INSTRUCTION_VAULT_PROVIDER_ID,
  vaultKeyName: INSTRUCTION_VAULT_KEY_NAME,
} as const;
