import type { JsonObject } from '../domain/json.js';

/**
 * Signed agent mandates. Verification and storage only — never execution, custody, or key holding.
 *
 * AP2 Intent/Cart are W3C Verifiable Credentials (ECDSA P-256 + SHA-256).
 * x402 is a per-request HTTP 402 challenge/response authorization.
 * MPP is a session mandate that locks a spend cap for batched later consumption (consumption
 * happens only at future partner execution, which remains 501).
 */

export const MANDATE_FORMATS = ['ap2_intent', 'ap2_cart', 'x402', 'mpp'] as const;
export type MandateFormat = (typeof MANDATE_FORMATS)[number];

export const MANDATE_STATUSES = ['verified', 'revoked'] as const;
export type MandateStatus = (typeof MANDATE_STATUSES)[number];

export const MANDATE_REJECTION_REASONS = [
  'unsupported_format',
  'signature_invalid',
  'expired',
  'revoked',
  'scope_invalid',
  'challenge_required',
  'challenge_invalid',
  'ingestion_disabled',
] as const;
export type MandateRejectionReason = (typeof MANDATE_REJECTION_REASONS)[number];

export function isMandateFormat(value: unknown): value is MandateFormat {
  return typeof value === 'string' && (MANDATE_FORMATS as readonly string[]).includes(value);
}

export function isMandateStatus(value: unknown): value is MandateStatus {
  return typeof value === 'string' && (MANDATE_STATUSES as readonly string[]).includes(value);
}

export interface MandateCorridor {
  readonly source: string;
  readonly destination: string;
}

export interface MandateScope {
  readonly spendCapMinorUnits: string;
  readonly spendCapAsset: string;
  /** Empty means none — fail closed. */
  readonly allowedCorridors: readonly MandateCorridor[];
  /** Empty means none — fail closed. */
  readonly allowedCurrencies: readonly string[];
  /** Empty means none — fail closed. */
  readonly allowedBeneficiaries: readonly string[];
}

export interface StoredMandate {
  readonly id: string;
  readonly organizationId: string;
  readonly agentId: string;
  readonly format: MandateFormat;
  readonly status: MandateStatus;
  readonly scope: MandateScope;
  readonly issuer: string;
  readonly expiresAt: string;
  readonly payloadHash: string;
  readonly payload: JsonObject;
  readonly boundCredentialPrefix: string | null;
  readonly verifiedAt: string;
  readonly revokedAt: string | null;
  readonly revokedByActor: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface X402Challenge {
  readonly id: string;
  readonly organizationId: string;
  readonly agentId: string;
  readonly nonce: string;
  readonly scope: MandateScope;
  readonly expiresAt: string;
  readonly createdAt: string;
}

export interface ParsedMandate {
  readonly format: MandateFormat;
  readonly issuer: string;
  readonly expiresAt: string;
  readonly scope: MandateScope;
  readonly payload: JsonObject;
  readonly payloadHash: string;
}

export interface PublicMandate {
  readonly id: string;
  readonly organizationId: string;
  readonly agentId: string;
  readonly format: MandateFormat;
  readonly status: MandateStatus;
  readonly scope: MandateScope;
  readonly issuer: string;
  readonly expiresAt: string;
  readonly payloadHash: string;
  readonly boundCredentialPrefix: string | null;
  readonly verifiedAt: string;
  readonly revokedAt: string | null;
  readonly fundsMoved: false;
  readonly custody: false;
  readonly sandbox: true;
}

export function toPublicMandate(row: StoredMandate): PublicMandate {
  return {
    id: row.id,
    organizationId: row.organizationId,
    agentId: row.agentId,
    format: row.format,
    status: row.status,
    scope: row.scope,
    issuer: row.issuer,
    expiresAt: row.expiresAt,
    payloadHash: row.payloadHash,
    boundCredentialPrefix: row.boundCredentialPrefix,
    verifiedAt: row.verifiedAt,
    revokedAt: row.revokedAt,
    fundsMoved: false,
    custody: false,
    sandbox: true,
  };
}

export function corridorKey(corridor: MandateCorridor): string {
  return `${corridor.source}:${corridor.destination}`;
}
