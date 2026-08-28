import { isPrivilegedOrganizationRole } from '../domain/api-scope.js';

export type MfaLoginGate = 'none' | 'verify' | 'enroll_required';

/**
 * Whether password login may issue a session, must challenge TOTP, or must fail closed.
 *
 * Enrolled users always verify, regardless of the org flag. The org flag only requires enrollment
 * for owner/admin. Off by default so demo and test logins stay password-only.
 */
export function mfaGateForLogin(input: {
  readonly enrolled: boolean;
  readonly role: string;
  readonly requireMfaForPrivilegedRoles: boolean;
}): MfaLoginGate {
  if (input.enrolled) {
    return 'verify';
  }
  if (input.requireMfaForPrivilegedRoles && isPrivilegedOrganizationRole(input.role)) {
    return 'enroll_required';
  }
  return 'none';
}
