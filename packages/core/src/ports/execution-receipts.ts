import type { VerifiableExecutionReceipt } from '../domain/execution-receipt.js';

export interface ExecutionReceiptStore {
  save(row: VerifiableExecutionReceipt): Promise<VerifiableExecutionReceipt>;
  findById(id: string, organizationId: string): Promise<VerifiableExecutionReceipt | null>;
  findByExecutionId(
    executionId: string,
    organizationId: string,
  ): Promise<VerifiableExecutionReceipt | null>;
}
