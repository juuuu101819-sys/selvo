import { describe, expect, it } from 'vitest';
import {
  LEGACY_SHA256_DEADLINE_MS,
  deriveSessionTokenPepper,
  hashCredential,
  hashPassword,
  hashSecret,
  hashSessionToken,
  secretsMatch,
  sessionTokensMatch,
  verifyAndUpgradeCredential,
  verifyPassword,
} from './secrets.js';

describe('password hashing', () => {
  it('verifies a password against its hash and rejects a wrong one', async () => {
    const hash = await hashPassword('MeridianDemo!2026');
    expect(hash.startsWith('scrypt$')).toBe(true);
    await expect(verifyPassword('MeridianDemo!2026', hash)).resolves.toBe(true);
    await expect(verifyPassword('wrong-password', hash)).resolves.toBe(false);
  });

  it('does not embed the plaintext in the stored hash', async () => {
    const hash = await hashPassword('super-secret-value');
    expect(hash).not.toContain('super-secret-value');
  });
});

describe('hashSecret (legacy SHA-256)', () => {
  it('is deterministic and does not equal the input', () => {
    const digest = hashSecret('mds_example');
    expect(digest).toHaveLength(64);
    expect(digest).toBe(hashSecret('mds_example'));
    expect(digest).not.toBe('mds_example');
  });
});

describe('secretsMatch', () => {
  it('accepts a presented secret against its hash and rejects a different one', () => {
    const digest = hashSecret('mk_example_secret');
    expect(secretsMatch('mk_example_secret', digest)).toBe(true);
    expect(secretsMatch('mk_other_secret', digest)).toBe(false);
  });
});

describe('PA-M01 credential hashing', () => {
  it('stores a per-secret salted scrypt hash, never plaintext or unsalted SHA-256', async () => {
    const raw = 'mk_live_example_secret_value';
    const stored = await hashCredential(raw);
    expect(stored.startsWith('scrypt$')).toBe(true);
    expect(stored).not.toBe(raw);
    expect(stored).not.toBe(hashSecret(raw));
    const other = await hashCredential(raw);
    expect(other).not.toBe(stored);
  });

  it('verifies with the KDF compare and rejects a wrong secret', async () => {
    const stored = await hashCredential('mk_correct');
    await expect(verifyAndUpgradeCredential('mk_correct', stored, Date.now())).resolves.toEqual({
      ok: true,
    });
    await expect(verifyAndUpgradeCredential('mk_wrong', stored, Date.now())).resolves.toEqual({
      ok: false,
    });
  });

  it('re-hashes a legacy SHA-256 digest on first successful verify', async () => {
    const raw = 'mk_legacy_to_upgrade';
    const legacy = hashSecret(raw);
    const result = await verifyAndUpgradeCredential(raw, legacy, Date.now());
    expect(result.ok).toBe(true);
    expect(result.upgradedHash).toBeDefined();
    expect(result.upgradedHash?.startsWith('scrypt$')).toBe(true);
    expect(result.upgradedHash).not.toBe(legacy);
  });

  it('refuses leftover SHA-256 hashes after the migration deadline', async () => {
    const raw = 'mk_expired_legacy';
    const legacy = hashSecret(raw);
    const result = await verifyAndUpgradeCredential(raw, legacy, LEGACY_SHA256_DEADLINE_MS);
    expect(result).toEqual({ ok: false });
  });
});

describe('PA-M01 session-token HMAC', () => {
  it('is peppered HMAC-SHA-256, not unsalted SHA-256', () => {
    const pepper = deriveSessionTokenPepper('unit-test-production-auth-secret-ok', {
      productionLocked: true,
    });
    const token = 'mds_session_example';
    const digest = hashSessionToken(token, pepper);
    expect(digest).toHaveLength(64);
    expect(digest).not.toBe(hashSecret(token));
    expect(sessionTokensMatch(token, digest, pepper)).toBe(true);
    expect(sessionTokensMatch('mds_other', digest, pepper)).toBe(false);
  });

  it('fails closed when production is locked and AUTH_SECRET is missing', () => {
    expect(() => deriveSessionTokenPepper(undefined, { productionLocked: true })).toThrow(
      /AUTH_SECRET is required/,
    );
  });
});
