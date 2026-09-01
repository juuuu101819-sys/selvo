import type { PartnerInstructionStore, StoredPartnerInstruction } from '@meridian/core';

export class InMemoryPartnerInstructionStore implements PartnerInstructionStore {
  private readonly byId = new Map<string, StoredPartnerInstruction>();

  save(row: StoredPartnerInstruction): Promise<StoredPartnerInstruction> {
    const stored = structuredClone(row);
    this.byId.set(row.id, stored);
    return Promise.resolve(structuredClone(stored));
  }

  update(row: StoredPartnerInstruction): Promise<StoredPartnerInstruction> {
    const existing = this.byId.get(row.id);
    if (existing === undefined) {
      return Promise.reject(new Error(`Unknown partner instruction "${row.id}".`));
    }
    const stored = structuredClone(row);
    this.byId.set(row.id, stored);
    return Promise.resolve(structuredClone(stored));
  }

  findById(id: string, organizationId: string): Promise<StoredPartnerInstruction | null> {
    const found = this.byId.get(id);
    if (found === undefined || found.organizationId !== organizationId) {
      return Promise.resolve(null);
    }
    return Promise.resolve(structuredClone(found));
  }

  findByIdAnyTenant(id: string): Promise<StoredPartnerInstruction | null> {
    const found = this.byId.get(id);
    return Promise.resolve(found === undefined ? null : structuredClone(found));
  }
}
