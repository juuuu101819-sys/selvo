import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

const DEV_DATA_ENCRYPTION_MATERIAL = 'meridian.dev-data-encryption.not-for-production';
const DATA_ENCRYPTION_DOMAIN = 'meridian.data-encryption.v1';
const ALGO = 'aes-256-gcm';
const IV_LENGTH = 12;

/**
 * Domain-separated AES-256 key for secrets at rest (TOTP seeds, OIDC client secrets, OIDC nonces,
 * PHASE 38 provider credential vault).
 *
 * AUTH_SECRET itself is never retained. Production-locked processes already require AUTH_SECRET.
 * Development/test without AUTH_SECRET uses documented non-secret material so ciphertext is still
 * produced — never plaintext.
 */
export function deriveDataEncryptionKey(
  authSecret: string | undefined,
  options: { readonly productionLocked: boolean },
): Buffer {
  if (authSecret !== undefined && authSecret.length > 0) {
    return createHmac('sha256', authSecret).update(DATA_ENCRYPTION_DOMAIN).digest();
  }
  if (options.productionLocked) {
    throw new Error('AUTH_SECRET is required to derive the data-encryption key.');
  }
  return createHmac('sha256', DEV_DATA_ENCRYPTION_MATERIAL)
    .update(DATA_ENCRYPTION_DOMAIN)
    .digest();
}

/** Hex form stored on AppConfig. Never AUTH_SECRET. */
export function deriveDataEncryptionKeyHex(
  authSecret: string | undefined,
  options: { readonly productionLocked: boolean },
): string {
  return deriveDataEncryptionKey(authSecret, options).toString('hex');
}

export function dataEncryptionKeyFromHex(hex: string): Buffer {
  const key = Buffer.from(hex, 'hex');
  if (key.length !== 32) {
    throw new Error('Data encryption key must be 32 bytes.');
  }
  return key;
}

/**
 * AES-256-GCM envelope: `v1$iv$ciphertext$tag` (base64url parts).
 *
 * The plaintext is never logged. Callers must not put the result on a public DTO.
 */
export function encryptAtRest(plaintext: string, key: Buffer): string {
  if (key.length !== 32) {
    throw new Error('Data encryption key must be 32 bytes.');
  }
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1$${iv.toString('base64url')}$${ciphertext.toString('base64url')}$${tag.toString('base64url')}`;
}

export function decryptAtRest(stored: string, key: Buffer): string {
  if (key.length !== 32) {
    throw new Error('Data encryption key must be 32 bytes.');
  }
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'v1' || parts[1] === undefined || parts[2] === undefined || parts[3] === undefined) {
    throw new Error('Unrecognized ciphertext format.');
  }
  const iv = Buffer.from(parts[1], 'base64url');
  const ciphertext = Buffer.from(parts[2], 'base64url');
  const tag = Buffer.from(parts[3], 'base64url');
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
