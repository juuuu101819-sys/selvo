import { canonicalJson } from '../reproducibility/canonical-json.js';
import { MandateRejectedError, ValidationError } from '../errors/index.js';
import { isP256PublicJwk, verifyEcdsaP256Sha256 } from './ecdsa.js';
import { asJsonObject, hashCanonical, omitProof, parseScopeFromSubject } from './scope.js';
import type { ParsedMandate } from './types.js';

const INTENT_TYPE = 'IntentMandate';
const CART_TYPE = 'CartMandate';

export function parseAp2Mandate(body: unknown, nowIso: string): ParsedMandate {
  if (body === null || typeof body !== 'object') {
    throw new ValidationError('AP2 mandate must be a JSON object.', { failClosed: true });
  }
  const root = body as Record<string, unknown>;
  const credential = root['credential'] ?? root;
  if (credential === null || typeof credential !== 'object') {
    throw new ValidationError('AP2 Verifiable Credential is required.', { failClosed: true });
  }
  const vc = credential as Record<string, unknown>;
  const types = Array.isArray(vc['type']) ? vc['type'].filter((t) => typeof t === 'string') : [];
  const isIntent = types.includes(INTENT_TYPE);
  const isCart = types.includes(CART_TYPE);
  if (!types.includes('VerifiableCredential') || (!isIntent && !isCart)) {
    throw new ValidationError(
      'AP2 credential type must include VerifiableCredential and IntentMandate or CartMandate.',
      { failClosed: true, type: types },
    );
  }
  if (typeof vc['issuer'] !== 'string' || vc['issuer'].trim() === '') {
    throw new ValidationError('AP2 issuer is required.', { failClosed: true });
  }
  const expiresAt = readExpiry(vc);
  if (Date.parse(expiresAt) <= Date.parse(nowIso)) {
    throw new MandateExpiredError(expiresAt);
  }
  const proof = vc['proof'];
  if (proof === null || typeof proof !== 'object') {
    throw new ValidationError('AP2 proof is required.', { failClosed: true });
  }
  const proofRecord = proof as Record<string, unknown>;
  if (typeof proofRecord['proofValue'] !== 'string') {
    throw new ValidationError('AP2 proof.proofValue is required.', { failClosed: true });
  }
  const verificationMethod = proofRecord['verificationMethod'];
  const jwk =
    verificationMethod !== null &&
    typeof verificationMethod === 'object' &&
    !Array.isArray(verificationMethod) &&
    (verificationMethod as Record<string, unknown>)['publicKeyJwk'] !== undefined
      ? (verificationMethod as Record<string, unknown>)['publicKeyJwk']
      : verificationMethod;
  if (!isP256PublicJwk(jwk)) {
    throw new ValidationError(
      'AP2 verificationMethod must be an ECDSA P-256 public JWK (no private `d`).',
      { failClosed: true },
    );
  }
  const signed = omitProof(vc);
  const message = canonicalJson(signed);
  if (!verifyEcdsaP256Sha256(jwk, message, proofRecord['proofValue'])) {
    throw new MandateSignatureInvalidError();
  }
  const scope = parseScopeFromSubject(vc['credentialSubject']);
  const payload = asJsonObject(vc);
  return {
    format: isCart ? 'ap2_cart' : 'ap2_intent',
    issuer: vc['issuer'].trim(),
    expiresAt,
    scope,
    payload,
    payloadHash: hashCanonical(signed),
  };
}

function readExpiry(vc: Record<string, unknown>): string {
  const raw = vc['validUntil'] ?? vc['expirationDate'];
  if (typeof raw !== 'string' || Number.isNaN(Date.parse(raw))) {
    throw new ValidationError('AP2 validUntil/expirationDate must be an ISO-8601 timestamp.', {
      failClosed: true,
    });
  }
  return new Date(Date.parse(raw)).toISOString();
}

export class MandateExpiredError extends MandateRejectedError {
  constructor(expiresAt: string) {
    super('expired', 'Mandate has expired.', { expiresAt });
    this.name = 'MandateExpiredError';
  }
}

export class MandateSignatureInvalidError extends MandateRejectedError {
  constructor() {
    super('signature_invalid', 'Mandate signature is invalid.');
    this.name = 'MandateSignatureInvalidError';
  }
}
