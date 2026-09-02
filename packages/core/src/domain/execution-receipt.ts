/**
 * Verifiable sandbox execution receipts.
 *
 * Meridian Ed25519-signs a canonical payload that binds mandate reference, selected-route
 * rationale, partner settlement hashes, and timestamps. The private key stays in the vault.
 * The payload carries hashes and catalog identifiers, never raw PII, accounts, wallets, or keys.
 */

export const RECEIPT_VERSION = '1' as const;
export const RECEIPT_PURPOSE = 'execution_receipt' as const;
export const RECEIPT_SIGNATURE_ALGORITHM = 'Ed25519' as const;
export const RECEIPT_CANONICALIZATION = 'canonical-json' as const;

/** Vault provider id for the platform receipt signer. Not a customer and not a licensed partner. */
export const RECEIPT_VAULT_PROVIDER_ID = 'meridian-receipt-signer';
/** Vault key name. PKCS8 Ed25519 private key, never a customer `d`. */
export const RECEIPT_VAULT_KEY_NAME = 'receipt_ed25519';

export const FORBIDDEN_RECEIPT_PAYLOAD_KEYS = [
  'account',
  'accountNumber',
  'iban',
  'wallet',
  'privateKey',
  'secret',
  'email',
  'displayName',
  'beneficiaryRef',
  'beneficiary',
] as const;

export interface ReceiptMandateReference {
  readonly id: string;
  readonly issuer: string;
  readonly agentId: string;
  readonly format: string;
  readonly payloadHash: string;
  readonly scopeHash: string;
  readonly spendCapAsset: string;
  readonly spendCapMinorUnits: string;
  readonly allowedCorridors: readonly { readonly source: string; readonly destination: string }[];
  readonly allowedCurrencies: readonly string[];
  readonly allowedBeneficiariesHash: string;
  readonly expiresAt: string;
}

export interface ReceiptRouteAttestation {
  readonly routingId: string;
  readonly routeId: string;
  readonly providerId: string;
  readonly rail: string;
  readonly sourceAsset: string;
  readonly destinationAsset: string;
  readonly amountMinorUnits: string;
  readonly totalCostBps: string;
  readonly recommended: boolean;
  readonly competingRouteCount: number;
  readonly bestExecutionRationale: string;
  readonly bestExecutionRationaleHash: string;
  readonly bestExecutionAttestationHash: string;
}

export interface ReceiptSettlementConfirmation {
  readonly partnerId: string;
  readonly partnerInstructionId: string;
  readonly instructionHash: string;
  readonly signatureHash: string;
  readonly partnerStatus: string;
  readonly filledMinorUnits: string;
  readonly confirmationHash: string;
}

export interface ReceiptFeeAttribution {
  readonly monetizationEventId: string | null;
  readonly takeRateBps: string | null;
  readonly platformRevenueMinorUnits: string | null;
  readonly partnerCommissionMinorUnits: string | null;
  readonly economicStage: string | null;
  readonly realizedRevenue: false;
}

export interface ReceiptTimestamps {
  readonly quotedAt: string | null;
  readonly quoteExpiresAt: string | null;
  readonly createdAt: string;
  readonly dispatchedAt: string | null;
  readonly settledAt: string | null;
}

export interface ExecutionReceiptPayload {
  readonly receiptVersion: typeof RECEIPT_VERSION;
  readonly purpose: typeof RECEIPT_PURPOSE;
  readonly executionId: string;
  readonly organizationId: string;
  readonly sandbox: true;
  readonly fundsMoved: false;
  readonly custody: false;
  readonly transferSigned: false;
  readonly meridianKeysUsed: false;
  readonly mandate: ReceiptMandateReference;
  readonly route: ReceiptRouteAttestation;
  readonly settlement: ReceiptSettlementConfirmation;
  readonly fees: ReceiptFeeAttribution;
  readonly timestamps: ReceiptTimestamps;
}

export interface ReceiptVerificationMethod {
  readonly method: typeof RECEIPT_SIGNATURE_ALGORITHM;
  readonly canonicalization: typeof RECEIPT_CANONICALIZATION;
  readonly publicKeyPem: string;
  readonly publicKeyFingerprint: string;
  readonly vaultProviderId: typeof RECEIPT_VAULT_PROVIDER_ID;
  readonly vaultKeyName: typeof RECEIPT_VAULT_KEY_NAME;
  readonly privateKeyExported: false;
}

export interface VerifiableExecutionReceipt {
  readonly id: string;
  readonly organizationId: string;
  readonly executionId: string;
  readonly payload: ExecutionReceiptPayload;
  readonly payloadCanonical: string;
  readonly payloadHash: string;
  readonly signature: string;
  readonly verification: ReceiptVerificationMethod;
  readonly fundsMoved: false;
  readonly custody: false;
  readonly meridianKeysUsed: false;
  readonly sandbox: true;
  readonly createdAt: string;
}

export interface ReceiptVerificationResult {
  readonly valid: boolean;
  readonly payloadHash: string;
  readonly reason: string | null;
  readonly fundsMoved: false;
  readonly custody: false;
}

function collectKeys(value: unknown, found: Set<string>): void {
  if (value === null || typeof value !== 'object') {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectKeys(item, found);
    }
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    found.add(key);
    collectKeys(nested, found);
  }
}

export function assertReceiptPayloadKeys(payload: ExecutionReceiptPayload): void {
  const keys = new Set<string>();
  collectKeys(payload, keys);
  for (const forbidden of FORBIDDEN_RECEIPT_PAYLOAD_KEYS) {
    if (keys.has(forbidden)) {
      throw new Error(`Receipt payload must not include "${forbidden}".`);
    }
  }
  if (payload.fundsMoved !== false || payload.custody !== false || payload.meridianKeysUsed !== false) {
    throw new Error('Receipt payload violated the non-custodial invariant.');
  }
  if (payload.transferSigned !== false) {
    throw new Error('Receipt must not attest a funds-transfer signature.');
  }
}

export function assertReceiptHasNoRawPii(serialized: string, extras: readonly string[] = []): void {
  for (const extra of extras) {
    if (extra.length > 0 && serialized.includes(extra)) {
      throw new Error('Receipt serialization leaked a raw identifier that must be hashed.');
    }
  }
}
