import type {
  ApiScope,
  IdentityApiKey,
  IdentityMembership,
  IdentityOrganization,
  IdentitySession,
  IdentityStore,
  IdentityUser,
  MfaChallengeRecord,
  MfaRecoveryCodeRecord,
  OidcAuthorizationStateRecord,
  OidcConnectionRecord,
  PublicApiKey,
  PublicMember,
  ResolvedPrincipalRecord,
  UpsertMembershipInput,
  UpsertOidcConnectionInput,
  UpsertOrganizationInput,
  UpsertUserInput,
  UserMfaRecord,
} from '@meridian/core';
import { uuidIdGenerator } from '@meridian/core';

interface StoredApiKey extends Omit<IdentityApiKey, 'revokedAt'> {
  readonly createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

interface StoredSession {
  readonly id: string;
  readonly userId: string;
  readonly organizationId: string;
  readonly tokenHash: string;
  readonly expiresAt: string;
  revokedAt: string | null;
  lastSeenAt: string | null;
}

interface StoredUserMfa {
  totpSecretCiphertext: string | null;
  pendingTotpSecretCiphertext: string | null;
  mfaEnabledAt: string | null;
}

interface StoredRecoveryCode {
  readonly id: string;
  readonly userId: string;
  readonly codeHash: string;
  usedAt: string | null;
}

interface StoredMfaChallenge {
  readonly id: string;
  readonly tokenHash: string;
  readonly userId: string;
  readonly organizationId: string;
  readonly expiresAt: string;
  consumedAt: string | null;
}

interface StoredOidcState {
  readonly id: string;
  readonly stateHash: string;
  readonly nonceCiphertext: string;
  readonly organizationId: string;
  readonly expiresAt: string;
  consumedAt: string | null;
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
  private readonly mfaByUserId = new Map<string, StoredUserMfa>();
  private readonly recoveryCodesByUserId = new Map<string, StoredRecoveryCode[]>();
  private readonly mfaChallengesByHash = new Map<string, StoredMfaChallenge>();
  private readonly oidcByOrganizationId = new Map<string, OidcConnectionRecord>();
  private readonly oidcStatesByHash = new Map<string, StoredOidcState>();

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

  findOrganizationBySlug(slug: string): Promise<IdentityOrganization | null> {
    const normalized = slug.trim().toLowerCase();
    for (const org of this.organizations.values()) {
      if (org.slug.toLowerCase() === normalized) {
        return Promise.resolve(structuredClone(org));
      }
    }
    return Promise.resolve(null);
  }

  updateOrganizationAuthSettings(
    organizationId: string,
    input: { readonly requireMfaForPrivilegedRoles: boolean },
  ): Promise<boolean> {
    const existing = this.organizations.get(organizationId);
    if (existing === undefined) {
      return Promise.resolve(false);
    }
    this.organizations.set(organizationId, {
      ...existing,
      requireMfaForPrivilegedRoles: input.requireMfaForPrivilegedRoles,
    });
    return Promise.resolve(true);
  }

  findUserMfa(userId: string): Promise<UserMfaRecord | null> {
    if (!this.usersById.has(userId)) {
      return Promise.resolve(null);
    }
    const stored = this.mfaByUserId.get(userId);
    return Promise.resolve({
      userId,
      totpSecretCiphertext: stored?.totpSecretCiphertext ?? null,
      pendingTotpSecretCiphertext: stored?.pendingTotpSecretCiphertext ?? null,
      mfaEnabledAt: stored?.mfaEnabledAt ?? null,
    });
  }

  saveUserMfa(input: {
    readonly userId: string;
    readonly totpSecretCiphertext: string | null;
    readonly pendingTotpSecretCiphertext: string | null;
    readonly mfaEnabledAt: string | null;
  }): Promise<void> {
    this.mfaByUserId.set(input.userId, {
      totpSecretCiphertext: input.totpSecretCiphertext,
      pendingTotpSecretCiphertext: input.pendingTotpSecretCiphertext,
      mfaEnabledAt: input.mfaEnabledAt,
    });
    return Promise.resolve();
  }

  listUnusedRecoveryCodes(userId: string): Promise<readonly MfaRecoveryCodeRecord[]> {
    const rows = this.recoveryCodesByUserId.get(userId) ?? [];
    return Promise.resolve(
      rows
        .filter((row) => row.usedAt === null)
        .map((row) => ({
          id: row.id,
          userId: row.userId,
          codeHash: row.codeHash,
          usedAt: row.usedAt,
        })),
    );
  }

  replaceRecoveryCodes(userId: string, hashes: readonly string[]): Promise<void> {
    this.recoveryCodesByUserId.set(
      userId,
      hashes.map((codeHash) => ({
        id: uuidIdGenerator.generate('mrc'),
        userId,
        codeHash,
        usedAt: null,
      })),
    );
    return Promise.resolve();
  }

  consumeRecoveryCode(id: string, userId: string, nowIso: string): Promise<boolean> {
    const rows = this.recoveryCodesByUserId.get(userId);
    if (rows === undefined) {
      return Promise.resolve(false);
    }
    const row = rows.find((candidate) => candidate.id === id);
    if (row === undefined || row.usedAt !== null) {
      return Promise.resolve(false);
    }
    row.usedAt = nowIso;
    return Promise.resolve(true);
  }

