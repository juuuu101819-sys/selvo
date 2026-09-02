import { createHash } from 'node:crypto';
import {
  RECEIPT_CANONICALIZATION,
  RECEIPT_PURPOSE,
  RECEIPT_SIGNATURE_ALGORITHM,
  RECEIPT_VAULT_KEY_NAME,
  RECEIPT_VAULT_PROVIDER_ID,
  RECEIPT_VERSION,
  assertReceiptHasNoRawPii,
  assertReceiptPayloadKeys,
  type ExecutionReceiptPayload,
  type ReceiptVerificationResult,
  type VerifiableExecutionReceipt,
} from '../domain/execution-receipt.js';
import type { OrchestratedExecution } from '../domain/execution-orchestration.js';
import type { MonetizationEvent } from '../domain/monetization.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../errors/index.js';
import { hashCanonical } from '../mandates/scope.js';
import type { StoredMandate } from '../mandates/types.js';
import type { AuditLogger, Clock, IdGenerator } from '../ports/index.js';
import type { StoredPartnerInstruction } from '../ports/execution-partner.js';
import type { ExecutionReceiptStore } from '../ports/execution-receipts.js';
import type { ProviderCredentialVault } from '../crypto/provider-credential-vault.js';
import type { ScoredMultiRailRoute } from './routing-types.js';
import {
  canonicalizeReceiptPayload,
  loadOrCreateReceiptSigningKey,
  signCanonicalReceipt,
  verifyExecutionReceipt,
} from './receipt-signing.js';

export interface ExecutionReceiptServiceDependencies {
  readonly enabled: boolean;
  readonly sandboxMode: boolean;
  readonly store: ExecutionReceiptStore;
  readonly vault: ProviderCredentialVault;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly auditLogger: AuditLogger;
}

export interface IssueExecutionReceiptInput {
  readonly actor: string;
  readonly requestId: string;
  readonly execution: OrchestratedExecution;
  readonly mandate: StoredMandate;
  readonly route: ScoredMultiRailRoute;
  readonly competingRouteCount: number;
  readonly partner: StoredPartnerInstruction;
  readonly monetization: MonetizationEvent | null;
}

export class ExecutionReceiptService {
  constructor(private readonly deps: ExecutionReceiptServiceDependencies) {}

  assertEnabled(): void {
    if (!this.deps.enabled) {
      throw new ForbiddenError('Sandbox execution receipts are disabled.', {
        failClosed: true,
        reason: 'execution_disabled',
        flag: 'EXECUTION_ENABLED',
      });
    }
    if (!this.deps.sandboxMode) {
      throw new ForbiddenError('Execution receipts are sandbox-only.', {
        failClosed: true,
        reason: 'execution_sandbox_only',
        flag: 'EXECUTION_ENABLED',
      });
    }
  }

  async issue(input: IssueExecutionReceiptInput): Promise<VerifiableExecutionReceipt> {
    this.assertEnabled();
    const existing = await this.deps.store.findByExecutionId(
      input.execution.id,
      input.execution.organizationId,
    );
    if (existing !== null) {
      return existing;
    }
    if (input.execution.status !== 'SETTLED') {
      throw new ValidationError('A receipt is issued only after sandbox partner settlement.', {
        failClosed: true,
        reason: 'receipt_not_settled',
        status: input.execution.status,
      });
    }
    const payload = buildExecutionReceiptPayload(input);
    assertReceiptPayloadKeys(payload);
    const payloadCanonical = canonicalizeReceiptPayload(payload);
    assertReceiptHasNoRawPii(payloadCanonical, [input.execution.beneficiaryRef]);
    const keys = await loadOrCreateReceiptSigningKey(this.deps.vault, this.deps.clock.nowIso());
    const signature = signCanonicalReceipt(payloadCanonical, keys.privateKeyPem);
    const createdAt = this.deps.clock.nowIso();
    const stored = await this.deps.store.save({
      id: this.deps.ids.generate('rcpt'),
      organizationId: input.execution.organizationId,
      executionId: input.execution.id,
      payload,
      payloadCanonical,
      payloadHash: createHash('sha256').update(payloadCanonical, 'utf8').digest('hex'),
      signature,
      verification: {
        method: RECEIPT_SIGNATURE_ALGORITHM,
        canonicalization: RECEIPT_CANONICALIZATION,
        publicKeyPem: keys.publicKeyPem,
        publicKeyFingerprint: keys.publicKeyFingerprint,
        vaultProviderId: RECEIPT_VAULT_PROVIDER_ID,
        vaultKeyName: RECEIPT_VAULT_KEY_NAME,
        privateKeyExported: false,
      },
      fundsMoved: false,
      custody: false,
      meridianKeysUsed: false,
      sandbox: true,
      createdAt,
    });
    await this.deps.auditLogger.record({
      type: 'receipt.issued',
      actor: input.actor,
      requestId: input.requestId,
      comparisonId: null,
      providerId: input.execution.partnerId,
      organizationId: input.execution.organizationId,
      payload: {
        receiptId: stored.id,
        executionId: stored.executionId,
        payloadHash: stored.payloadHash,
        publicKeyFingerprint: stored.verification.publicKeyFingerprint,
        fundsMoved: false,
        custody: false,
        meridianKeysUsed: false,
        sandbox: true,
      },
    });
    return stored;
  }

