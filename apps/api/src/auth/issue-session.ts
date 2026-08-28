import {
  hashSessionToken,
  randomToken,
  uuidIdGenerator,
  type IdentityOrganization,
  type IdentityStore,
  type IdentityUser,
  type OrganizationRole,
} from '@meridian/core';
import { SESSION_PREFIX } from './identity-authenticator.js';

export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
export const MFA_CHALLENGE_PREFIX = 'mfc_';
export const MFA_CHALLENGE_TTL_MS = 5 * 60 * 1000;
export const OIDC_STATE_TTL_MS = 10 * 60 * 1000;

export interface IssuedHumanSession {
  readonly token: string;
  readonly expiresAt: string;
  readonly user: {
    readonly id: string;
    readonly email: string;
    readonly displayName: string;
  };
  readonly organization: {
    readonly id: string;
    readonly name: string;
    readonly slug: string;
    readonly countryCode: string;
  };
  readonly role: OrganizationRole;
}

/**
 * Issues a PA-H02 human session. MFA and OIDC call this after their extra gate; they do not
 * mint a parallel token type.
 */
export async function issueHumanSession(input: {
  readonly identity: IdentityStore;
  readonly sessionTokenPepper: string;
  readonly nowMs: number;
  readonly user: IdentityUser;
  readonly organization: IdentityOrganization;
  readonly role: OrganizationRole;
}): Promise<IssuedHumanSession> {
  const token = randomToken(SESSION_PREFIX);
  const expiresAt = new Date(input.nowMs + SESSION_TTL_MS).toISOString();
  const sessionId = uuidIdGenerator.generate('ses');
  await input.identity.createSession({
    id: sessionId,
    userId: input.user.id,
    organizationId: input.organization.id,
    tokenHash: hashSessionToken(token, input.sessionTokenPepper),
    expiresAt,
  });
  return {
    token,
    expiresAt,
    user: {
      id: input.user.id,
      email: input.user.email,
      displayName: input.user.displayName,
    },
    organization: {
      id: input.organization.id,
      name: input.organization.name,
      slug: input.organization.slug,
      countryCode: input.organization.countryCode,
    },
    role: input.role,
  };
}
