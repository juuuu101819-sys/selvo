import type { RevenueOriginEnv } from './revenue-lifecycle.js';

/**
 * The signable settlement instruction — Pattern A (§2, §15).
 *
 * Before this existed, `ExecutionIntent` was record-only: Meridian stored the fact that a customer
 * had chosen a route and returned an id. The customer could not do anything with it. The boundary
 * held only because the feature was inert, which is not an architecture.
 *
 * This artifact is what makes the boundary real. Meridian composes the chosen route into a
 * canonical, versioned payload, signs it, and **returns it to the customer**. The customer takes it
 * to a licensed provider they already have a relationship with. Meridian does not transmit it, does
 * not hold it open, and has no code path that turns a signed instruction into an outbound call.
 *
 * ## What the Meridian signature means
 *
 * It means: *this instruction is the one Meridian produced, unaltered.* Integrity and authenticity
 * of a recommendation. See {@link MERIDIAN_SIGNATURE_ATTESTS}.
 *
 * It does **not** mean Meridian authorizes, instructs, or is capable of moving money. Meridian is
 * not a party to the payment. A provider that treats this signature as a payment authorization has
 * misread it, which is why {@link SettlementInstructionPayload} states the disclaimer inside the
 * signed bytes rather than only in prose that can be separated from the artifact.
 */

export const SETTLEMENT_INSTRUCTION_VERSION = '1' as const;
export const SETTLEMENT_INSTRUCTION_PURPOSE = 'settlement_instruction' as const;
export const SETTLEMENT_INSTRUCTION_SIGNATURE_ALGORITHM = 'Ed25519' as const;
export const SETTLEMENT_INSTRUCTION_CANONICALIZATION = 'canonical-json' as const;

/**
 * Where a verifier fetches Meridian's signing keys.
 *
 * Shipped inside every instruction so a customer's provider never has to be told out of band, and
 * kept as a constant so the route, the stored artifact, and the docs cannot name different paths.
 */
export const SETTLEMENT_JWKS_PATH = '/api/v1/settlement/keys';

/** Vault provider id for the platform instruction signer. Not a customer, not a partner. */
export const INSTRUCTION_VAULT_PROVIDER_ID = 'meridian-instruction-signer';
/** Vault key name prefix. PKCS8 Ed25519 private key; rotation appends the generation. */
export const INSTRUCTION_VAULT_KEY_NAME = 'instruction_ed25519';

/**
 * Carried inside the signed bytes so it cannot be stripped by whoever forwards the artifact.
 *
 * A verifier reading only the canonical payload still learns the limit of what the signature
 * claims. Changing either string changes every signature, which is intentional: the meaning of the
 * signature is part of what is signed.
 */
export const MERIDIAN_SIGNATURE_ATTESTS =
  'Meridian produced this routing recommendation and it has not been altered.' as const;
// One literal rather than a concatenation: concatenating widens the inferred type to `string`,
// which would let `SettlementInstructionPayload` accept any text in the field whose entire purpose
// is to carry this exact disclaimer.
export const MERIDIAN_SIGNATURE_DOES_NOT_ATTEST =
  'Meridian does not authorize, initiate, or transmit any movement of funds. This signature is not a payment authorization. The customer authorizes and executes through their own licensed provider relationship.' as const;

/**
 * Who acts on the instruction once Meridian returns it.
 *
 * Pattern A: the customer takes the signed artifact to their own provider. Pattern B: a licensed
 * partner the customer has separately contracted executes it.
 *
 * There is deliberately no third value. Pattern C — Meridian dispatching — is not representable in
 * this type, so no configuration, feature flag, or database row can put an instruction into a state
 * that says Meridian transmits. {@link assertBoundaryModeNeverDispatches} pins that at runtime and
 * `settlement-instruction.test.ts` fails if a dispatch-like value is ever added.
 */
export const BOUNDARY_MODES = ['RETURN_TO_CUSTOMER', 'PARTNER_EXECUTES'] as const;
export type BoundaryMode = (typeof BOUNDARY_MODES)[number];

export function isBoundaryMode(value: unknown): value is BoundaryMode {
  return typeof value === 'string' && (BOUNDARY_MODES as readonly string[]).includes(value);
}

/**
 * Substrings that would indicate someone added a boundary mode meaning "Meridian sends it".
 *
 * Checked against the mode list by a test rather than at runtime: the point is to fail the build
 * when the vocabulary drifts, not to validate input.
 */
