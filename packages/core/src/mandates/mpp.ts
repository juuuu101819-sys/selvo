import { canonicalJson } from '../reproducibility/canonical-json.js';
import { ValidationError } from '../errors/index.js';
import { isP256PublicJwk, verifyEcdsaP256Sha256 } from './ecdsa.js';
import { MandateExpiredError, MandateSignatureInvalidError } from './ap2.js';
import { asJsonObject, hashCanonical, omitProof, parseScopeFromSubject } from './scope.js';
import type { ParsedMandate } from './types.js';

/**
 * Multi-Payment Protocol session mandate: locks a spend cap for later batched consumption.
 * Consumption is not performed here — live execution remains 501.
 */
export function parseMppMandate(body: unknown, nowIso: string): ParsedMandate {
  if (body === null || typeof body !== 'object') {
    throw new ValidationError('MPP mandate must be a JSON object.', { failClosed: true });
  }
  const root = body as Record<string, unknown>;
  const session = root['session'];
  if (session === null || typeof session !== 'object') {
    throw new ValidationError('MPP session is required.', { failClosed: true });
  }
  const sessionRecord = session as Record<string, unknown>;
  const expiresAt =
    typeof sessionRecord['expiresAt'] === 'string' ? sessionRecord['expiresAt'] : undefined;
  if (expiresAt === undefined || Number.isNaN(Date.parse(expiresAt))) {
    throw new ValidationError('MPP session.expiresAt must be an ISO-8601 timestamp.', {
      failClosed: true,
    });
  }
  const expiryIso = new Date(Date.parse(expiresAt)).toISOString();
  if (Date.parse(expiryIso) <= Date.parse(nowIso)) {
    throw new MandateExpiredError(expiryIso);
  }
  const proof = root['proof'];
  if (proof === null || typeof proof !== 'object') {
    throw new ValidationError('MPP proof is required.', { failClosed: true });
  }
  const proofRecord = proof as Record<string, unknown>;
  if (typeof proofRecord['signature'] !== 'string' || !isP256PublicJwk(proofRecord['publicKeyJwk'])) {
    throw new ValidationError('MPP proof requires publicKeyJwk and signature.', { failClosed: true });
  }
  const message = canonicalJson(omitProof(sessionRecord));
  if (!verifyEcdsaP256Sha256(proofRecord['publicKeyJwk'], message, proofRecord['signature'])) {
    throw new MandateSignatureInvalidError();
  }
  const scope = parseScopeFromSubject(sessionRecord);
  const issuer =
    typeof sessionRecord['id'] === 'string' && sessionRecord['id'].trim() !== ''
      ? `mpp:${sessionRecord['id'].trim()}`
      : 'mpp:session';
  const payload = asJsonObject({ format: 'mpp', session: sessionRecord, publicKeyJwk: proofRecord['publicKeyJwk'] });
  return {
    format: 'mpp',
    issuer,
    expiresAt: expiryIso,
    scope,
    payload,
    payloadHash: hashCanonical(sessionRecord),
  };
}
