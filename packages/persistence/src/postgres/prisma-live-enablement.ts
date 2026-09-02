import {
  PersistenceError,
  type LiveEnablementRecord,
  type LiveEnablementScope,
  type LiveEnablementStore,
} from '@meridian/core';
import type { PrismaClient } from '@prisma/client';

export class PrismaLiveEnablementStore implements LiveEnablementStore {
  constructor(private readonly client: PrismaClient) {}

  async upsert(record: LiveEnablementRecord): Promise<LiveEnablementRecord> {
    try {
      const row = await this.client.liveEnablement.upsert({
        where: { scope_scopeKey: { scope: record.scope, scopeKey: record.scopeKey } },
        create: toRow(record),
        update: {
          region: record.region,
          enabled: record.enabled,
          approvedBy: record.signOff.approvedBy,
          licenseBasis: record.signOff.licenseBasis,
          approvedAt: new Date(record.signOff.approvedAt),
          expiresAt: new Date(record.signOff.expiresAt),
          checklistRef: record.signOff.checklistRef,
          updatedAt: new Date(record.updatedAt),
          disabledAt: record.disabledAt === null ? null : new Date(record.disabledAt),
          disabledReason: record.disabledReason,
        },
      });
      return fromRow(row);
    } catch (error) {
      throw new PersistenceError('Failed to upsert live enablement.', {}, { cause: error });
    }
  }

  async find(scope: LiveEnablementScope, scopeKey: string): Promise<LiveEnablementRecord | null> {
    try {
      const row = await this.client.liveEnablement.findUnique({
        where: { scope_scopeKey: { scope, scopeKey } },
      });
      return row === null ? null : fromRow(row);
    } catch (error) {
      throw new PersistenceError('Failed to load live enablement.', {}, { cause: error });
    }
  }

  async list(): Promise<readonly LiveEnablementRecord[]> {
    try {
      const rows = await this.client.liveEnablement.findMany({
        orderBy: [{ scope: 'asc' }, { scopeKey: 'asc' }],
      });
      return rows.map(fromRow);
    } catch (error) {
      throw new PersistenceError('Failed to list live enablement.', {}, { cause: error });
    }
  }
}

function toRow(record: LiveEnablementRecord): {
  readonly id: string;
  readonly scope: string;
  readonly scopeKey: string;
  readonly region: string;
  readonly enabled: boolean;
  readonly approvedBy: string;
  readonly licenseBasis: string;
  readonly approvedAt: Date;
  readonly expiresAt: Date;
  readonly checklistRef: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly disabledAt: Date | null;
  readonly disabledReason: string | null;
} {
  return {
    id: record.id,
    scope: record.scope,
    scopeKey: record.scopeKey,
    region: record.region,
    enabled: record.enabled,
    approvedBy: record.signOff.approvedBy,
    licenseBasis: record.signOff.licenseBasis,
    approvedAt: new Date(record.signOff.approvedAt),
    expiresAt: new Date(record.signOff.expiresAt),
    checklistRef: record.signOff.checklistRef,
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
    disabledAt: record.disabledAt === null ? null : new Date(record.disabledAt),
    disabledReason: record.disabledReason,
  };
}

function fromRow(row: {
  id: string;
  scope: string;
  scopeKey: string;
  region: string;
  enabled: boolean;
  approvedBy: string;
  licenseBasis: string;
  approvedAt: Date;
  expiresAt: Date;
  checklistRef: string;
  createdAt: Date;
  updatedAt: Date;
  disabledAt: Date | null;
  disabledReason: string | null;
}): LiveEnablementRecord {
  const scope: LiveEnablementScope =
    row.scope === 'partner' ? 'partner' : row.scope === 'billing' ? 'billing' : 'corridor';
  return {
    id: row.id,
    scope,
    scopeKey: row.scopeKey,
    region: row.region,
    enabled: row.enabled,
    signOff: {
      approvedBy: row.approvedBy,
      licenseBasis: row.licenseBasis,
      approvedAt: row.approvedAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      checklistRef: row.checklistRef,
    },
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    disabledAt: row.disabledAt?.toISOString() ?? null,
    disabledReason: row.disabledReason,
  };
}
