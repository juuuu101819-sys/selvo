import type {
  CustomerCounterSignature,
  SignedSettlementInstruction,
} from '../domain/settlement-instruction.js';
import type { ListCursor } from '../pagination/cursor.js';

/**
 * Storage for generated settlement instructions.
 *
 * Note what is absent: there is no `markDispatched`, no `markSubmitted`, and no status column to
 * advance. An instruction has exactly two states a writer can produce — generated, and generated
 * with a customer signature attached — because Meridian's involvement ends when it returns the
 * artifact. Anything that happens afterwards happens at the customer's provider and is not
 * Meridian's to record here.
 */
export interface SettlementInstructionStore {
  create(instruction: SignedSettlementInstruction): Promise<SignedSettlementInstruction>;
  findById(id: string, organizationId: string): Promise<SignedSettlementInstruction | null>;
  listByOrganization(
    organizationId: string,
    options?: { readonly limit?: number; readonly after?: ListCursor },
  ): Promise<readonly SignedSettlementInstruction[]>;
  attachCustomerSignature(
    id: string,
    organizationId: string,
    signature: CustomerCounterSignature,
  ): Promise<SignedSettlementInstruction>;
}
