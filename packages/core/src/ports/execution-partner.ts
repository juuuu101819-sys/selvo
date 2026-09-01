import type { JsonObject } from '../domain/json.js';
import type { ProviderDescriptor } from '../domain/provider.js';
import type { NormalizedQuote, NormalizedQuoteRequest } from './financial-provider.js';
import type { ProviderContext } from './provider-adapter.js';

/**
 * Execution-partner adapters.
 *
 * Meridian forwards a caller-signed instruction and records partner-reported status. The partner
 * pays the beneficiary. No funds, keys, or wallets pass through this process.
 */

export const EXECUTION_PARTNER_KINDS = ['sandbox_mock', 'live'] as const;
export type ExecutionPartnerKind = (typeof EXECUTION_PARTNER_KINDS)[number];

export const PARTNER_INSTRUCTION_STATUSES = [
  'accepted',
  'settling',
  'partial',
  'settled',
  'failed',
] as const;
export type PartnerInstructionStatus = (typeof PARTNER_INSTRUCTION_STATUSES)[number];

export const SANDBOX_PARTNER_SCENARIOS = ['settle', 'fail', 'partial', 'webhook'] as const;
export type SandboxPartnerScenario = (typeof SANDBOX_PARTNER_SCENARIOS)[number];

export interface PartnerCorridor {
  readonly source: string;
  readonly destination: string;
}

/** UTC window. An empty `daysOfWeek` means every day. `endUtcMinutes` is exclusive. */
export interface PartnerOperatingHours {
  readonly timezone: 'UTC';
  readonly daysOfWeek: readonly number[];
  readonly startUtcMinutes: number;
  readonly endUtcMinutes: number;
}

export interface ExecutionPartnerCapabilities {
  readonly partnerId: string;
  readonly kind: ExecutionPartnerKind;
  readonly rail: 'bank_fx' | 'payment_institution' | 'stablecoin_settlement';
  readonly quotedProviderId: string;
  readonly corridors: readonly PartnerCorridor[];
  readonly currencies: readonly string[];
  readonly minAmountMinorUnits: string;
  readonly maxAmountMinorUnits: string;
  readonly maxAmountAsset: string;
  readonly operatingHours: PartnerOperatingHours;
  readonly licenses: readonly string[];
  /** Always true for registered adapters in this tree. Live partners are not implemented. */
  readonly sandbox: boolean;
  readonly live: boolean;
}

/**
 * Caller-signed instruction. Meridian does not generate the signature or hold `d`.
 *
 * `beneficiaryRef` is an opaque code (for example a merchant id), never an account number.
 * `signature` is hashed at the boundary; the raw value is not persisted.
 */
export interface SignedExecutionInstruction {
  readonly quoteReference: string;
  readonly sourceAsset: string;
  readonly destinationAsset: string;
  readonly amountMinorUnits: string;
  readonly beneficiaryRef: string | null;
  readonly signedAt: string;
  readonly signature: string;
  readonly sandboxScenario: SandboxPartnerScenario;
}

export interface PartnerExecutionContext extends ProviderContext {
  readonly organizationId: string;
  readonly executionRef: string;
  readonly actor: string;
}

export interface PartnerDispatchResult {
  readonly executionRef: string;
  readonly partnerId: string;
  readonly status: PartnerInstructionStatus;
  readonly filledMinorUnits: string;
  readonly failureCode: string | null;
  readonly fundsMoved: false;
  readonly custody: false;
  readonly meridianKeysUsed: false;
}

export interface PartnerWebhookEvent {
  readonly executionRef: string;
  readonly status: Extract<PartnerInstructionStatus, 'settling' | 'partial' | 'settled' | 'failed'>;
  readonly filledMinorUnits: string | null;
  readonly reasonCode: string | null;
}

/**
 * Licensed (or sandbox-mock) venue that settles to the beneficiary itself.
 *
 * Implementations MUST NOT accept customer funds, hold private keys, or submit as Meridian.
 */
export interface ExecutionPartner {
  readonly kind: ExecutionPartnerKind;
  readonly descriptor: ProviderDescriptor;
  readonly capabilities: ExecutionPartnerCapabilities;
  quote(request: NormalizedQuoteRequest, context: ProviderContext): Promise<NormalizedQuote>;
  dispatchInstruction(
    instruction: SignedExecutionInstruction,
    context: PartnerExecutionContext,
  ): Promise<PartnerDispatchResult>;
  getExecutionStatus(ref: string, context: PartnerExecutionContext): Promise<PartnerDispatchResult>;
  handleWebhook(
    event: PartnerWebhookEvent,
    context: PartnerExecutionContext,
  ): Promise<PartnerDispatchResult>;
}

export interface StoredPartnerInstruction {
  readonly id: string;
  readonly organizationId: string;
  readonly partnerId: string;
  readonly quotedProviderId: string;
  readonly status: PartnerInstructionStatus;
  readonly sourceAsset: string;
  readonly destinationAsset: string;
  readonly amountMinorUnits: string;
  readonly filledMinorUnits: string;
  readonly instructionHash: string;
  readonly signatureHash: string;
  readonly failureCode: string | null;
  readonly sandboxScenario: SandboxPartnerScenario;
  readonly failoverFrom: readonly string[];
  readonly fundsMoved: false;
  readonly custody: false;
  readonly meridianKeysUsed: false;
  readonly sandbox: true;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly metadata: JsonObject;
}

export interface PartnerInstructionStore {
  save(row: StoredPartnerInstruction): Promise<StoredPartnerInstruction>;
  update(row: StoredPartnerInstruction): Promise<StoredPartnerInstruction>;
  findById(id: string, organizationId: string): Promise<StoredPartnerInstruction | null>;
  findByIdAnyTenant(id: string): Promise<StoredPartnerInstruction | null>;
}

export function isExecutionPartnerKind(value: unknown): value is ExecutionPartnerKind {
  return typeof value === 'string' && (EXECUTION_PARTNER_KINDS as readonly string[]).includes(value);
}

export function isPartnerInstructionStatus(value: unknown): value is PartnerInstructionStatus {
  return (
    typeof value === 'string' && (PARTNER_INSTRUCTION_STATUSES as readonly string[]).includes(value)
  );
}

export function isSandboxPartnerScenario(value: unknown): value is SandboxPartnerScenario {
  return typeof value === 'string' && (SANDBOX_PARTNER_SCENARIOS as readonly string[]).includes(value);
}

export const ALWAYS_OPEN_HOURS: PartnerOperatingHours = {
  timezone: 'UTC',
  daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
  startUtcMinutes: 0,
  endUtcMinutes: 1440,
};
