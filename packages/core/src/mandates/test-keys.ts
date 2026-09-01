import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import type { P256PublicJwk } from './ecdsa.js';

/**
 * Test-only P-256 key material. Production mandate ingestion never calls this.
 * Fixtures need a signer; Meridian does not hold customer keys.
 */
export interface TestP256KeyPair {
  readonly publicJwk: P256PublicJwk;
  readonly privateKey: KeyObject;
}

export function generateTestP256KeyPair(): TestP256KeyPair {
  const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = pair.publicKey.export({ format: 'jwk' });
  if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || jwk.x === undefined || jwk.y === undefined) {
    throw new Error('expected P-256 JWK');
  }
  return {
    publicJwk: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y },
    privateKey: pair.privateKey,
  };
}

export function signSha256Base64Url(privateKey: KeyObject, message: string): string {
  return sign('sha256', Buffer.from(message, 'utf8'), privateKey).toString('base64url');
}