export const DISPATCH_SUGGESTING_TOKENS = [
  'DISPATCH',
  'TRANSMIT',
  'SUBMIT',
  'SEND',
  'EXECUTE_ON_BEHALF',
  'MERIDIAN_EXECUTES',
  'SELVO_EXECUTES',
  'PLATFORM_EXECUTES',
] as const;

/** Throws if a mode ever implies Meridian is the sender. Defence in depth behind the type. */
export function assertBoundaryModeNeverDispatches(mode: string): asserts mode is BoundaryMode {
  const upper = mode.toUpperCase();
  for (const token of DISPATCH_SUGGESTING_TOKENS) {
    if (upper.includes(token)) {
      throw new Error(
        `Boundary mode "${mode}" implies Meridian transmits on the customer's behalf. ` +
          'Meridian generates and returns; it never dispatches.',
      );
    }
  }
  if (!isBoundaryMode(mode)) {
    throw new Error(`Unknown boundary mode "${mode}".`);
  }
}

/**
 * Identifiers and raw values that must never appear anywhere inside a signed instruction.
 *
 * Wider than the receipt list because an instruction describes a payment the customer is about to
 * make, so the temptation to include a destination account is stronger. A beneficiary travels
 * between the customer and their provider, not through Meridian's signature.
 */
export const FORBIDDEN_SETTLEMENT_INSTRUCTION_KEYS = [
  'account',
  'accountNumber',
  'iban',
  'bic',
  'swift',
  'routingNumber',
  'sortCode',
  'wallet',
  'walletAddress',
  'privateKey',
  'secret',
  'mnemonic',
  'email',
  'phone',
  'displayName',
  'beneficiary',
  'beneficiaryRef',
  'beneficiaryName',
] as const;

/** One hop of the route, as priced by the deterministic engine. Never re-derived downstream. */
export interface InstructionRouteLeg {
  readonly sequence: number;
  readonly hop: string;
}

/**
 * The route exactly as the routing engine produced it.
 *
 * Every field is copied from a stored routing evaluation recomputed from its snapshot, never
 * recalculated here and never supplied by the caller — §9-A.6. A caller can choose *which* route,
 * not what the route costs.
 */
export interface InstructionRoute {
  readonly routingId: string;
  readonly routeId: string;
  readonly providerId: string;
  readonly providerName: string;
  readonly providerLicensing: string;
  readonly rail: string;
  readonly railFamily: string;
  readonly category: string;
  readonly conversionKind: string;
  readonly legs: readonly InstructionRouteLeg[];
  readonly sourceAsset: string;
  readonly destinationAsset: string;
  readonly sendMinorUnits: string;
  readonly sendExponent: number;
  readonly deliveredMinorUnits: string;
  readonly deliveredExponent: number;
  readonly indicatedRate: string;
  readonly effectiveRate: string;
  readonly recommended: boolean;
  readonly rank: number;
  readonly competingRouteCount: number;
  readonly bestExecutionRationaleHash: string;
}

/** Quoted costs in minor units. Decimal-derived strings; no binary floats reach the signature. */
export interface InstructionCosts {
  readonly totalCostMinorUnits: string;
  readonly totalCostAsset: string;
  readonly totalCostBps: string;
  readonly providerFeeMinorUnits: string;
  readonly platformFeeMinorUnits: string;
  readonly networkFeeMinorUnits: string;
  readonly spreadBps: string;
  readonly slippageBps: string;
}

/** Reference to the Policy Engine decision that admitted this intent (§14). Never re-evaluated. */
export interface InstructionAuthorization {
  readonly paymentIntentId: string;
  readonly executionIntentId: string;
  readonly policyEvaluated: true;
}

/** Reference to the compliance pre-check (§11). Eligibility only; not a sanctions clearance. */
export interface InstructionCompliance {
  readonly eligible: boolean;
  readonly kycRequired: boolean;
  readonly sanctionsScreeningRequired: boolean;
  readonly licensing: string;
  readonly jurisdictions: readonly string[];
  readonly notes: string;
}

/**
 * The canonical, signed body.
 *
 * The field set is closed and versioned. A structural copy of an internal domain object would mean
 * that adding a field anywhere upstream silently changes what every signature covers; a verifier
 * pinned to version 1 would then start failing for reasons unrelated to tampering. Widening this
 * interface is a version bump, enforced by {@link assertInstructionPayloadShape}.
 */
