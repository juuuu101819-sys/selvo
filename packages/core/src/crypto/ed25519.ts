import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
} from 'node:crypto';

/**
 * Ed25519 signing primitives shared by every artifact Meridian signs.
 *
 * Extracted from `receipt-signing.ts` when settlement instructions became the second signed
 * artifact. Two copies of signature verification is how one copy quietly stops checking something.
 * The receipt module still owns receipt semantics — payload shape, forbidden keys, vault ids — and
 * delegates only the key handling and the raw sign/verify to this module.
 *
 * Nothing here knows what is being signed. A caller must decide what a signature *means*, and in
 * this system the two meanings are deliberately different: a receipt attests that a sandbox
 * execution happened, while a settlement instruction attests only that Meridian produced the
 * recommendation. Neither is an authorization to move funds.
 */

export interface Ed25519KeyPair {
  readonly privateKeyPem: string;
  readonly publicKeyPem: string;
  /** SHA-256 of the SPKI PEM. Stable across processes, so it doubles as a key id. */
  readonly publicKeyFingerprint: string;
}

export function fingerprintPublicKeyPem(publicKeyPem: string): string {
  return createHash('sha256').update(publicKeyPem, 'utf8').digest('hex');
}

export function generateEd25519KeyPair(): Ed25519KeyPair {
  const pair = generateKeyPairSync('ed25519');
  const privateKeyPem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const publicKeyPem = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  return {
    privateKeyPem,
    publicKeyPem,
    publicKeyFingerprint: fingerprintPublicKeyPem(publicKeyPem),
  };
}

export function publicKeyPemFromPrivate(privateKeyPem: string): string {
  return createPublicKey(privateKeyPem).export({ type: 'spki', format: 'pem' }).toString();
}

/** Signs canonical UTF-8 bytes. The caller canonicalizes; this never re-serializes. */
export function signEd25519(canonical: string, privateKeyPem: string): string {
  return sign(null, Buffer.from(canonical, 'utf8'), createPrivateKey(privateKeyPem)).toString(
    'base64url',
  );
}

/**
 * Verifies a base64url Ed25519 signature over canonical UTF-8 bytes.
 *
 * Returns `false` rather than throwing on a malformed key or signature: a caller verifying
 * untrusted input must not be able to turn a bad signature into a 500.
 */
export function verifyEd25519(
  canonical: string,
  signature: string,
  publicKeyPem: string,
): boolean {
  try {
    return verify(
      null,
      Buffer.from(canonical, 'utf8'),
      createPublicKey(publicKeyPem),
      Buffer.from(signature, 'base64url'),
    );
  } catch {
    return false;
  }
}

/** The `x` parameter of an Ed25519 JWK: the raw 32-byte public key, base64url. */
export function publicKeyJwkX(publicKeyPem: string): string {
  const jwk = createPublicKey(publicKeyPem).export({ format: 'jwk' }) as { readonly x?: string };
  if (typeof jwk.x !== 'string' || jwk.x === '') {
    throw new Error('Ed25519 public key did not export a JWK `x` parameter.');
  }
  return jwk.x;
}
