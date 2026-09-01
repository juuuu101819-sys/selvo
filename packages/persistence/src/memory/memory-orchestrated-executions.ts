import { IdempotencyConflictError } from '@meridian/core';
import type {
  OrchestratedExecution,
  OrchestratedExecutionStatus,
} from '@meridian/core';
import type { OrchestratedExecutionStore } from '@meridian/core';

export class InMemoryOrchestratedExecutionStore implements OrchestratedExecutionStore {
  private readonly byId = new Map<string, OrchestratedExecution>();
  private readonly byIdempotency = new Map<string, string>();

  save(row: OrchestratedExecution): Promise<OrchestratedExecution> {
    if (row.idempotencyKey !== null) {
      const key = `${row.organizationId}:${row.idempotencyKey}`;
      const existingId = this.byIdempotency.get(key);
      if (existingId !== undefined && existingId !== row.id) {
        return Promise.reject(new IdempotencyConflictError(row.idempotencyKey));
      }
      this.byIdempotency.set(key, row.id);
    }
    const stored = structuredClone(row);
    this.byId.set(row.id, stored);
    return Promise.resolve(structuredClone(stored));
  }

  update(row: OrchestratedExecution): Promise<OrchestratedExecution> {
    if (!this.byId.has(row.id)) {
      return Promise.reject(new Error(`Unknown orchestrated execution "${row.id}".`));
    }
    const stored = structuredClone(row);
    this.byId.set(row.id, stored);
    return Promise.resolve(structuredClone(stored));
  }

  findById(id: string, organizationId: string): Promise<OrchestratedExecution | null> {
    const found = this.byId.get(id);
    if (found === undefined || found.organizationId !== organizationId) {
      return Promise.resolve(null);
    }
    return Promise.resolve(structuredClone(found));
  }

  findByIdempotencyKey(
    organizationId: string,
    idempotencyKey: string,
  ): Promise<OrchestratedExecution | null> {
    const id = this.byIdempotency.get(`${organizationId}:${idempotencyKey}`);
    if (id === undefined) {
      return Promise.resolve(null);
    }
    return this.findById(id, organizationId);
  }

  listByOrganization(organizationId: string): Promise<readonly OrchestratedExecution[]> {
    const rows = [...this.byId.values()]
      .filter((row) => row.organizationId === organizationId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map((row) => structuredClone(row));
    return Promise.resolve(rows);
  }

  sumReservedDaily(query: {
    readonly organizationId: string;
    readonly agentId: string;
    readonly asset: string;
    readonly fromInclusive: string;
    readonly toExclusive: string;
    readonly statuses: readonly OrchestratedExecutionStatus[];
    readonly excludeId?: string;
  }): Promise<string> {
    let total = 0n;
    for (const row of this.byId.values()) {
      if (row.organizationId !== query.organizationId || row.agentId !== query.agentId) {
        continue;
      }
      if (!row.dailyLimitReserved) {
        continue;
      }
      if (row.sourceAsset !== query.asset) {
        continue;
      }
      if (row.createdAt < query.fromInclusive || row.createdAt >= query.toExclusive) {
        continue;
      }
      if (!query.statuses.includes(row.status)) {
        continue;
      }
      if (query.excludeId !== undefined && row.id === query.excludeId) {
        continue;
      }
      total += BigInt(row.amountMinorUnits);
    }
    return Promise.resolve(total.toString());
  }
}
