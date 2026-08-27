import { describe, expect, it } from 'vitest';
import { hashPassword, hashSecret, secretsMatch, verifyPassword } from './secrets.js';

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

describe('hashSecret', () => {
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
