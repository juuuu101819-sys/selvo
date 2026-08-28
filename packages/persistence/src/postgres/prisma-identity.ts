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
import { PersistenceError, parseApiScopes, uuidIdGenerator } from '@meridian/core';
import type { PrismaClient } from '@prisma/client';

export class PrismaIdentityStore implements IdentityStore {
  constructor(private readonly client: PrismaClient) {}

  async findUserByEmail(email: string): Promise<IdentityUser | null> {
    const row = await this.query(() =>
      this.client.user.findUnique({ where: { email: email.toLowerCase() } }),
    );
    return row === null ? null : toUser(row);
  }

  async findUserById(id: string): Promise<IdentityUser | null> {
    const row = await this.query(() => this.client.user.findUnique({ where: { id } }));
    return row === null ? null : toUser(row);
  }

  async findOrganization(id: string): Promise<IdentityOrganization | null> {
    const row = await this.query(() => this.client.organization.findUnique({ where: { id } }));
    return row === null ? null : toOrganization(row);
  }

  async findOrganizationBySlug(slug: string): Promise<IdentityOrganization | null> {
    const row = await this.query(() =>
      this.client.organization.findUnique({ where: { slug: slug.trim().toLowerCase() } }),
    );
    return row === null ? null : toOrganization(row);
  }

  async updateOrganizationAuthSettings(
    organizationId: string,
    input: { readonly requireMfaForPrivilegedRoles: boolean },
  ): Promise<boolean> {
    try {
      const result = await this.client.organization.updateMany({
        where: { id: organizationId },
        data: { requireMfaForPrivilegedRoles: input.requireMfaForPrivilegedRoles },
      });
      return result.count > 0;
    } catch (error) {
      throw new PersistenceError('Failed to update organization auth settings.', {}, { cause: error });
    }
  }

