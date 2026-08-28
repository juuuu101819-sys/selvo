/**
 * An execution intent is a recorded choice of route, not a payment.
 *
 * `transaction:create` writes one of these. Status is always `recorded` — the choice was persisted,
 * not that a partner ran, settlement was verified, or revenue was realized. `executable` and
 * `submitted` are always false: Meridian does not move money, hold a key, or instruct a partner.
 * There is no `completed` / `settled` value on this model.
 */

export const EXECUTION_INTENT_STATUS = 'recorded' as const;
export type ExecutionIntentStatus = typeof EXECUTION_INTENT_STATUS;

export interface ExecutionIntent {
  readonly id: string;
  readonly organizationId: string;
  readonly requestId: string;
  readonly routeId: string;
  readonly sourceAsset: string;
  readonly destinationAsset: string;
  readonly amountMinorUnits: string;
  readonly status: ExecutionIntentStatus;
  readonly executable: false;
  readonly submitted: false;
  readonly quoteExpiresAt: string | null;
  readonly actor: string;
  readonly createdAt: string;
}

export interface ExecutionIntentRepository {
  create(intent: ExecutionIntent): Promise<ExecutionIntent>;
  findById(id: string, organizationId: string): Promise<ExecutionIntent | null>;
  listByOrganization(
    organizationId: string,
    options?: { readonly limit?: number },
  ): Promise<readonly ExecutionIntent[]>;
}