  createMfaChallenge(input: {
    readonly id: string;
    readonly tokenHash: string;
    readonly userId: string;
    readonly organizationId: string;
    readonly expiresAt: string;
  }): Promise<void> {
    this.mfaChallengesByHash.set(input.tokenHash, { ...input, consumedAt: null });
    return Promise.resolve();
  }

  findValidMfaChallengeByTokenHash(
    tokenHash: string,
    nowIso: string,
  ): Promise<MfaChallengeRecord | null> {
    const row = this.mfaChallengesByHash.get(tokenHash);
    if (row === undefined || row.consumedAt !== null || row.expiresAt <= nowIso) {
      return Promise.resolve(null);
    }
    return Promise.resolve({ ...row });
  }

  consumeMfaChallenge(id: string, nowIso: string): Promise<boolean> {
    for (const row of this.mfaChallengesByHash.values()) {
      if (row.id === id && row.consumedAt === null) {
        row.consumedAt = nowIso;
        return Promise.resolve(true);
      }
    }
    return Promise.resolve(false);
  }

  findOidcConnection(organizationId: string): Promise<OidcConnectionRecord | null> {
    const row = this.oidcByOrganizationId.get(organizationId);
    return Promise.resolve(row === undefined ? null : structuredClone(row));
  }

  upsertOidcConnection(input: UpsertOidcConnectionInput): Promise<void> {
    this.oidcByOrganizationId.set(input.organizationId, { ...input });
    return Promise.resolve();
  }

  createOidcState(input: {
    readonly id: string;
    readonly stateHash: string;
    readonly nonceCiphertext: string;
    readonly organizationId: string;
    readonly expiresAt: string;
  }): Promise<void> {
    this.oidcStatesByHash.set(input.stateHash, { ...input, consumedAt: null });
    return Promise.resolve();
  }

  consumeOidcState(
    stateHash: string,
    nowIso: string,
  ): Promise<OidcAuthorizationStateRecord | null> {
    const row = this.oidcStatesByHash.get(stateHash);
    if (row === undefined || row.consumedAt !== null || row.expiresAt <= nowIso) {
      return Promise.resolve(null);
    }
    row.consumedAt = nowIso;
    return Promise.resolve({
      id: row.id,
      organizationId: row.organizationId,
      nonceCiphertext: row.nonceCiphertext,
    });
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

  replaceSessionTokenHash(id: string, tokenHash: string): Promise<void> {
    const previousHash = this.sessionsById.get(id);
    if (previousHash === undefined) {
      return Promise.resolve();
    }
    const session = this.sessionsByHash.get(previousHash);
    if (session === undefined) {
      return Promise.resolve();
    }
    this.sessionsByHash.delete(previousHash);
    const updated: StoredSession = { ...session, tokenHash };
    this.sessionsByHash.set(tokenHash, updated);
    this.sessionsById.set(id, tokenHash);
    return Promise.resolve();
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

  replaceApiKeySecretHash(id: string, secretHash: string): Promise<void> {
    const prefix = this.apiKeysById.get(id);
    if (prefix === undefined) {
      return Promise.resolve();
    }
    const key = this.apiKeysByPrefix.get(prefix);
    if (key === undefined) {
      return Promise.resolve();
    }
    this.apiKeysByPrefix.set(prefix, { ...key, secretHash });
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
        expiresAt: key.expiresAt,
        scopes: key.scopes,
        revokedAt: key.revokedAt,
      });
    }
    return Promise.resolve(keys);
  }

  upsertOrganization(input: UpsertOrganizationInput): Promise<void> {
    const existing = this.organizations.get(input.id);
    this.organizations.set(input.id, {
      id: input.id,
      name: input.name,
      slug: input.slug,
      countryCode: input.countryCode,
      status: input.status ?? 'active',
      requireMfaForPrivilegedRoles:
        input.requireMfaForPrivilegedRoles ?? existing?.requireMfaForPrivilegedRoles ?? false,
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
    readonly scopes: readonly ApiScope[];
    readonly expiresAt: string | null;
  }): Promise<void> {
    const key: StoredApiKey = {
      id: input.id,
      organizationId: input.organizationId,
      keyPrefix: input.keyPrefix,
      secretHash: input.secretHash,
      label: input.label,
      scopes: [...input.scopes],
      expiresAt: input.expiresAt,
      revokedAt: null,
      createdAt: input.createdAt,
      lastUsedAt: null,
    };
    this.apiKeysByPrefix.set(input.keyPrefix, key);
    this.apiKeysById.set(input.id, input.keyPrefix);
    return Promise.resolve();
  }

  revokeApiKey(id: string, organizationId: string, nowIso: string): Promise<boolean> {
    const prefix = this.apiKeysById.get(id);
    if (prefix === undefined) {
      return Promise.resolve(false);
    }
    const key = this.apiKeysByPrefix.get(prefix);
    if (key === undefined || key.organizationId !== organizationId) {
      return Promise.resolve(false);
    }
    if (key.revokedAt === null) {
      key.revokedAt = nowIso;
    }
    return Promise.resolve(true);
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
