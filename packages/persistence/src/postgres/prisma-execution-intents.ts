import {
  PersistenceError,
  type ExecutionIntent,
  type ExecutionIntentRepository,
  type ListCursor,
} from '@meridian/core';
import { Prisma, type PrismaClient } from '@prisma/client';
import { descKeysetWhere } from './keyset.js';

const DEFAULT_LIST_LIMIT = 50;

export class PrismaExecutionIntentRepository implements ExecutionIntentRepository {
  constructor(private readonly client: PrismaClient) {}

  async create(intent: ExecutionIntent): Promise<ExecutionIntent> {
    try {
      const row = await this.client.executionIntent.create({
        data: {
          id: intent.id,
          organizationId: intent.organizationId,
          requestId: intent.requestId,
          routeId: intent.routeId,
          sourceAsset: intent.sourceAsset,
          destinationAsset: intent.destinationAsset,
          amountMinorUnits: new Prisma.Decimal(intent.amountMinorUnits),
          status: 'recorded',
          executable: false,
          submitted: false,
          quoteExpiresAt: intent.quoteExpiresAt === null ? null : new Date(intent.quoteExpiresAt),
          actor: intent.actor,
          createdAt: new Date(intent.createdAt),
        },
      });
      return toExecutionIntent(row);
    } catch (error) {
      throw new PersistenceError('Failed to record the execution intent.', {}, { cause: error });
    }
  }

  async findById(id: string, organizationId: string): Promise<ExecutionIntent | null> {
    const row = await this.query(() =>
      this.client.executionIntent.findFirst({ where: { id, organizationId } }),
    );
    return row === null ? null : toExecutionIntent(row);
  }

  async listByOrganization(
    organizationId: string,
    options: { readonly limit?: number; readonly after?: ListCursor } = {},
  ): Promise<readonly ExecutionIntent[]> {
    const rows = await this.query(() =>
      this.client.executionIntent.findMany({
        where: {
          organizationId,
          ...descKeysetWhere(options.after, 'createdAt', 'id'),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: options.limit ?? DEFAULT_LIST_LIMIT,
      }),
    );
    return rows.map(toExecutionIntent);
  }

  private async query<TResult>(run: () => Promise<TResult>): Promise<TResult> {
    try {
      return await run();
    } catch (error) {
      throw new PersistenceError('Failed to read execution intents.', {}, { cause: error });
    }
  }
}

interface ExecutionIntentRow {
  readonly id: string;
  readonly organizationId: string;
  readonly requestId: string;
  readonly routeId: string;
  readonly sourceAsset: string;
  readonly destinationAsset: string;
  readonly amountMinorUnits: { toFixed(decimalPlaces?: number): string };
  readonly status: string;
  readonly executable: boolean;
  readonly submitted: boolean;
  readonly quoteExpiresAt: Date | null;
  readonly actor: string;
  readonly createdAt: Date;
}

export function toExecutionIntent(row: ExecutionIntentRow): ExecutionIntent {
  return {
    id: row.id,
    organizationId: row.organizationId,
    requestId: row.requestId,
    routeId: row.routeId,
    sourceAsset: row.sourceAsset,
    destinationAsset: row.destinationAsset,
    amountMinorUnits: row.amountMinorUnits.toFixed(0),
    status: 'recorded',
    executable: false,
    submitted: false,
    quoteExpiresAt: row.quoteExpiresAt?.toISOString() ?? null,
    actor: row.actor,
    createdAt: row.createdAt.toISOString(),
  };
}
