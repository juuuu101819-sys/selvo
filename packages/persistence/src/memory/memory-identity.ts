import type {
  IdentityApiKey,
  IdentityMembership,
  IdentityOrganization,
  IdentitySession,
  IdentityStore,
  IdentityUser,
  PublicApiKey,
  PublicMember,
  ResolvedPrincipalRecord,
  UpsertMembershipInput,
  UpsertOrganizationInput,
  UpsertUserInput,
} from '@meridian/core';

interface StoredApiKey extends IdentityApiKey {
  readonly createdAt: string;
  lastUsedAt: string | null;
}

interface StoredSession extends IdentitySession {
  lastSeenAt: string | null;
}

/**
 * In-process identity store.
 *
 * Used by the default memory driver and by authorization tests, so a tenant-isolation failure is
 * caught without standing up PostgreSQL.
 */
export class InMemoryIdentityStore implements IdentityStore {
  private readonly usersById = new Map<string, IdentityUser>();
  private readonly usersByEmail = new Map<string, string>();
  private readonly organizations = new Map<string, IdentityOrganization>();
  private readonly memberships = new Map<string, IdentityMembership>();
  private readonly sessionsByHash = new Map<string, StoredSession>();
  private readonly sessionsById = new Map<string, string>();
  private readonly apiKeysByPrefix = new Map<string, StoredApiKey>();
  private readonly apiKeysById = new Map<string, string>();

  findUserByEmail(email: string): Promise<IdentityUser | null> {
    const id = this.usersByEmail.get(email.toLowerCase());
    return Promise.resolve(
      id === undefined ? null : structuredClone(this.usersById.get(id) ?? null),
    );
  }

  findUserById(id: string): Promise<IdentityUser | null> {
    const user = this.usersById.get(id);
    return Promise.resolve(user === undefined ? null : structuredClone(user));
  }

  findOrganization(id: string): Promise<IdentityOrganization | null> {
    const org = this.organizations.get(id);
    return Promise.resolve(org === undefined ? null : structuredClone(org));
  }

  findActiveMembership(userId: string, organizationId: string): Promise<IdentityMembership | null> {
    for (const membership of this.memberships.values()) {
      if (
        membership.userId === userId &&
        membership.organizationId === organizationId &&
        membership.status === 'active'
      ) {
        return Promise.resolve(structuredClone(membership));
      }
    }
    return Promise.resolve(null);
  }

  listMembershipsForUser(userId: string): Promise<readonly IdentityMembership[]> {
    return Promise.resolve(
      [...this.memberships.values()]
        .filter((membership) => membership.userId === userId && membership.status === 'active')
        .map((membership) => structuredClone(membership)),
    );
  }

  createSession(input: {
    readonly id: string;
    readonly userId: string;
    readonly organizationId: string;
    readonly tokenHash: string;
    readonly expiresAt: string;
  }): Promise<void> {
    const session: StoredSession = { ...input, revokedAt: null, lastSeenAt: null };
    this.sessionsByHash.set(input.tokenHash, session);
    this.sessionsById.set(input.id, input.tokenHash);
    return Promise.resolve();
  }

  findValidSessionByTokenHash(
    tokenHash: string,
    nowIso: string,
  ): Promise<ResolvedPrincipalRecord | null> {
    const session = this.sessionsByHash.get(tokenHash);
    if (session === undefined || session.revokedAt !== null || session.expiresAt <= nowIso) {
      return Promise.resolve(null);
    }
    return this.resolve(session.userId, session.organizationId, session, null);
  }

  revokeSession(id: string, nowIso: string): Promise<void> {
    const hash = this.sessionsById.get(id);
    if (hash === undefined) {
      return Promise.resolve();
    }
    const session = this.sessionsByHash.get(hash);
    if (session !== undefined) {
      session.revokedAt = nowIso;
    }
    return Promise.resolve();
  }

  touchSession(id: string, nowIso: string): Promise<void> {
    const hash = this.sessionsById.get(id);
    if (hash === undefined) {
      return Promise.resolve();
    }
    const session = this.sessionsByHash.get(hash);
    if (session !== undefined) {
      session.lastSeenAt = nowIso;
    }
    return Promise.resolve();
  }

