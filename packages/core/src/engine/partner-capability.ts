import { createHash } from 'node:crypto';
import { Dec } from '../money/index.js';
import { canonicalJson } from '../reproducibility/canonical-json.js';
import type {
  ExecutionPartnerCapabilities,
  PartnerOperatingHours,
  SignedExecutionInstruction,
} from '../ports/execution-partner.js';

export interface PartnerMatchRequest {
  readonly sourceAsset: string;
  readonly destinationAsset: string;
  readonly amountMinorUnits: string;
  readonly atIso: string;
}

/**
 * Hard constraint for dispatch routing: corridor, currency, notional, and operating hours.
 * Unknown coverage fails closed (the partner is ineligible).
 */
export function partnerSupportsRequest(
  capabilities: ExecutionPartnerCapabilities,
  request: PartnerMatchRequest,
): boolean {
  if (capabilities.live) {
    return false;
  }
  if (!corridorAllowed(capabilities, request.sourceAsset, request.destinationAsset)) {
    return false;
  }
  if (
    !capabilities.currencies.includes('*') &&
    (!capabilities.currencies.includes(request.sourceAsset) ||
      !capabilities.currencies.includes(request.destinationAsset))
  ) {
    return false;
  }
  if (request.sourceAsset === capabilities.maxAmountAsset) {
    const amount = new Dec(request.amountMinorUnits);
    if (amount.lt(new Dec(capabilities.minAmountMinorUnits))) {
      return false;
    }
    if (amount.gt(new Dec(capabilities.maxAmountMinorUnits))) {
      return false;
    }
  }
  return hoursOpen(capabilities.operatingHours, request.atIso);
}

export function corridorAllowed(
  capabilities: ExecutionPartnerCapabilities,
  source: string,
  destination: string,
): boolean {
  return capabilities.corridors.some(
    (corridor) =>
      (corridor.source === '*' || corridor.source === source) &&
      (corridor.destination === '*' || corridor.destination === destination),
  );
}

export function hoursOpen(hours: PartnerOperatingHours, atIso: string): boolean {
  const at = new Date(atIso);
  if (Number.isNaN(at.getTime())) {
    return false;
  }
  const day = at.getUTCDay();
  if (hours.daysOfWeek.length > 0 && !hours.daysOfWeek.includes(day)) {
    return false;
  }
  const minutes = at.getUTCHours() * 60 + at.getUTCMinutes();
  return minutes >= hours.startUtcMinutes && minutes < hours.endUtcMinutes;
}

/** SHA-256 of the instruction without the signature (and without any account/PII fields). */
export function hashExecutionInstruction(instruction: SignedExecutionInstruction): {
  readonly instructionHash: string;
  readonly signatureHash: string;
} {
  return {
    instructionHash: sha256Hex(
      canonicalJson({
        quoteReference: instruction.quoteReference,
        sourceAsset: instruction.sourceAsset,
        destinationAsset: instruction.destinationAsset,
        amountMinorUnits: instruction.amountMinorUnits,
        beneficiaryRef: instruction.beneficiaryRef,
        signedAt: instruction.signedAt,
        sandboxScenario: instruction.sandboxScenario,
      }),
    ),
    signatureHash: sha256Hex(instruction.signature),
  };
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