export interface SettlementInstructionPayload {
  readonly instructionVersion: typeof SETTLEMENT_INSTRUCTION_VERSION;
  readonly purpose: typeof SETTLEMENT_INSTRUCTION_PURPOSE;
  readonly instructionId: string;
  readonly organizationId: string;
  readonly boundaryMode: BoundaryMode;
  readonly originEnv: RevenueOriginEnv;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly quoteExpiresAt: string | null;
  readonly route: InstructionRoute;
  readonly costs: InstructionCosts;
  readonly authorization: InstructionAuthorization;
  readonly compliance: InstructionCompliance;
  /** The signature's meaning, inside the signature. See {@link MERIDIAN_SIGNATURE_ATTESTS}. */
  readonly signatureAttests: typeof MERIDIAN_SIGNATURE_ATTESTS;
  readonly signatureDoesNotAttest: typeof MERIDIAN_SIGNATURE_DOES_NOT_ATTEST;
  /** Non-custodial invariants, restated where a verifier cannot miss them. */
  readonly meridianTransmits: false;
  readonly meridianIsPayer: false;
  readonly fundsMoved: false;
  readonly custody: false;
  readonly transferSigned: false;
  readonly meridianKeysUsed: false;
}

/**
 * The exact top-level keys of a version-1 payload.
 *
 * Typed as a total record over the payload so adding a field to
 * {@link SettlementInstructionPayload} without listing it here is a compile error, and listing one
 * that does not exist is too. The runtime array below is derived from it, which is what
 * {@link assertInstructionPayloadShape} compares against — so the signed shape cannot drift in
 * either direction without someone deciding to bump the version.
 */
const VERSION_1_PAYLOAD_KEYS: Readonly<Record<keyof SettlementInstructionPayload, true>> = {
  authorization: true,
  boundaryMode: true,
  compliance: true,
  costs: true,
  createdAt: true,
  custody: true,
  expiresAt: true,
  fundsMoved: true,
  instructionId: true,
  instructionVersion: true,
  meridianIsPayer: true,
  meridianKeysUsed: true,
  meridianTransmits: true,
  organizationId: true,
  originEnv: true,
  purpose: true,
  quoteExpiresAt: true,
  route: true,
  signatureAttests: true,
  signatureDoesNotAttest: true,
  transferSigned: true,
};

export const SETTLEMENT_INSTRUCTION_PAYLOAD_KEYS: readonly string[] =
  Object.keys(VERSION_1_PAYLOAD_KEYS).sort();

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

/**
 * Refuse to sign a payload that leaks an identifier, drifts from version 1's field set, or claims
 * anything custodial.
 *
 * Runs before canonicalization on every signing call, so a payload that would embarrass the
 * platform cannot acquire a signature that makes it look authoritative.
 */
export function assertInstructionPayloadShape(payload: SettlementInstructionPayload): void {
  const nested = new Set<string>();
  collectKeys(payload, nested);
  for (const forbidden of FORBIDDEN_SETTLEMENT_INSTRUCTION_KEYS) {
    if (nested.has(forbidden)) {
      throw new Error(`Settlement instruction must not include "${forbidden}".`);
    }
  }

  const actual = Object.keys(payload).sort();
  const expected = [...SETTLEMENT_INSTRUCTION_PAYLOAD_KEYS].sort();
  if (actual.join(',') !== expected.join(',')) {
    throw new Error(
      'Settlement instruction payload does not match the version ' +
        `${SETTLEMENT_INSTRUCTION_VERSION} field set. Changing the signed shape requires a new ` +
        'instructionVersion so existing verifiers keep working.',
    );
  }

  assertBoundaryModeNeverDispatches(payload.boundaryMode);

  if (
    payload.meridianTransmits !== false ||
    payload.meridianIsPayer !== false ||
    payload.fundsMoved !== false ||
    payload.custody !== false ||
    payload.transferSigned !== false ||
    payload.meridianKeysUsed !== false
  ) {
    throw new Error('Settlement instruction violated the non-custodial invariant.');
  }

  if (payload.signatureAttests !== MERIDIAN_SIGNATURE_ATTESTS) {
    throw new Error('Settlement instruction misstates what the Meridian signature attests.');
  }
  if (payload.signatureDoesNotAttest !== MERIDIAN_SIGNATURE_DOES_NOT_ATTEST) {
    throw new Error('Settlement instruction dropped the authorization disclaimer.');
  }
}

/** How a customer applied their own signature. Meridian stores it; it never acts on it. */
export const CUSTOMER_SIGNATURE_ALGORITHMS = ['Ed25519', 'ECDSA_P256_SHA256'] as const;
export type CustomerSignatureAlgorithm = (typeof CUSTOMER_SIGNATURE_ALGORITHMS)[number];

export function isCustomerSignatureAlgorithm(
  value: unknown,
): value is CustomerSignatureAlgorithm {
  return (
    typeof value === 'string' && (CUSTOMER_SIGNATURE_ALGORITHMS as readonly string[]).includes(value)
  );
}

