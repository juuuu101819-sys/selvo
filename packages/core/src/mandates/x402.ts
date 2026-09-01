import { canonicalJson } from '../reproducibility/canonical-json.js';
import { ValidationError } from '../errors/index.js';
import { isP256PublicJwk, verifyEcdsaP256Sha256 } from './ecdsa.js';
import { MandateExpiredError, MandateSignatureInvalidError } from './ap2.js';
import { asJsonObject, hashCanonical, parseScopeFromSubject } from './scope.js';
import type { ParsedMandate, X402Challenge } from './types.js';

export function parseX402ScopeRequest(body: unknown): ReturnType<typeof parseScopeFromSubject> {
  if (body === null || typeof body !== 'object') {
    throw new ValidationError('x402 mandate must be a JSON object.', { failClosed: true });
  }
  const root = body as Record<string, unknown>;
  return parseScopeFromSubject(root['scope'] ?? root['credentialSubject'] ?? root);
}

export function parseX402Authorization(
  body: unknown,
  challenge: X402Challenge,
  nowIso: string,
): ParsedMandate {
  if (Date.parse(challenge.expiresAt) <= Date.parse(nowIso)) {
    throw new MandateExpiredError(challenge.expiresAt);
  }
  if (body === null || typeof body !== 'object') {
    throw new ValidationError('x402 authorization must be a JSON object.', { failClosed: true });
  }
  const root = body as Record<string, unknown>;
  const authorization = root['authorization'];
  if (authorization === null || typeof authorization !== 'object') {
    throw new ValidationError('x402 authorization is required after the 402 challenge.', {
      failClosed: true,
      reason: 'challenge_invalid',
    });
  }
  const auth = authorization as Record<string, unknown>;
  if (typeof auth['signature'] !== 'string' || !isP256PublicJwk(auth['publicKeyJwk'])) {
    throw new ValidationError('x402 authorization requires publicKeyJwk and signature.', {
      failClosed: true,
    });
  }
  const message = canonicalJson({
    challengeId: challenge.id,
    nonce: challenge.nonce,
    organizationId: challenge.organizationId,
    agentId: challenge.agentId,
    scope: challenge.scope,
  });
  if (!verifyEcdsaP256Sha256(auth['publicKeyJwk'], message, auth['signature'])) {
    throw new MandateSignatureInvalidError();
  }
  const payload = asJsonObject({
    format: 'x402',
    challengeId: challenge.id,
    nonce: challenge.nonce,
    scope: challenge.scope,
    publicKeyJwk: auth['publicKeyJwk'],
  });
  return {
    format: 'x402',
    issuer: `x402:${challenge.id}`,
    expiresAt: challenge.expiresAt,
    scope: challenge.scope,
    payload,
    payloadHash: hashCanonical({ challengeId: challenge.id, nonce: challenge.nonce, scope: challenge.scope }),
  };
}

export function x402ChallengeResponse(challenge: X402Challenge): Record<string, unknown> {
  return {
    x402Version: 1,
    error: 'X-PAYMENT required',
    accepts: [
      {
        scheme: 'exact',
        network: 'mandate',
        maxAmountRequired: challenge.scope.spendCapMinorUnits,
        asset: challenge.scope.spendCapAsset,
        extra: {
          challengeId: challenge.id,
          nonce: challenge.nonce,
          expiresAt: challenge.expiresAt,
        },
      },
    ],
  };
}