  findApiKeyByPrefix(keyPrefix: string): Promise<IdentityApiKey | null> {
    const key = this.apiKeysByPrefix.get(keyPrefix);
    return Promise.resolve(key === undefined ? null : structuredClone(key));
  }

  touchApiKey(id: string, nowIso: string): Promise<void> {
    const prefix = this.apiKeysById.get(id);
    if (prefix === undefined) {
      return Promise.resolve();
    }
    const key = this.apiKeysByPrefix.get(prefix);
    if (key !== undefined) {
      key.lastUsedAt = nowIso;
    }
    return Promise.resolve();
  }

  listMembers(organizationId: string): Promise<readonly PublicMember[]> {
    const members: PublicMember[] = [];
    for (const membership of this.memberships.values()) {
      if (membership.organizationId !== organizationId) {
        continue;
      }
      const user = this.usersById.get(membership.userId);
      if (user === undefined) {
        continue;
      }
      members.push({
        userId: user.id,
        email: user.email,
        displayName: user.displayName,
        role: membership.role,
        status: membership.status,
      });
    }
    return Promise.resolve(members);
  }

  listApiKeys(organizationId: string): Promise<readonly PublicApiKey[]> {
    const keys: PublicApiKey[] = [];
    for (const key of this.apiKeysByPrefix.values()) {
      if (key.organizationId !== organizationId) {
        continue;
      }
      keys.push({
        id: key.id,
        keyPrefix: key.keyPrefix,
        label: key.label,
        createdAt: key.createdAt,
        lastUsedAt: key.lastUsedAt,
        revokedAt: key.revokedAt,
      });
    }
    return Promise.resolve(keys);
  }

  upsertOrganization(input: UpsertOrganizationInput): Promise<void> {
    this.organizations.set(input.id, {
      id: input.id,
      name: input.name,
      slug: input.slug,
      countryCode: input.countryCode,
      status: input.status ?? 'active',
    });
    return Promise.resolve();
  }

  upsertUser(input: UpsertUserInput): Promise<void> {
    const existingId = this.usersByEmail.get(input.email.toLowerCase());
    if (existingId !== undefined && existingId !== input.id) {
      this.usersById.delete(existingId);
    }
    this.usersById.set(input.id, {
      id: input.id,
      email: input.email.toLowerCase(),
      displayName: input.displayName,
      status: input.status ?? 'active',
      passwordHash: input.passwordHash,
    });
    this.usersByEmail.set(input.email.toLowerCase(), input.id);
    return Promise.resolve();
  }

  upsertMembership(input: UpsertMembershipInput): Promise<void> {
    this.memberships.set(input.id, {
      id: input.id,
      organizationId: input.organizationId,
      userId: input.userId,
      role: input.role,
      status: input.status ?? 'active',
    });
    return Promise.resolve();
  }

  createApiKey(input: {
    readonly id: string;
    readonly organizationId: string;
    readonly keyPrefix: string;
    readonly secretHash: string;
    readonly label: string;
    readonly createdAt: string;
  }): Promise<void> {
    const key: StoredApiKey = {
      id: input.id,
      organizationId: input.organizationId,
      keyPrefix: input.keyPrefix,
      secretHash: input.secretHash,
      label: input.label,
      revokedAt: null,
      createdAt: input.createdAt,
      lastUsedAt: null,
    };
    this.apiKeysByPrefix.set(input.keyPrefix, key);
    this.apiKeysById.set(input.id, input.keyPrefix);
    return Promise.resolve();
  }

  private resolve(
    userId: string,
    organizationId: string,
    session: IdentitySession | null,
    apiKey: IdentityApiKey | null,
  ): Promise<ResolvedPrincipalRecord | null> {
    const user = this.usersById.get(userId);
    const organization = this.organizations.get(organizationId);
    if (user === undefined || organization === undefined || user.status !== 'active') {
      return Promise.resolve(null);
    }
    for (const membership of this.memberships.values()) {
      if (
        membership.userId === userId &&
        membership.organizationId === organizationId &&
        membership.status === 'active'
      ) {
        return Promise.resolve({
          user: structuredClone(user),
          organization: structuredClone(organization),
          membership: structuredClone(membership),
          session: session === null ? null : structuredClone(session),
          apiKey: apiKey === null ? null : structuredClone(apiKey),
        });
      }
    }
    return Promise.resolve(null);
  }
}
