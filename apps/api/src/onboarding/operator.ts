import { UnauthenticatedError, hashSecret } from '@meridian/core';
import { timingSafeEqual } from 'node:crypto';

export const ONBOARDING_OPERATOR_HEADER = 'x-onboarding-operator-key';

function hashesMatch(leftHex: string, rightHex: string): boolean {
  const left = Buffer.from(leftHex, 'hex');
  const right = Buffer.from(rightHex, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Sales-ops credential. Compared as SHA-256 hashes so the raw secret is not copied onto AppConfig.
 * Missing or wrong values share the same 401 — the endpoint is not an oracle for whether the
 * secret is configured.
 */
export function requireOnboardingOperator(
  presented: string | undefined,
  expected: string | undefined,
): void {
  if (
    expected === undefined ||
    expected.length === 0 ||
    presented === undefined ||
    presented.length === 0 ||
    !hashesMatch(hashSecret(presented), hashSecret(expected))
  ) {
    throw new UnauthenticatedError('Operator credentials were not accepted.', {
      scheme: 'onboarding_operator',
      enforcing: true,
    });
  }
}
