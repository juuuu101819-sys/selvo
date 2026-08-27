/**
 * Identity and sessions.
 *
 * The tenant boundary is `organizationId`. Every lookup that returns business data takes it as an
 * argument from the verified principal — never from the request body or a path the caller chose.
 */

import type { ApiScope } from '../domain/api-scope.js';

export type OrganizationRole = 'owner' | 'admin' | 'member' | 'viewer';
export type MembershipStatus = 'invited' | 'active' | 'suspended' | 'removed';
export type RecordStatus = 'active' | 'suspended' | 'retired';

export interface IdentityUser {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly status: RecordStatus;
  readonly passwordHash: string | null;
}

export interface IdentityOrganization {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly countryCode: string;
  readonly status: RecordStatus;
}

export interface IdentityMembership {
  readonly id: string;
  readonly organizationId: string;
  readonly userId: string;
  readonly role: OrganizationRole;
  readonly status: MembershipStatus;
}

export interface IdentitySession {
  readonly id: string;
  readonly userId: string;
  readonly organizationId: string;
  readonly tokenHash: string;
  readonly expiresAt: string;
  readonly revokedAt: string | null;
}

export interface IdentityApiKey {
  readonly id: string;
  readonly organizationId: string;
  readonly keyPrefix: string;
  readonly secretHash: string;
  readonly label: string;
  readonly scopes: readonly ApiScope[];
  readonly expiresAt: string | null;
  readonly revokedAt: string | null;
}

export interface ResolvedPrincipalRecord {
  readonly user: IdentityUser;
  readonly organization: IdentityOrganization;
  readonly membership: IdentityMembership;
  readonly session: IdentitySession | null;
  readonly apiKey: IdentityApiKey | null;
}

export interface PublicMember {
  readonly userId: string;
  readonly email: string;
  readonly displayName: string;
  readonly role: OrganizationRole;
  readonly status: MembershipStatus;
}

export interface PublicApiKey {
  readonly id: string;
  readonly keyPrefix: string;
  readonly label: string;
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
  readonly expiresAt: string | null;
  readonly scopes: readonly ApiScope[];
  readonly revokedAt: string | null;
}

export interface IssuedSession {
  readonly id: string;
  /** Raw token, shown once. Only a hash is stored. */
  readonly token: string;
  readonly expiresAt: string;
}

export interface UpsertUserInput {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly passwordHash: string;
  readonly status?: RecordStatus;
}

export interface UpsertOrganizationInput {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly countryCode: string;
  readonly status?: RecordStatus;
}

export interface UpsertMembershipInput {
  readonly id: string;
  readonly organizationId: string;
  readonly userId: string;
  readonly role: OrganizationRole;
  readonly status?: MembershipStatus;
}

/**
 * Tenancy and credentials.
 *
 * Implementations must never return a password hash or API-key secret on a public DTO. The hash
 * fields exist so the authenticator can verify; they are stripped before a response is serialised.
 */
export interface IdentityStore {
  findUserByEmail(email: string): Promise<IdentityUser | null>;
  findUserById(id: string): Promise<IdentityUser | null>;
  findOrganization(id: string): Promise<IdentityOrganization | null>;
  findActiveMembership(userId: string, organizationId: string): Promise<IdentityMembership | null>;
  listMembershipsForUser(userId: string): Promise<readonly IdentityMembership[]>;
  createSession(input: {
    readonly id: string;
    readonly userId: string;
    readonly organizationId: string;
    readonly tokenHash: string;
    readonly expiresAt: string;
  }): Promise<void>;
  findValidSessionByTokenHash(
    tokenHash: string,
    nowIso: string,
  ): Promise<ResolvedPrincipalRecord | null>;
  revokeSession(id: string, nowIso: string): Promise<void>;
  touchSession(id: string, nowIso: string): Promise<void>;
  findApiKeyByPrefix(keyPrefix: string): Promise<IdentityApiKey | null>;
  touchApiKey(id: string, nowIso: string): Promise<void>;
  listMembers(organizationId: string): Promise<readonly PublicMember[]>;
  listApiKeys(organizationId: string): Promise<readonly PublicApiKey[]>;
  upsertOrganization(input: UpsertOrganizationInput): Promise<void>;
  upsertUser(input: UpsertUserInput): Promise<void>;
  upsertMembership(input: UpsertMembershipInput): Promise<void>;
  createApiKey(input: {
    readonly id: string;
    readonly organizationId: string;
    readonly keyPrefix: string;
    readonly secretHash: string;
    readonly label: string;
    readonly createdAt: string;
    readonly scopes: readonly ApiScope[];
    readonly expiresAt: string | null;
  }): Promise<void>;
  revokeApiKey(id: string, organizationId: string, nowIso: string): Promise<boolean>;
}
