import type { VerifiableExecutionReceipt } from '@meridian/core';
import type { ExecutionReceiptStore } from '@meridian/core';

export class InMemoryExecutionReceiptStore implements ExecutionReceiptStore {
  private readonly byId = new Map<string, VerifiableExecutionReceipt>();
  private readonly byExecution = new Map<string, string>();

  save(row: VerifiableExecutionReceipt): Promise<VerifiableExecutionReceipt> {
    const stored = structuredClone(row);
    this.byId.set(row.id, stored);
    this.byExecution.set(`${row.organizationId}:${row.executionId}`, row.id);
    return Promise.resolve(structuredClone(stored));
  }

  findById(id: string, organizationId: string): Promise<VerifiableExecutionReceipt | null> {
    const found = this.byId.get(id);
    if (found === undefined || found.organizationId !== organizationId) {
      return Promise.resolve(null);
    }
    return Promise.resolve(structuredClone(found));
  }

  findByExecutionId(
    executionId: string,
    organizationId: string,
  ): Promise<VerifiableExecutionReceipt | null> {
    const id = this.byExecution.get(`${organizationId}:${executionId}`);
    if (id === undefined) {
      return Promise.resolve(null);
    }
    return this.findById(id, organizationId);
  }
}
