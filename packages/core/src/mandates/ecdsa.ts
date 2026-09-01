import { createPublicKey, verify } from 'node:crypto';

/**
 * ECDSA P-256 + SHA-256 verification for mandate proofs.
 *
 * Public keys only. This module never generates, imports, or stores a private key.
 */
export interface P256PublicJwk {
  readonly kty: 'EC';
  readonly crv: 'P-256';
  readonly x: string;
  readonly y: string;
}

export function isP256PublicJwk(value: unknown): value is P256PublicJwk {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    record['kty'] === 'EC' &&
    record['crv'] === 'P-256' &&
    typeof record['x'] === 'string' &&
    typeof record['y'] === 'string' &&
    record['d'] === undefined
  );
}

export function verifyEcdsaP256Sha256(
  publicJwk: P256PublicJwk,
  message: string,
  signatureB64url: string,
): boolean {
  try {
    const key = createPublicKey({
      key: { kty: 'EC', crv: 'P-256', x: publicJwk.x, y: publicJwk.y },
      format: 'jwk',
    });
    const signature = Buffer.from(signatureB64url, 'base64url');
    if (signature.length === 0) {
      return false;
    }
    return verify('sha256', Buffer.from(message, 'utf8'), key, signature);
  } catch {
    return false;
  }
}