  async findUserMfa(userId: string): Promise<UserMfaRecord | null> {
    const row = await this.query(() =>
      this.client.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          totpSecretCiphertext: true,
          pendingTotpSecretCiphertext: true,
          mfaEnabledAt: true,
        },
      }),
    );
    if (row === null) {
      return null;
    }
    return {
      userId: row.id,
      totpSecretCiphertext: row.totpSecretCiphertext,
      pendingTotpSecretCiphertext: row.pendingTotpSecretCiphertext,
      mfaEnabledAt: row.mfaEnabledAt?.toISOString() ?? null,
    };
  }

  async saveUserMfa(input: {
    readonly userId: string;
    readonly totpSecretCiphertext: string | null;
    readonly pendingTotpSecretCiphertext: string | null;
    readonly mfaEnabledAt: string | null;
  }): Promise<void> {
    try {
      await this.client.user.update({
        where: { id: input.userId },
        data: {
          totpSecretCiphertext: input.totpSecretCiphertext,
          pendingTotpSecretCiphertext: input.pendingTotpSecretCiphertext,
          mfaEnabledAt: input.mfaEnabledAt === null ? null : new Date(input.mfaEnabledAt),
        },
      });
    } catch (error) {
      throw new PersistenceError('Failed to save MFA enrollment.', {}, { cause: error });
    }
  }

  async listUnusedRecoveryCodes(userId: string): Promise<readonly MfaRecoveryCodeRecord[]> {
    const rows = await this.query(() =>
      this.client.mfaRecoveryCode.findMany({
        where: { userId, usedAt: null },
      }),
    );
    return rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      codeHash: row.codeHash,
      usedAt: null,
    }));
  }

  async replaceRecoveryCodes(userId: string, hashes: readonly string[]): Promise<void> {
    try {
      await this.client.$transaction([
        this.client.mfaRecoveryCode.deleteMany({ where: { userId } }),
        this.client.mfaRecoveryCode.createMany({
          data: hashes.map((codeHash) => ({
            id: uuidIdGenerator.generate('mrc'),
            userId,
            codeHash,
          })),
        }),
      ]);
    } catch (error) {
      throw new PersistenceError('Failed to replace MFA recovery codes.', {}, { cause: error });
    }
  }

  async consumeRecoveryCode(id: string, userId: string, nowIso: string): Promise<boolean> {
    try {
      const result = await this.client.mfaRecoveryCode.updateMany({
        where: { id, userId, usedAt: null },
        data: { usedAt: new Date(nowIso) },
      });
      return result.count > 0;
    } catch (error) {
      throw new PersistenceError('Failed to consume an MFA recovery code.', {}, { cause: error });
    }
  }

  async createMfaChallenge(input: {
    readonly id: string;
    readonly tokenHash: string;
    readonly userId: string;
    readonly organizationId: string;
    readonly expiresAt: string;
  }): Promise<void> {
    try {
      await this.client.mfaChallenge.create({
        data: {
          id: input.id,
          tokenHash: input.tokenHash,
          userId: input.userId,
          organizationId: input.organizationId,
          expiresAt: new Date(input.expiresAt),
        },
      });
    } catch (error) {
      throw new PersistenceError('Failed to create an MFA challenge.', {}, { cause: error });
    }
  }

  async findValidMfaChallengeByTokenHash(
    tokenHash: string,
    nowIso: string,
  ): Promise<MfaChallengeRecord | null> {
    const row = await this.query(() =>
      this.client.mfaChallenge.findUnique({ where: { tokenHash } }),
    );
    if (row === null || row.consumedAt !== null || row.expiresAt.toISOString() <= nowIso) {
      return null;
    }
    return {
      id: row.id,
      userId: row.userId,
      organizationId: row.organizationId,
      tokenHash: row.tokenHash,
      expiresAt: row.expiresAt.toISOString(),
      consumedAt: null,
    };
  }

  async consumeMfaChallenge(id: string, nowIso: string): Promise<boolean> {
    try {
      const result = await this.client.mfaChallenge.updateMany({
        where: { id, consumedAt: null },
        data: { consumedAt: new Date(nowIso) },
      });
      return result.count > 0;
    } catch (error) {
      throw new PersistenceError('Failed to consume an MFA challenge.', {}, { cause: error });
    }
  }

  async findOidcConnection(organizationId: string): Promise<OidcConnectionRecord | null> {
    const row = await this.query(() =>
      this.client.organizationOidcConnection.findUnique({ where: { organizationId } }),
    );
    return row === null ? null : toOidcConnection(row);
  }

  async upsertOidcConnection(input: UpsertOidcConnectionInput): Promise<void> {
    try {
      await this.client.organizationOidcConnection.upsert({
        where: { organizationId: input.organizationId },
        create: {
          id: input.id,
          organizationId: input.organizationId,
          issuer: input.issuer,
          clientId: input.clientId,
          clientSecretCiphertext: input.clientSecretCiphertext,
          redirectUri: input.redirectUri,
          enabled: input.enabled,
        },
        update: {
          issuer: input.issuer,
          clientId: input.clientId,
          clientSecretCiphertext: input.clientSecretCiphertext,
          redirectUri: input.redirectUri,
          enabled: input.enabled,
        },
      });
    } catch (error) {
      throw new PersistenceError('Failed to save the OIDC connection.', {}, { cause: error });
    }
  }

  async createOidcState(input: {
    readonly id: string;
    readonly stateHash: string;
    readonly nonceCiphertext: string;
    readonly organizationId: string;
    readonly expiresAt: string;
  }): Promise<void> {
    try {
      await this.client.oidcAuthorizationState.create({
        data: {
          id: input.id,
          stateHash: input.stateHash,
          nonceCiphertext: input.nonceCiphertext,
          organizationId: input.organizationId,
          expiresAt: new Date(input.expiresAt),
        },
      });
    } catch (error) {
      throw new PersistenceError('Failed to create an OIDC state.', {}, { cause: error });
    }
  }

  async consumeOidcState(
    stateHash: string,
    nowIso: string,
  ): Promise<OidcAuthorizationStateRecord | null> {
    try {
      const row = await this.client.oidcAuthorizationState.findUnique({ where: { stateHash } });
      if (row === null || row.consumedAt !== null || row.expiresAt.toISOString() <= nowIso) {
        return null;
      }
      const updated = await this.client.oidcAuthorizationState.updateMany({
        where: { id: row.id, consumedAt: null },
        data: { consumedAt: new Date(nowIso) },
      });
      if (updated.count === 0) {
        return null;
      }
      return {
        id: row.id,
        organizationId: row.organizationId,
        nonceCiphertext: row.nonceCiphertext,
      };
    } catch (error) {
      throw new PersistenceError('Failed to consume an OIDC state.', {}, { cause: error });
    }
  }

  async findActiveMembership(
    userId: string,
    organizationId: string,
  ): Promise<IdentityMembership | null> {
    const row = await this.query(() =>
      this.client.organizationMember.findUnique({
        where: { organizationId_userId: { organizationId, userId } },
      }),
    );
    if (row === null || row.status !== 'active') {
      return null;
    }
    return toMembership(row);
  }

  async listMembershipsForUser(userId: string): Promise<readonly IdentityMembership[]> {
    const rows = await this.query(() =>
      this.client.organizationMember.findMany({
        where: { userId, status: 'active' },
      }),
    );
    return rows.map(toMembership);
  }

  async createSession(input: {
    readonly id: string;
    readonly userId: string;
    readonly organizationId: string;
    readonly tokenHash: string;
    readonly expiresAt: string;
  }): Promise<void> {
    try {
      await this.client.session.create({
        data: {
          id: input.id,
          userId: input.userId,
          organizationId: input.organizationId,
          tokenHash: input.tokenHash,
          expiresAt: new Date(input.expiresAt),
        },
      });
    } catch (error) {
      throw new PersistenceError('Failed to create a session.', {}, { cause: error });
    }
  }

  async findValidSessionByTokenHash(
    tokenHash: string,
    nowIso: string,
  ): Promise<ResolvedPrincipalRecord | null> {
    const row = await this.query(() =>
      this.client.session.findUnique({
        where: { tokenHash },
        include: { user: true, organization: true },
      }),
    );
    if (row === null || row.revokedAt !== null || row.expiresAt.toISOString() <= nowIso) {
      return null;
    }
    const membership = await this.findActiveMembership(row.userId, row.organizationId);
    if (
      membership === null ||
      row.user.status !== 'active' ||
      row.organization.status !== 'active'
    ) {
      return null;
    }
    return {
      user: toUser(row.user),
      organization: toOrganization(row.organization),
      membership,
      session: toSession(row),
      apiKey: null,
    };
  }

  async replaceSessionTokenHash(id: string, tokenHash: string): Promise<void> {
    try {
      await this.client.session.update({
        where: { id },
        data: { tokenHash },
      });
    } catch (error) {
      throw new PersistenceError('Failed to rotate the session token hash.', {}, { cause: error });
    }
  }

  async revokeSession(id: string, nowIso: string): Promise<void> {
    try {
      await this.client.session.updateMany({
        where: { id, revokedAt: null },
        data: { revokedAt: new Date(nowIso) },
      });
    } catch (error) {
      throw new PersistenceError('Failed to revoke the session.', {}, { cause: error });
    }
  }

  async touchSession(id: string, nowIso: string): Promise<void> {
    try {
      await this.client.session.updateMany({
        where: { id },
        data: { lastSeenAt: new Date(nowIso) },
      });
    } catch {
      // A missed last-seen write must not fail the request.
    }
  }

  async findApiKeyByPrefix(keyPrefix: string): Promise<IdentityApiKey | null> {
    const row = await this.query(() => this.client.apiKey.findUnique({ where: { keyPrefix } }));
    return row === null ? null : toApiKey(row);
  }

  async touchApiKey(id: string, nowIso: string): Promise<void> {
    try {
      await this.client.apiKey.update({
        where: { id },
        data: { lastUsedAt: new Date(nowIso) },
      });
    } catch {
      // Same as touchSession: telemetry, not a correctness signal.
    }
  }

  async replaceApiKeySecretHash(id: string, secretHash: string): Promise<void> {
    try {
      await this.client.apiKey.update({
        where: { id },
        data: { secretHash },
      });
    } catch (error) {
      throw new PersistenceError('Failed to rotate the API key hash.', {}, { cause: error });
    }
  }

  async listMembers(organizationId: string): Promise<readonly PublicMember[]> {
    const rows = await this.query(() =>
      this.client.organizationMember.findMany({
        where: { organizationId },
        include: { user: true },
        orderBy: { createdAt: 'asc' },
      }),
    );
    return rows.map((row) => ({
      userId: row.user.id,
      email: row.user.email,
      displayName: row.user.displayName,
      role: row.role,
      status: row.status,
    }));
  }

  async listApiKeys(organizationId: string): Promise<readonly PublicApiKey[]> {
    const rows = await this.query(() =>
      this.client.apiKey.findMany({
        where: { organizationId },
        orderBy: { createdAt: 'desc' },
      }),
    );
    return rows.map((row) => ({
      id: row.id,
      keyPrefix: row.keyPrefix,
      label: row.label,
      createdAt: row.createdAt.toISOString(),
      lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
      expiresAt: row.expiresAt?.toISOString() ?? null,
      scopes: parseApiScopes(row.scopes),
      revokedAt: row.revokedAt?.toISOString() ?? null,
    }));
  }

  async upsertOrganization(input: UpsertOrganizationInput): Promise<void> {
    await this.client.organization.upsert({
      where: { id: input.id },
      create: {
        id: input.id,
        name: input.name,
        slug: input.slug,
        countryCode: input.countryCode,
        status: input.status ?? 'active',
        requireMfaForPrivilegedRoles: input.requireMfaForPrivilegedRoles ?? false,
      },
      update: { name: input.name, slug: input.slug, countryCode: input.countryCode },
    });
  }

  async upsertUser(input: UpsertUserInput): Promise<void> {
    await this.client.user.upsert({
      where: { id: input.id },
      create: {
        id: input.id,
        email: input.email.toLowerCase(),
        displayName: input.displayName,
        passwordHash: input.passwordHash,
        passwordSetAt: new Date(),
        status: input.status ?? 'active',
      },
      update: {
        displayName: input.displayName,
        passwordHash: input.passwordHash,
        passwordSetAt: new Date(),
      },
    });
  }

  async upsertMembership(input: UpsertMembershipInput): Promise<void> {
    await this.client.organizationMember.upsert({
      where: {
        organizationId_userId: { organizationId: input.organizationId, userId: input.userId },
      },
      create: {
        id: input.id,
        organizationId: input.organizationId,
        userId: input.userId,
        role: input.role,
        status: input.status ?? 'active',
        joinedAt: new Date(),
      },
      update: { role: input.role, status: input.status ?? 'active' },
    });
  }

  async createApiKey(input: {
    readonly id: string;
    readonly organizationId: string;
    readonly keyPrefix: string;
    readonly secretHash: string;
    readonly label: string;
    readonly createdAt: string;
    readonly scopes: readonly ApiScope[];
    readonly expiresAt: string | null;
  }): Promise<void> {
    await this.client.apiKey.create({
      data: {
        id: input.id,
        organizationId: input.organizationId,
        keyPrefix: input.keyPrefix,
        secretHash: input.secretHash,
        label: input.label,
        createdAt: new Date(input.createdAt),
        scopes: [...input.scopes],
        expiresAt: input.expiresAt === null ? null : new Date(input.expiresAt),
      },
    });
  }

  async revokeApiKey(id: string, organizationId: string, nowIso: string): Promise<boolean> {
    try {
      const existing = await this.client.apiKey.findFirst({
        where: { id, organizationId },
      });
      if (existing === null) {
        return false;
      }
      if (existing.revokedAt !== null) {
        return true;
      }
      await this.client.apiKey.update({
        where: { id },
        data: { revokedAt: new Date(nowIso) },
      });
      return true;
    } catch (error) {
      throw new PersistenceError('Failed to revoke the API key.', {}, { cause: error });
    }
  }

  private async query<TResult>(run: () => Promise<TResult>): Promise<TResult> {
    try {
      return await run();
    } catch (error) {
      throw new PersistenceError('Failed to read identity records.', {}, { cause: error });
    }
  }
}

