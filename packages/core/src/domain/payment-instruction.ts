import { ValidationError } from '../errors/index.js';
import { assertAssetCode, toAssetMinorUnits } from './asset.js';
import type { Merchant } from './agent-payments.js';

/**
 * Turns a sandbox instruction such as `"Pay 500 USD to merchant X"` into structured fields.
 *
 * Agents never compute route economics here — this is a deterministic parser. Unknown merchants
 * are a validation error, not a guess.
 */

export interface ParsedPaymentInstruction {
  readonly sourceAsset: string;
  readonly amountMinorUnits: string;
  readonly recipientCode: string;
  readonly destinationAsset: string;
  readonly merchant: Merchant;
}

const PAY_INSTRUCTION =
  /^\s*pay\s+(\d{1,18}(?:\.\d{1,18})?)\s+([A-Za-z0-9]{2,16})\s+to\s+(.+?)\s*$/i;

export function parsePayInstruction(
  instruction: string,
  merchants: readonly Merchant[],
): ParsedPaymentInstruction {
  const match = PAY_INSTRUCTION.exec(instruction);
  if (match === null) {
    throw new ValidationError(
      'Instruction must look like "Pay 500 USD to merchant X". Amount, asset and recipient are required.',
      { instruction },
    );
  }
  const amount = match[1];
  const assetToken = match[2];
  const recipientToken = match[3];
  if (amount === undefined || assetToken === undefined || recipientToken === undefined) {
    throw new ValidationError(
      'Instruction must look like "Pay 500 USD to merchant X". Amount, asset and recipient are required.',
      { instruction },
    );
  }

  const sourceAsset = assertAssetCode(assetToken.toUpperCase());
  const merchant = resolveMerchant(recipientToken, merchants);
  if (merchant === null) {
    throw new ValidationError(`Unknown recipient "${recipientToken.trim()}".`, {
      recipient: recipientToken.trim(),
    });
  }
  if (merchant.status !== 'active') {
    throw new ValidationError(`Recipient "${merchant.recipientCode}" is not active.`, {
      recipient: merchant.recipientCode,
      status: merchant.status,
    });
  }

  return {
    sourceAsset,
    amountMinorUnits: toAssetMinorUnits(sourceAsset, amount),
    recipientCode: merchant.recipientCode,
    destinationAsset: merchant.settlementAsset,
    merchant,
  };
}

export function resolveMerchant(
  needle: string,
  merchants: readonly Merchant[],
): Merchant | null {
  const normalised = needle.trim().toLowerCase();
  if (normalised === '') {
    return null;
  }
  const byCode = merchants.find(
    (merchant) => merchant.recipientCode.toLowerCase() === normalised,
  );
  if (byCode !== undefined) {
    return byCode;
  }
  return merchants.find((merchant) => merchant.name.toLowerCase() === normalised) ?? null;
}