  async get(
    executionId: string,
    organizationId: string,
  ): Promise<VerifiableExecutionReceipt> {
    this.assertEnabled();
    const stored = await this.deps.store.findByExecutionId(executionId, organizationId);
    if (stored === null) {
      throw new NotFoundError('ExecutionReceipt', executionId);
    }
    return stored;
  }

  verify(input: {
    readonly payload: ExecutionReceiptPayload;
    readonly signature: string;
    readonly publicKeyPem: string;
  }): ReceiptVerificationResult {
    return verifyExecutionReceipt(input);
  }
}

export function buildExecutionReceiptPayload(
  input: IssueExecutionReceiptInput,
): ExecutionReceiptPayload {
  const rationale = input.route.bestExecution.rationale;
  const attestationHash = input.route.bestExecution.rationaleHash;
  const confirmation = {
    partnerId: input.partner.partnerId,
    partnerInstructionId: input.partner.id,
    instructionHash: input.partner.instructionHash,
    signatureHash: input.partner.signatureHash,
    partnerStatus: input.partner.status,
    filledMinorUnits: input.partner.filledMinorUnits,
  };
  return {
    receiptVersion: RECEIPT_VERSION,
    purpose: RECEIPT_PURPOSE,
    executionId: input.execution.id,
    organizationId: input.execution.organizationId,
    sandbox: true,
    fundsMoved: false,
    custody: false,
    transferSigned: false,
    meridianKeysUsed: false,
    mandate: {
      id: input.mandate.id,
      issuer: input.mandate.issuer,
      agentId: input.mandate.agentId,
      format: input.mandate.format,
      payloadHash: input.mandate.payloadHash,
      scopeHash: hashCanonical(input.mandate.scope),
      spendCapAsset: input.mandate.scope.spendCapAsset,
      spendCapMinorUnits: input.mandate.scope.spendCapMinorUnits,
      allowedCorridors: input.mandate.scope.allowedCorridors.map((corridor) => ({
        source: corridor.source,
        destination: corridor.destination,
      })),
      allowedCurrencies: [...input.mandate.scope.allowedCurrencies],
      allowedBeneficiariesHash: hashCanonical([...input.mandate.scope.allowedBeneficiaries].sort()),
      expiresAt: input.mandate.expiresAt,
    },
    route: {
      routingId: input.execution.routingId,
      routeId: input.execution.routeId,
      providerId: input.route.provider.id,
      rail: input.route.rail,
      sourceAsset: input.execution.sourceAsset,
      destinationAsset: input.execution.destinationAsset,
      amountMinorUnits: input.execution.amountMinorUnits,
      totalCostBps: input.route.totalCostBps.toFixed(),
      recommended: input.route.recommended,
      competingRouteCount: input.competingRouteCount,
      bestExecutionRationale: rationale,
      bestExecutionRationaleHash: hashCanonical(rationale),
      bestExecutionAttestationHash: attestationHash,
    },
    settlement: {
      ...confirmation,
      confirmationHash: hashCanonical(confirmation),
    },
    fees: {
      monetizationEventId: input.monetization?.id ?? null,
      takeRateBps: input.monetization?.takeRateBps ?? null,
      platformRevenueMinorUnits: input.monetization?.platformRevenueMinorUnits ?? null,
      partnerCommissionMinorUnits: input.monetization?.partnerCommissionMinorUnits ?? null,
      economicStage: input.monetization?.economicStage ?? null,
      realizedRevenue: false,
    },
    timestamps: {
      quotedAt: input.execution.quotedAt ?? input.route.quote.timestamp,
      quoteExpiresAt: input.execution.quoteExpiresAt,
      createdAt: input.execution.createdAt,
      dispatchedAt: input.execution.dispatchedAt,
      settledAt: input.execution.settledAt,
    },
  };
}