function toUser(row: {
  id: string;
  email: string;
  displayName: string;
  status: IdentityUser['status'];
  passwordHash: string | null;
}): IdentityUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    status: row.status,
    passwordHash: row.passwordHash,
  };
}

function toOrganization(row: {
  id: string;
  name: string;
  slug: string;
  countryCode: string;
  status: IdentityOrganization['status'];
  requireMfaForPrivilegedRoles: boolean;
}): IdentityOrganization {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    countryCode: row.countryCode,
    status: row.status,
    requireMfaForPrivilegedRoles: row.requireMfaForPrivilegedRoles,
  };
}

function toOidcConnection(row: {
  id: string;
  organizationId: string;
  issuer: string;
  clientId: string;
  clientSecretCiphertext: string | null;
  redirectUri: string;
  enabled: boolean;
}): OidcConnectionRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    issuer: row.issuer,
    clientId: row.clientId,
    clientSecretCiphertext: row.clientSecretCiphertext,
    redirectUri: row.redirectUri,
    enabled: row.enabled,
  };
}

function toMembership(row: {
  id: string;
  organizationId: string;
  userId: string;
  role: IdentityMembership['role'];
  status: IdentityMembership['status'];
}): IdentityMembership {
  return {
    id: row.id,
    organizationId: row.organizationId,
    userId: row.userId,
    role: row.role,
    status: row.status,
  };
}

function toSession(row: {
  id: string;
  userId: string;
  organizationId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
}): IdentitySession {
  return {
    id: row.id,
    userId: row.userId,
    organizationId: row.organizationId,
    tokenHash: row.tokenHash,
    expiresAt: row.expiresAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null,
  };
}

function toApiKey(row: {
  id: string;
  organizationId: string;
  keyPrefix: string;
  secretHash: string;
  label: string;
  scopes: readonly string[];
  expiresAt: Date | null;
  revokedAt: Date | null;
}): IdentityApiKey {
  return {
    id: row.id,
    organizationId: row.organizationId,
    keyPrefix: row.keyPrefix,
    secretHash: row.secretHash,
    label: row.label,
    scopes: parseApiScopes(row.scopes),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
  };
}
