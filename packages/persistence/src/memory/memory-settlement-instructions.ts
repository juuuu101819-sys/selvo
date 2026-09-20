import {
  NotFoundError,
  takeKeysetPage,
  type CustomerCounterSignature,
  type ListCursor,
  type SettlementInstructionStore,
  type SignedSettlementInstruction,
} from '@meridian/core';

const DEFAULT_LIST_LIMIT = 50;

/**
 * In-process settlement instructions.
 *
 * Mirrors the PostgreSQL driver in the one respect that matters: there is no operation that marks
 * an instruction as sent. The artifact is created, optionally counter-signed by the customer, and
 * read. Meridian's part is over once it has been returned.
 */
export class InMemorySettlementInstructionStore implements SettlementInstructionStore {
  private readonly byId = new Map<string, SignedSettlementInstruction>();

  create(instruction: SignedSettlementInstruction): Promise<SignedSettlementInstruction> {
    // A stored instruction never arrives already counter-signed: the customer signs after they
    // receive it, which cannot have happened yet.
    const stored: SignedSettlementInstruction = { ...instruction, customerSignature: null };
    this.byId.set(stored.id, structuredClone(stored));
    return Promise.resolve(structuredClone(stored));
  }

  findById(id: string, organizationId: string): Promise<SignedSettlementInstruction | null> {
    const found = this.byId.get(id);
    if (found === undefined || found.organizationId !== organizationId) {
      return Promise.resolve(null);
    }
    return Promise.resolve(structuredClone(found));
  }

  listByOrganization(
    organizationId: string,
    options: { readonly limit?: number; readonly after?: ListCursor } = {},
  ): Promise<readonly SignedSettlementInstruction[]> {
    const limit = options.limit ?? DEFAULT_LIST_LIMIT;
    const page = takeKeysetPage(
      [...this.byId.values()].filter(
        (instruction) => instruction.organizationId === organizationId,
      ),
      { limit, ...(options.after === undefined ? {} : { after: options.after }) },
      (instruction) => ({ sortAt: instruction.createdAt, id: instruction.id }),
    );
    return Promise.resolve(page.map((instruction) => structuredClone(instruction)));
  }

  attachCustomerSignature(
    id: string,
    organizationId: string,
    signature: CustomerCounterSignature,
  ): Promise<SignedSettlementInstruction> {
    const found = this.byId.get(id);
    if (found === undefined || found.organizationId !== organizationId) {
      return Promise.reject(new NotFoundError('SettlementInstruction', id));
    }
    const updated: SignedSettlementInstruction = {
      ...found,
      customerSignature: { ...signature, triggeredDispatch: false },
    };
    this.byId.set(id, structuredClone(updated));
    return Promise.resolve(structuredClone(updated));
  }
}
