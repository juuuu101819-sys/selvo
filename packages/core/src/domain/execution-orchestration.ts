/**
 * Sandbox execution orchestration.
 *
 * Meridian records mandate + route intent, forwards a partner-credential HMAC over an instruction,
 * and records partner-reported status. It never holds funds, customer private keys, or wallets.
 * `transferSigned` is always false: the HMAC covers the instruction envelope, not a funds transfer.
 */

export const ORCHESTRATED_EXECUTION_STATUSES = [
  'CREATED',
  'ROUTED',
  'COMPLIANCE_PASSED',
  'COMPLIANCE_REVIEW',
  'BLOCKED',
  'EXPIRED',
  'DISPATCHED',
  'SETTLING',
  'SETTLED',
  'FAILED',
] as const;
export type OrchestratedExecutionStatus = (typeof ORCHESTRATED_EXECUTION_STATUSES)[number];

export const TERMINAL_ORCHESTRATION_STATUSES: readonly OrchestratedExecutionStatus[] = [
  'BLOCKED',
  'EXPIRED',
  'SETTLED',
  'FAILED',
];

export const COMPLIANCE_OUTCOMES = ['pass', 'deny', 'review'] as const;
export type ComplianceOutcome = (typeof COMPLIANCE_OUTCOMES)[number];

/** Vault key name for partner-scoped instruction HMAC material. Never a customer private key. */
export const PARTNER_INSTRUCTION_HMAC_KEY_NAME = 'instruction_hmac';

export const INSTRUCTION_SIGNATURE_KIND = 'partner_credential_hmac' as const;
export type InstructionSignatureKind = typeof INSTRUCTION_SIGNATURE_KIND;

export const ORCHESTRATION_DAILY_RESERVE_STATUSES: readonly OrchestratedExecutionStatus[] = [
  'COMPLIANCE_PASSED',
  'DISPATCHED',
  'SETTLING',
  'SETTLED',
];

export function isOrchestratedExecutionStatus(
  value: unknown,
): value is OrchestratedExecutionStatus {
  return (
    typeof value === 'string' &&
    (ORCHESTRATED_EXECUTION_STATUSES as readonly string[]).includes(value)
  );
}

export function isComplianceOutcome(value: unknown): value is ComplianceOutcome {
  return typeof value === 'string' && (COMPLIANCE_OUTCOMES as readonly string[]).includes(value);
}

export function isTerminalOrchestrationStatus(status: OrchestratedExecutionStatus): boolean {
  return (TERMINAL_ORCHESTRATION_STATUSES as readonly string[]).includes(status);
}

/**
 * Canonical instruction fields that Meridian may HMAC. Anything resembling a transfer, account,
 * wallet, or customer key is forbidden on this envelope.
 */
export const PARTNER_INSTRUCTION_PAYLOAD_KEYS = [
  'quoteReference',
  'sourceAsset',
  'destinationAsset',
  'amountMinorUnits',
  'beneficiaryRef',
  'signedAt',
  'sandboxScenario',
  'purpose',
] as const;

export const FORBIDDEN_INSTRUCTION_PAYLOAD_KEYS = [
  'account',
  'accountNumber',
  'iban',
  'wallet',
  'privateKey',
  'secret',
  'transfer',
  'payout',
  'balance',
] as const;

export interface OrchestratedExecution {
  readonly id: string;
  readonly organizationId: string;
  readonly agentId: string;
  readonly mandateId: string;
  readonly routingId: string;
  readonly routeId: string;
  readonly partnerId: string | null;
  readonly partnerInstructionId: string | null;
  readonly status: OrchestratedExecutionStatus;
  readonly sourceAsset: string;
  readonly destinationAsset: string;
  readonly amountMinorUnits: string;
  readonly filledMinorUnits: string;
  readonly quoteExpiresAt: string | null;
  readonly quotedAt: string | null;
  readonly dispatchedAt: string | null;
  readonly settledAt: string | null;
  readonly receiptId: string | null;
  readonly beneficiaryRef: string;
  readonly idempotencyKey: string | null;
  readonly payloadFingerprint: string;
  readonly failureCode: string | null;
  readonly blockedReason: string | null;
  readonly dailyLimitReserved: boolean;
  readonly instructionHash: string | null;
  readonly signatureHash: string | null;
  readonly instructionSignatureKind: InstructionSignatureKind | null;
  readonly transferSigned: false;
  readonly fundsMoved: false;
  readonly custody: false;
  readonly meridianKeysUsed: false;
  readonly sandbox: true;
  readonly failoverFrom: readonly string[];
  readonly monetizationEventId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function assertNonCustodialExecution(row: OrchestratedExecution): void {
  if (row.fundsMoved !== false || row.custody !== false || row.meridianKeysUsed !== false) {
    throw new Error('Orchestrated execution violated the non-custodial invariant.');
  }
  if (row.transferSigned !== false) {
    throw new Error('Orchestrated execution must not sign a funds transfer.');
  }
}
