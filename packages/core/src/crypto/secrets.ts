import {
  createHash,
  createHmac,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';

/** Memory-hard password parameters. Interactive enough for a login, expensive enough to brute-force. */
const SCRYPT = { N: 16_384, r: 8, p: 1, keylen: 32 } as const;

/**
 * Last instant at which unsalted SHA-256 credential hashes may still be verified (and immediately
 * re-hashed). After this instant authentication of a leftover SHA-256 hash fails closed; the
 * operator must issue a new key. Newly created credentials never use SHA-256.
 */
export const LEGACY_SHA256_DEADLINE_ISO = '2026-11-28T00:00:00.000Z';

export const LEGACY_SHA256_DEADLINE_MS = Date.parse(LEGACY_SHA256_DEADLINE_ISO);

const DEV_SESSION_PEPPER_MATERIAL = 'meridian.dev-session-pepper.not-for-production';
const SESSION_TOKEN_PEPPER_DOMAIN = 'meridian.session-token.v1';

function scryptAsync(
  password: string,
  salt: Buffer,
  keylen: number,
  options: { readonly N: number; readonly r: number; readonly p: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keylen, options, (error, derived) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(derived);
    });
  });
}

function timingSafeEqualUtf8(left: string, right: string): boolean {
  const leftBuf = Buffer.from(left, 'utf8');
  const rightBuf = Buffer.from(right, 'utf8');
  if (leftBuf.length !== rightBuf.length) {
    return false;
  }
  return timingSafeEqual(leftBuf, rightBuf);
}

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
  const key = await scryptAsync(password, salt, SCRYPT.keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
  });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

/**
 * Adaptive hash for API keys and agent `mag_` secrets.
 *
 * Same scrypt construction as passwords: a per-secret random salt is embedded in the stored string.
 * Prefix lookup (16 characters of the raw token) means we do not need a fast hash-indexed lookup,
 * so a slow KDF is the right default rather than HMAC.
 */
export const hashCredential = hashPassword;

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

  const key = await scryptAsync(password, Buffer.from(salt, 'base64url'), expectedBuf.length, {
    N: n,
    r,
    p,
  });

  if (key.length !== expectedBuf.length) {
    return false;
  }
  return timingSafeEqual(key, expectedBuf);
}

/**
 * Legacy unsalted SHA-256 hex digest.
 *
 * **Do not use for new credentials.** Kept only so existing rows can be verified once and
 * immediately re-hashed with {@link hashCredential}. Session tokens use {@link hashSessionToken}.
 */
export function hashSecret(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

/** Timing-safe compare of a presented secret against a stored SHA-256 hex digest. */
export function secretsMatch(presented: string, storedHash: string): boolean {
  return timingSafeEqualUtf8(hashSecret(presented), storedHash);
}

/** True when `stored` looks like the pre-PA-M01 unsalted SHA-256 hex digest (not `scrypt$…`). */
export function isLegacySha256Digest(stored: string): boolean {
  return /^[0-9a-f]{64}$/.test(stored);
}

export function legacySha256VerificationAllowed(nowMs: number): boolean {
  return nowMs < LEGACY_SHA256_DEADLINE_MS;
}

export interface CredentialVerification {
  readonly ok: boolean;
  /** Present when a legacy SHA-256 hash verified; persist this and never store the raw secret. */
  readonly upgradedHash?: string;
}

/**
 * Verifies an API-key or agent secret against a stored hash.
 *
 * Current credentials are `scrypt$…` and are verified with the KDF's compare (constant-time).
 * Legacy unsalted SHA-256 hex digests are accepted only until {@link LEGACY_SHA256_DEADLINE_ISO};
 * on success the caller MUST persist `upgradedHash` and MUST NOT keep the raw secret.
 */
export async function verifyAndUpgradeCredential(
  presented: string,
  storedHash: string,
  nowMs: number,
): Promise<CredentialVerification> {
  if (storedHash.startsWith('scrypt$')) {
    const ok = await verifyPassword(presented, storedHash);
    return { ok };
  }
  if (isLegacySha256Digest(storedHash)) {
    if (!legacySha256VerificationAllowed(nowMs)) {
      return { ok: false };
    }
    if (!secretsMatch(presented, storedHash)) {
      return { ok: false };
    }
    return { ok: true, upgradedHash: await hashCredential(presented) };
  }
  return { ok: false };
}

/**
 * Domain-separated HMAC key for session-token hashing.
 *
 * AUTH_SECRET itself is never retained. Production-locked processes already require AUTH_SECRET
 * (PA-C02); a missing secret here fails closed. Development/test use a documented non-secret
 * material so HMAC is still used (not unsalted SHA-256).
 */
export function deriveSessionTokenPepper(
  authSecret: string | undefined,
  options: { readonly productionLocked: boolean },
): string {
  if (authSecret !== undefined && authSecret.length > 0) {
    return createHmac('sha256', authSecret).update(SESSION_TOKEN_PEPPER_DOMAIN).digest('hex');
  }
  if (options.productionLocked) {
    throw new Error('AUTH_SECRET is required to derive the session-token pepper.');
  }
  return createHmac('sha256', DEV_SESSION_PEPPER_MATERIAL)
    .update(SESSION_TOKEN_PEPPER_DOMAIN)
    .digest('hex');
}

/** HMAC-SHA-256 hex digest of a session token under the server pepper. The raw token is never persisted. */
export function hashSessionToken(raw: string, pepper: string): string {
  return createHmac('sha256', pepper).update(raw, 'utf8').digest('hex');
}

/** Timing-safe compare of a presented session token against a stored HMAC digest. */
export function sessionTokensMatch(presented: string, storedHash: string, pepper: string): boolean {
  return timingSafeEqualUtf8(hashSessionToken(presented, pepper), storedHash);
}

export function randomToken(prefix: string, bytes = 32): string {
  return `${prefix}${randomBytes(bytes).toString('base64url')}`;
}
