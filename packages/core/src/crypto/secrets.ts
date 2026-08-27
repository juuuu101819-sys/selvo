import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);

/** Memory-hard password parameters. Interactive enough for a login, expensive enough to brute-force. */
const SCRYPT = { N: 16_384, r: 8, p: 1, keylen: 32 } as const;

/**
 * Hashes a password with scrypt.
 *
 * The schema comment names Argon2id as the intended algorithm. scrypt is the same class of
 * memory-hard KDF and needs no native addon, so local development and CI stay installable. The
 * stored string is tagged, so a later Argon2id hash can coexist and be verified by prefix.
 * Plaintext is never returned, logged, or stored.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = (await scrypt(password, salt, SCRYPT.keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
  })) as Buffer;
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') {
    return false;
  }
  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = parts[4];
  const expected = parts[5];
  if (
    !Number.isInteger(n) ||
    !Number.isInteger(r) ||
    !Number.isInteger(p) ||
    salt === undefined ||
    expected === undefined
  ) {
    return false;
  }

  let expectedBuf: Buffer;
  try {
    expectedBuf = Buffer.from(expected, 'base64url');
  } catch {
    return false;
  }

  const key = (await scrypt(password, Buffer.from(salt, 'base64url'), expectedBuf.length, {
    N: n,
    r,
    p,
  })) as Buffer;

  if (key.length !== expectedBuf.length) {
    return false;
  }
  return timingSafeEqual(key, expectedBuf);
}

/** SHA-256 hex digest of a session token or API key secret. The raw value is never persisted. */
export function hashSecret(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

export function randomToken(prefix: string, bytes = 32): string {
  return `${prefix}${randomBytes(bytes).toString('base64url')}`;
}
