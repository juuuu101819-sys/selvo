import { createHmac } from 'node:crypto';
import { canonicalJson } from '../reproducibility/canonical-json.js';
import {
  FORBIDDEN_INSTRUCTION_PAYLOAD_KEYS,
  PARTNER_INSTRUCTION_PAYLOAD_KEYS,
} from '../domain/execution-orchestration.js';
import type { SandboxPartnerScenario } from '../ports/execution-partner.js';

export interface PartnerInstructionHmacPayload {
  readonly quoteReference: string;
  readonly sourceAsset: string;
  readonly destinationAsset: string;
  readonly amountMinorUnits: string;
  readonly beneficiaryRef: string | null;
  readonly signedAt: string;
  readonly sandboxScenario: SandboxPartnerScenario;
  readonly purpose: 'partner_instruction';
}

/**
 * HMAC-SHA256 over the canonical instruction envelope using a vault partner-scoped secret.
 *
 * This is not a funds-transfer signature. The payload cannot name accounts, wallets, or keys.
 */
export function partnerInstructionHmacPayload(
  input: Omit<PartnerInstructionHmacPayload, 'purpose'>,
): PartnerInstructionHmacPayload {
  const payload: PartnerInstructionHmacPayload = {
    quoteReference: input.quoteReference,
    sourceAsset: input.sourceAsset,
    destinationAsset: input.destinationAsset,
    amountMinorUnits: input.amountMinorUnits,
    beneficiaryRef: input.beneficiaryRef,
    signedAt: input.signedAt,
    sandboxScenario: input.sandboxScenario,
    purpose: 'partner_instruction',
  };
  assertInstructionPayloadKeys(payload as unknown as Record<string, unknown>);
  return payload;
}

export function signPartnerInstructionHmac(
  payload: PartnerInstructionHmacPayload,
  partnerCredential: string,
): string {
  assertInstructionPayloadKeys(payload as unknown as Record<string, unknown>);
  return createHmac('sha256', partnerCredential).update(canonicalJson(payload), 'utf8').digest('hex');
}

export function sandboxPartnerHmacSecret(partnerId: string): string {
  return `sandbox-instruction-hmac:${partnerId}`;
}

export function assertInstructionPayloadKeys(payload: Record<string, unknown>): void {
  const keys = Object.keys(payload);
  for (const key of keys) {
    if (
      (FORBIDDEN_INSTRUCTION_PAYLOAD_KEYS as readonly string[]).includes(key) ||
      !(PARTNER_INSTRUCTION_PAYLOAD_KEYS as readonly string[]).includes(key)
    ) {
      throw new Error(`Instruction payload key "${key}" is not permitted.`);
    }
  }
}
