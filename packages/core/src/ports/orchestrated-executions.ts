import type { OrchestratedExecution, OrchestratedExecutionStatus } from '../domain/execution-orchestration.js';

export interface OrchestratedExecutionStore {
  save(row: OrchestratedExecution): Promise<OrchestratedExecution>;
  update(row: OrchestratedExecution): Promise<OrchestratedExecution>;
  findById(id: string, organizationId: string): Promise<OrchestratedExecution | null>;
  findByIdempotencyKey(
    organizationId: string,
    idempotencyKey: string,
  ): Promise<OrchestratedExecution | null>;
  listByOrganization(organizationId: string): Promise<readonly OrchestratedExecution[]>;
  sumReservedDaily(query: {
    readonly organizationId: string;
    readonly agentId: string;
    readonly asset: string;
    readonly fromInclusive: string;
    readonly toExclusive: string;
    readonly statuses: readonly OrchestratedExecutionStatus[];
    readonly excludeId?: string;
  }): Promise<string>;
}
