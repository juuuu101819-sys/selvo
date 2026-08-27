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
import { PersistenceError } from '@meridian/core';
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
  }): Promise<void> {
    await this.client.apiKey.create({
      data: {
        id: input.id,
        organizationId: input.organizationId,
        keyPrefix: input.keyPrefix,
        secretHash: input.secretHash,
        label: input.label,
        createdAt: new Date(input.createdAt),
      },
    });
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
}): IdentityOrganization {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    countryCode: row.countryCode,
    status: row.status,
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
  revokedAt: Date | null;
}): IdentityApiKey {
  return {
    id: row.id,
    organizationId: row.organizationId,
    keyPrefix: row.keyPrefix,
    secretHash: row.secretHash,
    label: row.label,
    revokedAt: row.revokedAt?.toISOString() ?? null,
  };
}