/**
 * The customer's counter-signature over the same canonical bytes.
 *
 * Pattern A means the customer authorizes the payment, so their signature is the one that carries
 * authority — and it carries it *at their provider*, not here. Meridian keeps it only so the
 * customer has an auditable record that they approved this exact artifact.
 *
 * Accepting one starts nothing. There is no handler, queue, or job that reacts to this field, and
 * `settlement-boundary.test.ts` asserts a fully counter-signed instruction still produces zero
 * outbound calls and leaves the instruction in exactly the state it was already in.
 */
export interface CustomerCounterSignature {
  readonly algorithm: CustomerSignatureAlgorithm;
  readonly signature: string;
  readonly keyId: string;
  readonly signedAt: string;
  /** Restates that storing this did not cause Meridian to act. */
  readonly triggeredDispatch: false;
}

/** Meridian's verification material, published so a verifier never needs to ask for a key. */
export interface InstructionVerificationMethod {
  readonly algorithm: typeof SETTLEMENT_INSTRUCTION_SIGNATURE_ALGORITHM;
  readonly canonicalization: typeof SETTLEMENT_INSTRUCTION_CANONICALIZATION;
  readonly keyId: string;
  readonly publicKeyPem: string;
  readonly jwksUri: string;
  readonly privateKeyExported: false;
}

export interface SignedSettlementInstruction {
  readonly id: string;
  readonly organizationId: string;
  readonly executionIntentId: string;
  readonly payload: SettlementInstructionPayload;
  readonly payloadCanonical: string;
  readonly payloadHash: string;
  readonly signature: string;
  readonly verification: InstructionVerificationMethod;
  readonly customerSignature: CustomerCounterSignature | null;
  readonly expiresAt: string;
  readonly createdAt: string;
  /** Eligible venues for Pattern A, or the contracted partner for Pattern B. Never a Meridian action. */
  readonly eligibleVenues: readonly InstructionVenue[];
  readonly nextSteps: readonly string[];
}

/**
 * Somewhere the customer can take this instruction.
 *
 * A directory entry, not a routing decision and not an introduction Meridian brokers. `contact` is
 * deliberately the provider's own public channel: Meridian does not sit between the customer and
 * the venue.
 */
export interface InstructionVenue {
  readonly providerId: string;
  readonly providerName: string;
  readonly licensing: string;
  readonly jurisdictions: readonly string[];
  readonly customerMustHaveOwnRelationship: true;
}

export const INSTRUCTION_EXPIRY_REASONS = ['expired', 'quote_stale'] as const;
export type InstructionExpiryReason = (typeof INSTRUCTION_EXPIRY_REASONS)[number];

export interface InstructionFreshness {
  readonly usable: boolean;
  readonly reason: InstructionExpiryReason | null;
}

/**
 * Whether an instruction may still be acted on.
 *
 * Checked at read time as well as at generation, because the interesting case is an instruction
 * that was fine when it was made and is not fine now. Serving a stale artifact without saying so
 * would let a customer present a price no provider will honour.
 */
export function instructionFreshness(
  instruction: Pick<SignedSettlementInstruction, 'expiresAt' | 'payload'>,
  nowIso: string,
): InstructionFreshness {
  if (instruction.expiresAt <= nowIso) {
    return { usable: false, reason: 'expired' };
  }
  const quoteExpiresAt = instruction.payload.quoteExpiresAt;
  if (quoteExpiresAt !== null && quoteExpiresAt <= nowIso) {
    return { usable: false, reason: 'quote_stale' };
  }
  return { usable: true, reason: null };
}

/** Steps a customer follows to verify and use the artifact, shipped with every instruction. */
export const INSTRUCTION_VERIFICATION_STEPS: readonly string[] = [
  'Canonicalize `payload` with sorted-key JSON (RFC 8785-style: keys sorted, no insignificant whitespace).',
  'Confirm the result equals `payloadCanonical` byte for byte.',
  'SHA-256 the canonical UTF-8 bytes and confirm it equals `payloadHash`.',
  'Fetch the Meridian public key for `verification.keyId` from `verification.jwksUri`.',
  'Verify the base64url Ed25519 `signature` over the canonical bytes with that key.',
  'Confirm `payload.expiresAt` and `payload.quoteExpiresAt` are still in the future.',
  'Read `payload.signatureDoesNotAttest`: this signature is not a payment authorization.',
  'Apply your own signature over the same canonical bytes and authorize the payment with your provider.',
];
