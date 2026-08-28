import { describe, expect, it } from 'vitest';
import { mfaGateForLogin } from '../auth/mfa-gate.js';
import {
  generateRecoveryCodes,
  isRecoveryCodeShape,
  normalizeRecoveryCode,
} from './recovery-codes.js';

describe('recovery codes', () => {
  it('issues ten single-use shaped codes', () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) {
      expect(isRecoveryCodeShape(code)).toBe(true);
    }
    expect(normalizeRecoveryCode('abcd efgh')).toBe('ABCD-EFGH');
  });
});

describe('mfaGateForLogin', () => {
  it('does not challenge when the org flag is off and the user is not enrolled', () => {
    expect(
      mfaGateForLogin({
        enrolled: false,
        role: 'owner',
        requireMfaForPrivilegedRoles: false,
      }),
    ).toBe('none');
  });

  it('requires enrollment for privileged roles when the org flag is on', () => {
    expect(
      mfaGateForLogin({
        enrolled: false,
        role: 'admin',
        requireMfaForPrivilegedRoles: true,
      }),
    ).toBe('enroll_required');
    expect(
      mfaGateForLogin({
        enrolled: false,
        role: 'member',
        requireMfaForPrivilegedRoles: true,
      }),
    ).toBe('none');
  });

  it('always verifies an enrolled user', () => {
    expect(
      mfaGateForLogin({
        enrolled: true,
        role: 'viewer',
        requireMfaForPrivilegedRoles: false,
      }),
    ).toBe('verify');
  });
});
