import { ValidationError } from '../errors/index.js';
import { AssetAmount } from '../money/asset-amount.js';
import { assertAssetCode, toAssetMinorUnits } from './asset.js';
import type { Merchant } from './agent-payments.js';
import type { StructuredNlPaymentIntent } from './nl-intent.js';
import {
  NL_DID_NOT_COMPUTE,
  NL_INTERPRETER,
  type OptimizationPreference,
} from './optimization-preference.js';

/**
 * Turns a sandbox instruction such as `"Pay 1,000 USD to this merchant using the cheapest
 * compliant route."` into structured fields.
 *
 * This is a deterministic parser, not a pricing engine. Agents and LLMs interpret language here
 * and stop. Unknown merchants are a validation error, not a guess. Exchange rates, fees, slippage
 * and settlement amounts are absent on purpose.
 */

export interface ParsedPaymentInstruction {
  readonly sourceAsset: string;
  readonly amountMinorUnits: string;
  readonly amountDecimal: string;
  readonly recipientCode: string;
  readonly destinationAsset: string;
  readonly merchant: Merchant;
  readonly optimizationPreference: OptimizationPreference | null;
  readonly interpreter: typeof NL_INTERPRETER;
  readonly aiUsed: false;
}

const PAY_INSTRUCTION =
  /^\s*(?:please\s+)?pay\s+(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\s+([A-Za-z0-9]{2,16})\s+to\s+(.+?)\s*$/i;

const DEICTIC_MERCHANT = /^(?:this|the|that)\s+merchants?$/i;

const PREFERENCE_CLAUSE =
  /[,\s]+(?:using|via|with|on)\s+(?:the\s+|a\s+)?(?:cheapest|lowest[-\s]cost|fastest|quickest|balanced|lowest\s+slippage|least\s+slippage|minimi[sz]e\s+slippage|high(?:est)?\s+liquidity|most\s+liquid|most\s+economical|least\s+expensive)(?:\s+compliant)?(?:\s+route|\s+path)?\s*$/i;

const LEADING_PREFERENCE_CLAUSE =
  /^(?:please\s+)?(?:using|via|with)\s+(?:the\s+|a\s+)?(?:cheapest|lowest[-\s]cost|fastest|quickest|balanced|lowest\s+slippage|least\s+slippage|high(?:est)?\s+liquidity|most\s+liquid)(?:\s+compliant)?(?:\s+route|\s+path)?[,\s]+/i;

const TRAILING_ASAP = /\s+as\s+soon\s+as\s+possible\s*$/i;

export function parsePayInstruction(
  instruction: string,
  merchants: readonly Merchant[],
): ParsedPaymentInstruction {
  return interpretNaturalLanguagePayment(instruction, merchants);
}

/**
 * Natural-language → structured intent. No financial result is computed here.
 */
export function interpretNaturalLanguagePayment(
  instruction: string,
  merchants: readonly Merchant[],
): ParsedPaymentInstruction {
  const original = instruction.trim();
  if (original === '') {
    throw new ValidationError(
      'Instruction must look like "Pay 1,000 USD to this merchant using the cheapest compliant route."',
      { instruction },
    );
  }

  const { preference, remainder } = splitPreference(original);
  const match = PAY_INSTRUCTION.exec(remainder);
  if (match === null) {
    throw new ValidationError(
      'Instruction must look like "Pay 1,000 USD to this merchant using the cheapest compliant route." Amount, asset and recipient are required.',
      { instruction: original },
    );
  }
  const amountToken = match[1];
  const assetToken = match[2];
  const recipientToken = match[3];
  if (amountToken === undefined || assetToken === undefined || recipientToken === undefined) {
    throw new ValidationError(
      'Instruction must look like "Pay 1,000 USD to this merchant using the cheapest compliant route." Amount, asset and recipient are required.',
      { instruction: original },
    );
  }

  const sourceAsset = assertAssetCode(assetToken.toUpperCase());
  const amountMajor = amountToken.replace(/,/g, '');
  const amountMinorUnits = toAssetMinorUnits(sourceAsset, amountMajor);
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

  const amount = AssetAmount.ofMinorUnits(sourceAsset, amountMinorUnits);

  return {
    sourceAsset,
    amountMinorUnits,
    amountDecimal: amount.toJSON().decimal,
    recipientCode: merchant.recipientCode,
    destinationAsset: merchant.settlementAsset,
    merchant,
    optimizationPreference: preference,
    interpreter: NL_INTERPRETER,
    aiUsed: false,
  };
}

export function toStructuredNlPaymentIntent(
  instruction: string,
  parsed: ParsedPaymentInstruction,
): StructuredNlPaymentIntent {
  const amount = AssetAmount.ofMinorUnits(parsed.sourceAsset, parsed.amountMinorUnits).toJSON();
  return {
    amount,
    sourceAsset: parsed.sourceAsset,
    destinationAsset: parsed.destinationAsset,
    recipient: parsed.recipientCode,
    optimizationPreference: parsed.optimizationPreference,
    instruction,
    interpreter: NL_INTERPRETER,
    aiUsed: false,
    financialsComputedBy: null,
    didNotCompute: NL_DID_NOT_COMPUTE,
    merchant: parsed.merchant,
  };
}

export function resolveMerchant(
  needle: string,
  merchants: readonly Merchant[],
): Merchant | null {
  const normalised = needle.trim().toLowerCase().replace(/[.,;:]+$/g, '');
  if (normalised === '') {
    return null;
  }
  if (DEICTIC_MERCHANT.test(normalised)) {
    const active = merchants.filter((merchant) => merchant.status === 'active');
    if (active.length === 1) {
      const only = active[0];
      return only === undefined ? null : only;
    }
    if (active.length === 0) {
      return null;
    }
    throw new ValidationError(
      'Name the merchant; "this merchant" is ambiguous when several are configured.',
      { recipient: normalised, merchantCount: active.length },
    );
  }

  const withoutArticle = normalised.replace(/^(?:the|this|that)\s+/, '');
  const candidates = [normalised, withoutArticle];
  for (const candidate of candidates) {
    const byCode = merchants.find(
      (merchant) => merchant.recipientCode.toLowerCase() === candidate,
    );
    if (byCode !== undefined) {
      return byCode;
    }
    const byName = merchants.find((merchant) => merchant.name.toLowerCase() === candidate);
    if (byName !== undefined) {
      return byName;
    }
  }
  return null;
}

function splitPreference(instruction: string): {
  readonly preference: OptimizationPreference | null;
  readonly remainder: string;
} {
  const withoutStop = instruction.replace(/\s*[.!]+\s*$/g, '').trim();
  const preference = detectPreference(withoutStop);
  const remainder = withoutStop
    .replace(LEADING_PREFERENCE_CLAUSE, '')
    .replace(PREFERENCE_CLAUSE, '')
    .replace(TRAILING_ASAP, '')
    .trim();
  return { preference, remainder };
}

function detectPreference(instruction: string): OptimizationPreference | null {
  const text = instruction.toLowerCase();
  if (
    /\b(?:lowest|least|minimal)\s+slippage\b/.test(text) ||
    /\bminimi[sz]e\s+slippage\b/.test(text)
  ) {
    return 'LOWEST_SLIPPAGE';
  }
  if (/\b(?:high(?:est)?|deep(?:est)?)\s+liquidity\b/.test(text) || /\bmost\s+liquid\b/.test(text)) {
    return 'HIGH_LIQUIDITY';
  }
  if (
    /\bcheapest\b/.test(text) ||
    /\blowest[-\s]cost\b/.test(text) ||
    /\bleast\s+expensive\b/.test(text) ||
    /\bmost\s+economical\b/.test(text)
  ) {
    return 'LOWEST_COST';
  }
  if (
    /\bfastest\b/.test(text) ||
    /\bquickest\b/.test(text) ||
    /\blowest\s+latency\b/.test(text) ||
    /\bas\s+soon\s+as\s+possible\b/.test(text)
  ) {
    return 'FASTEST';
  }
  if (/\bbalanced\b/.test(text)) {
    return 'BALANCED';
  }
  return null;
}
