import {
  PersistenceError,
  isRoutingComparisonSnapshot,
  type RoutingEvaluationRepository,
  type RoutingEvaluationSurface,
  type StoredRoutingEvaluation,
} from '@meridian/core';
import type { Prisma, PrismaClient } from '@prisma/client';

export class PrismaRoutingEvaluationRepository implements RoutingEvaluationRepository {
  constructor(private readonly client: PrismaClient) {}

  async save(evaluation: StoredRoutingEvaluation): Promise<void> {
    try {
      await this.client.routingEvaluation.create({
        data: {
          routingId: evaluation.routingId,
          fingerprint: evaluation.fingerprint,
          engineVersion: evaluation.engineVersion,
          surface: evaluation.surface,
          organizationId: evaluation.organizationId,
          createdAt: new Date(evaluation.createdAt),
          rankedRouteIds: [...evaluation.rankedRouteIds],
          snapshot: evaluation.snapshot as unknown as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      throw new PersistenceError('Failed to persist the routing evaluation.', {}, { cause: error });
    }
  }

  async findById(routingId: string): Promise<StoredRoutingEvaluation | null> {
    const row = await this.query(() =>
      this.client.routingEvaluation.findUnique({ where: { routingId } }),
    );
    return row === null ? null : toStored(row);
  }

  private async query<TResult>(run: () => Promise<TResult>): Promise<TResult> {
    try {
      return await run();
    } catch (error) {
      throw new PersistenceError('Failed to read routing evaluations.', {}, { cause: error });
    }
  }
}

interface RoutingEvaluationRow {
  readonly routingId: string;
  readonly fingerprint: string;
  readonly engineVersion: string;
  readonly surface: string;
  readonly organizationId: string | null;
  readonly createdAt: Date;
  readonly rankedRouteIds: Prisma.JsonValue;
  readonly snapshot: Prisma.JsonValue;
}

function toStored(row: RoutingEvaluationRow): StoredRoutingEvaluation {
  if (!isRoutingComparisonSnapshot(row.snapshot)) {
    throw new PersistenceError('Stored routing evaluation snapshot is unreadable.', {
      routingId: row.routingId,
    });
  }
  const ranked = Array.isArray(row.rankedRouteIds)
    ? row.rankedRouteIds.filter((item): item is string => typeof item === 'string')
    : [];
  const surface: RoutingEvaluationSurface = row.surface === 'quote' ? 'quote' : 'routes';
  return {
    routingId: row.routingId,
    fingerprint: row.fingerprint,
    engineVersion: row.engineVersion,
    surface,
    organizationId: row.organizationId,
    createdAt: row.createdAt.toISOString(),
    rankedRouteIds: ranked,
    snapshot: row.snapshot,
  };
}
