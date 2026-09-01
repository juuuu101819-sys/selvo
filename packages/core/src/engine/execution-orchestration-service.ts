import { DAILY_SPENDING_STATUSES, utcDayWindow } from '../domain/agent-payments.js';
import {
  ORCHESTRATION_DAILY_RESERVE_STATUSES,
  PARTNER_INSTRUCTION_HMAC_KEY_NAME,
  assertNonCustodialExecution,
  type OrchestratedExecution,
  type OrchestratedExecutionStatus,
} from '../domain/execution-orchestration.js';
import { evaluatePaymentPolicy } from '../domain/payment-policy.js';
import { hashCanonical, mandateAllowsRoute } from '../mandates/scope.js';
import { requireUsableMandate } from '../mandates/policy-bridge.js';
import type { MandateScope, StoredMandate } from '../mandates/types.js';
import {
  ForbiddenError,
  IdempotencyConflictError,
  NotFoundError,
  PolicyDeniedError,
  ValidationError,
} from '../errors/index.js';
import type { AuditLogger, Clock, IdGenerator, Logger } from '../ports/index.js';
import type { AgentPaymentsRepository } from '../ports/agent-payments.js';
import type { DashboardRepository } from '../ports/dashboard.js';
import type { MandateStore } from '../ports/mandates.js';
import type { OrchestratedExecutionStore } from '../ports/orchestrated-executions.js';
import type { PartnerInstructionStore } from '../ports/execution-partner.js';
import type { ExecutionReceiptService } from './execution-receipt-service.js';
import type { ProviderCredentialVault } from '../crypto/provider-credential-vault.js';
import type { RoutingEvaluationRepository } from '../ports/routing-evaluation.js';
import type { SandboxPartnerScenario, SignedExecutionInstruction } from '../ports/execution-partner.js';
import { SANDBOX_PARTNER_SCENARIOS } from '../ports/execution-partner.js';
import { evaluateSandboxCompliance } from './execution-compliance.js';
import {
  partnerInstructionHmacPayload,
  sandboxPartnerHmacSecret,
  signPartnerInstructionHmac,
} from './instruction-hmac.js';
import { hashExecutionInstruction } from './partner-capability.js';
import type { ExecutionPartnerRegistry } from './execution-partner-registry.js';
import type { PartnerInstructionService } from './partner-instruction-service.js';
import type { MultiRailRouter } from './routing-engine.js';
import type { ScoredMultiRailRoute } from './routing-types.js';
import { monetizationFromMultiRailRoute } from './monetization-engine.js';

const MAX_SETTLEMENT_POLLS = 8;

export interface ExecutionOrchestrationDependencies {
  readonly enabled: boolean;
  readonly sandboxMode: boolean;
  readonly store: OrchestratedExecutionStore;
  readonly mandates: MandateStore;
  readonly evaluations: RoutingEvaluationRepository;
  readonly routing: MultiRailRouter;
  readonly partners: ExecutionPartnerRegistry;
  readonly partnerInstructions: PartnerInstructionService;
  readonly partnerInstructionStore: PartnerInstructionStore;
  readonly receipts: ExecutionReceiptService;
  readonly agentPayments: AgentPaymentsRepository;
  readonly vault: ProviderCredentialVault;
  readonly dashboard: DashboardRepository;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly auditLogger: AuditLogger;
  readonly logger: Logger;
}

export interface CreateOrchestratedExecutionCommand {
  readonly organizationId: string;
  readonly actor: string;
  readonly requestId: string;
  readonly mandateId: string;
  readonly routingId: string;
  readonly routeId: string;
  readonly beneficiaryRef: string;
  readonly idempotencyKey: string | null;
  readonly complianceOutcome: string | undefined;
  readonly sandboxScenario: SandboxPartnerScenario;
}

export class ExecutionOrchestrationService {
  constructor(private readonly deps: ExecutionOrchestrationDependencies) {}

  assertEnabled(): void {
    if (!this.deps.enabled) {
      throw new ForbiddenError('Sandbox execution orchestration is disabled.', {
        failClosed: true,
        reason: 'execution_disabled',
        flag: 'EXECUTION_ENABLED',
      });
    }
    if (!this.deps.sandboxMode) {
      throw new ForbiddenError('Execution orchestration is sandbox-only.', {
        failClosed: true,
        reason: 'execution_sandbox_only',
        flag: 'EXECUTION_ENABLED',
      });
    }
  }

  async create(command: CreateOrchestratedExecutionCommand): Promise<OrchestratedExecution> {
    this.assertEnabled();
    const fingerprint = hashCanonical({
      mandateId: command.mandateId,
      routingId: command.routingId,
      routeId: command.routeId,
      beneficiaryRef: command.beneficiaryRef,
      complianceOutcome: command.complianceOutcome ?? 'pass',
      sandboxScenario: command.sandboxScenario,
    });

    if (command.idempotencyKey !== null) {
      const existing = await this.deps.store.findByIdempotencyKey(
        command.organizationId,
        command.idempotencyKey,
      );
      if (existing !== null) {
        if (existing.payloadFingerprint !== fingerprint) {
          throw new IdempotencyConflictError(command.idempotencyKey);
        }
        return this.advanceIfNeeded(existing, command);
      }
    }

    const mandate = await this.requireMandate(command);
    const { route, quoteExpiresAt, sourceAsset, destinationAsset, amountMinorUnits } =
      await this.requireRoute(command);

    const now = this.deps.clock.nowIso();
    let row: OrchestratedExecution = {
      id: this.deps.ids.generate('ex'),
      organizationId: command.organizationId,
      agentId: mandate.agentId,
      mandateId: mandate.id,
      routingId: command.routingId,
      routeId: command.routeId,
      partnerId: null,
      partnerInstructionId: null,
      status: 'CREATED',
      sourceAsset,
      destinationAsset,
      amountMinorUnits,
      filledMinorUnits: '0',
      quoteExpiresAt,
      quotedAt: route.quote.timestamp,
      dispatchedAt: null,
      settledAt: null,
      receiptId: null,
      beneficiaryRef: command.beneficiaryRef,
      idempotencyKey: command.idempotencyKey,
      payloadFingerprint: fingerprint,
      failureCode: null,
      blockedReason: null,
      dailyLimitReserved: false,
      instructionHash: null,
      signatureHash: null,
      instructionSignatureKind: null,
      transferSigned: false,
      fundsMoved: false,
      custody: false,
      meridianKeysUsed: false,
      sandbox: true,
      failoverFrom: [],
      monetizationEventId: null,
      createdAt: now,
      updatedAt: now,
    };
    row = await this.persist(row, command, 'CREATED', null);
    if (row.status !== 'CREATED') {
      return this.advanceIfNeeded(row, command);
    }

    if (quoteExpiresAt === null || quoteExpiresAt <= now) {
      return this.terminate(row, command, 'EXPIRED', 'quote_expired');
    }
    row = await this.transition(row, command, 'ROUTED');

    const compliance = evaluateSandboxCompliance(command.complianceOutcome);
    if (compliance === 'deny') {
      return this.terminate(row, command, 'BLOCKED', 'compliance_denied');
    }
    if (compliance === 'review') {
      return this.transition(row, command, 'COMPLIANCE_REVIEW');
    }
    row = await this.transition(row, command, 'COMPLIANCE_PASSED');

    try {
      requireUsableMandate(mandate.status, mandate.expiresAt, this.deps.clock.nowIso());
    } catch {
      return this.terminate(row, command, 'BLOCKED', 'mandate_unusable');
    }
    if (
      !mandateAllowsRoute(
        mandate.scope,
        sourceAsset,
        destinationAsset,
        amountMinorUnits,
        route,
      )
    ) {
      return this.terminate(row, command, 'BLOCKED', 'mandate_scope_exceeded');
    }

    const reserved = await this.reserveDailyLimit(row, command, route, mandate.scope);
    if (reserved.blocked !== null) {
      return this.terminate(row, command, 'BLOCKED', reserved.blocked);
    }
    row = { ...reserved.row, dailyLimitReserved: true, updatedAt: this.deps.clock.nowIso() };
    row = await this.deps.store.update(row);

    return this.dispatchAndSettle(row, command, route);
  }

  async get(id: string, organizationId: string, actor: string, requestId: string): Promise<OrchestratedExecution> {
    this.assertEnabled();
    const stored = await this.deps.store.findById(id, organizationId);
    if (stored === null) {
      throw new NotFoundError('OrchestratedExecution', id);
    }
    return this.advanceIfNeeded(stored, {
      organizationId,
      actor,
      requestId,
      mandateId: stored.mandateId,
      routingId: stored.routingId,
      routeId: stored.routeId,
      beneficiaryRef: stored.beneficiaryRef,
      idempotencyKey: stored.idempotencyKey,
      complianceOutcome: undefined,
      sandboxScenario: SANDBOX_PARTNER_SCENARIOS[0],
    });
  }

  private async advanceIfNeeded(
    row: OrchestratedExecution,
    command: CreateOrchestratedExecutionCommand,
  ): Promise<OrchestratedExecution> {
    if (row.status === 'DISPATCHED' || row.status === 'SETTLING') {
      return this.pollPartner(row, command);
    }
    return row;
  }

  private async dispatchAndSettle(
    row: OrchestratedExecution,
    command: CreateOrchestratedExecutionCommand,
    route: ScoredMultiRailRoute,
  ): Promise<OrchestratedExecution> {
    const preferred =
      this.deps.partners.forQuotedProvider(route.provider.id)[0]?.capabilities.partnerId ?? null;
    const signedAt = this.deps.clock.nowIso();
    const partnerIdForSecret = preferred ?? this.deps.partners.eligible({
      sourceAsset: row.sourceAsset,
      destinationAsset: row.destinationAsset,
      amountMinorUnits: row.amountMinorUnits,
      atIso: signedAt,
    })[0]?.capabilities.partnerId;
    if (partnerIdForSecret === undefined) {
      return this.terminate(row, command, 'FAILED', 'no_eligible_partner');
    }

    const secret = await this.instructionCredential(partnerIdForSecret, signedAt);
    const payload = partnerInstructionHmacPayload({
      quoteReference: row.routingId,
      sourceAsset: row.sourceAsset,
      destinationAsset: row.destinationAsset,
      amountMinorUnits: row.amountMinorUnits,
      beneficiaryRef: row.beneficiaryRef,
      signedAt,
      sandboxScenario: command.sandboxScenario,
    });
    const signature = signPartnerInstructionHmac(payload, secret);
    const instruction: SignedExecutionInstruction = {
      quoteReference: payload.quoteReference,
      sourceAsset: payload.sourceAsset,
      destinationAsset: payload.destinationAsset,
      amountMinorUnits: payload.amountMinorUnits,
      beneficiaryRef: payload.beneficiaryRef,
      signedAt: payload.signedAt,
      signature,
      sandboxScenario: payload.sandboxScenario,
    };
    const hashes = hashExecutionInstruction(instruction);

    try {
      const dispatched = await this.deps.partnerInstructions.dispatch({
        organizationId: row.organizationId,
        actor: command.actor,
        requestId: command.requestId,
        partnerId: null,
        preferredPartnerId: preferred,
        instruction,
      });
      row = await this.transition(
        {
          ...row,
          partnerId: dispatched.partnerId,
          partnerInstructionId: dispatched.id,
          instructionHash: hashes.instructionHash,
          signatureHash: hashes.signatureHash,
          instructionSignatureKind: 'partner_credential_hmac',
          failoverFrom: dispatched.failoverFrom,
          filledMinorUnits: dispatched.filledMinorUnits,
          dispatchedAt: this.deps.clock.nowIso(),
        },
        command,
        'DISPATCHED',
      );
    } catch (error) {
      const reason =
        error instanceof ValidationError && typeof error.details['reason'] === 'string'
          ? error.details['reason']
          : 'partner_dispatch_failed';
      return this.terminate(row, command, 'FAILED', reason);
    }

    return this.pollPartner(row, command, route);
  }

  private async pollPartner(
    row: OrchestratedExecution,
    command: CreateOrchestratedExecutionCommand,
    route?: ScoredMultiRailRoute,
  ): Promise<OrchestratedExecution> {
    const partnerInstructionId = row.partnerInstructionId;
    if (partnerInstructionId === null) {
      return row;
    }
    for (let i = 0; i < MAX_SETTLEMENT_POLLS; i += 1) {
      const status = await this.deps.partnerInstructions.status({
        id: partnerInstructionId,
        organizationId: row.organizationId,
        actor: command.actor,
        requestId: command.requestId,
      });
      row = {
        ...row,
        partnerId: status.partnerId,
        filledMinorUnits: status.filledMinorUnits,
        failureCode: status.failureCode,
        failoverFrom: status.failoverFrom,
        updatedAt: this.deps.clock.nowIso(),
      };
      if (status.status === 'settling' && row.status !== 'SETTLING') {
        row = await this.transition(row, command, 'SETTLING');
      }
      if (status.status === 'settled') {
        const scored = route ?? (await this.loadRoute(row));
        return this.settle(row, command, scored);
      }
      if (status.status === 'failed') {
        return this.terminate(row, command, 'FAILED', status.failureCode ?? 'partner_failed');
      }
      if (status.status === 'partial') {
        row = await this.transition({ ...row, filledMinorUnits: status.filledMinorUnits }, command, 'SETTLING');
      }
    }
    if (row.status === 'DISPATCHED') {
      return this.transition(row, command, 'SETTLING');
    }
    return this.deps.store.update(row);
  }

  private async settle(
    row: OrchestratedExecution,
    command: CreateOrchestratedExecutionCommand,
    route: ScoredMultiRailRoute,
  ): Promise<OrchestratedExecution> {
    const eventId = this.deps.ids.generate('mon');
    const event = monetizationFromMultiRailRoute({
      organizationId: row.organizationId,
      occurredAt: this.deps.clock.nowIso(),
      routingId: row.routingId,
      route,
      economicStage: 'settled',
      eventId,
      quoteId: row.routeId,
    });
    const attributed = { ...event, agentId: row.agentId };
    await this.deps.dashboard.recordMonetizationEvent(attributed);
    await this.deps.auditLogger.record({
      type: 'monetization.recorded',
      actor: command.actor,
      requestId: command.requestId,
      comparisonId: null,
      providerId: route.provider.id,
      organizationId: row.organizationId,
      payload: {
        executionId: row.id,
        monetizationEventId: attributed.id,
        takeRateBps: attributed.takeRateBps,
        economicStage: 'settled',
        realizedRevenue: false,
        fundsMoved: false,
        custody: false,
        sandbox: true,
      },
    });
    const settledAt = this.deps.clock.nowIso();
    row = await this.transition(
      {
        ...row,
        monetizationEventId: attributed.id,
        filledMinorUnits: row.amountMinorUnits,
        settledAt,
      },
      command,
      'SETTLED',
    );
    const mandate = await this.requireMandate({
      ...command,
      mandateId: row.mandateId,
    });
    const partner =
      row.partnerInstructionId === null
        ? null
        : await this.deps.partnerInstructionStore.findById(
            row.partnerInstructionId,
            row.organizationId,
          );
    if (partner !== null) {
      const loaded = await this.requireRoute({
        ...command,
        routingId: row.routingId,
        routeId: row.routeId,
      });
      const receipt = await this.deps.receipts.issue({
        actor: command.actor,
        requestId: command.requestId,
        execution: row,
        mandate,
        route,
        competingRouteCount: loaded.competingRouteCount,
        partner,
        monetization: attributed,
      });
      row = await this.deps.store.update({ ...row, receiptId: receipt.id });
    }
    return row;
  }

  private async reserveDailyLimit(
    row: OrchestratedExecution,
    _command: CreateOrchestratedExecutionCommand,
    route: ScoredMultiRailRoute,
    mandateScope: MandateScope,
  ): Promise<{ readonly row: OrchestratedExecution; readonly blocked: string | null }> {
    const policy = await this.deps.agentPayments.findPolicyByAgent(row.organizationId, row.agentId);
    if (policy === null) {
      return { row, blocked: 'policy_missing' };
    }
    return this.deps.agentPayments.withExclusiveAgentAccess(row.organizationId, row.agentId, async () => {
      const window = utcDayWindow(this.deps.clock.nowIso());
      const intentSpent = await this.deps.agentPayments.sumDailySpending({
        organizationId: row.organizationId,
        agentId: row.agentId,
        asset: policy.dailySpendingAsset,
        fromInclusive: window.start,
        toExclusive: window.end,
        statuses: DAILY_SPENDING_STATUSES,
      });
      const reserved = await this.deps.store.sumReservedDaily({
        organizationId: row.organizationId,
        agentId: row.agentId,
        asset: policy.dailySpendingAsset,
        fromInclusive: window.start,
        toExclusive: window.end,
        statuses: ORCHESTRATION_DAILY_RESERVE_STATUSES,
        excludeId: row.id,
      });
      try {
        evaluatePaymentPolicy(policy, {
          amountMinorUnits: row.amountMinorUnits,
          sourceAsset: row.sourceAsset,
          destinationAsset: row.destinationAsset,
          recipientCode: row.beneficiaryRef,
          maxFeeBps: null,
          selectedProviderId: route.provider.id,
          selectedRouteCostBps: route.totalCostBps.toFixed(),
          selectedRoute: null,
          dailySpentMinorUnits: (BigInt(intentSpent) + BigInt(reserved)).toString(),
          mandate: mandateScope,
        });
      } catch (error) {
        if (error instanceof PolicyDeniedError) {
          return {
            row,
            blocked: error.details['rule'] === 'daily_spending_limit' ? 'daily_limit_exceeded' : 'policy_denied',
          };
        }
        throw error;
      }
      return { row, blocked: null };
    });
  }

  private async requireMandate(command: CreateOrchestratedExecutionCommand): Promise<StoredMandate> {
    const mandate = await this.deps.mandates.findById(command.mandateId, command.organizationId);
    if (mandate === null) {
      throw new NotFoundError('Mandate', command.mandateId);
    }
    requireUsableMandate(mandate.status, mandate.expiresAt, this.deps.clock.nowIso());
    return mandate;
  }

  private async requireRoute(command: CreateOrchestratedExecutionCommand): Promise<{
    readonly route: ScoredMultiRailRoute;
    readonly quoteExpiresAt: string | null;
    readonly competingRouteCount: number;
    readonly sourceAsset: string;
    readonly destinationAsset: string;
    readonly amountMinorUnits: string;
  }> {
    const stored = await this.deps.evaluations.findById(command.routingId);
    if (stored === null || stored.organizationId !== command.organizationId) {
      throw new NotFoundError('RoutingEvaluation', command.routingId);
    }
    const routing = this.deps.routing.recomputeFromSnapshot(stored.snapshot);
    const route = routing.routes.find((entry) => entry.routeId === command.routeId);
    if (route === undefined) {
      throw new ValidationError('Selected route is not part of this routing evaluation.', {
        failClosed: true,
        routingId: command.routingId,
        routeId: command.routeId,
      });
    }
    return {
      route,
      quoteExpiresAt: route.quote.expiresAt,
      competingRouteCount: routing.routes.length,
      sourceAsset: routing.request.sourceAsset,
      destinationAsset: routing.request.destinationAsset,
      amountMinorUnits: routing.request.amountMinorUnits,
    };
  }

  private async loadRoute(row: OrchestratedExecution): Promise<ScoredMultiRailRoute> {
    const loaded = await this.requireRoute({
      organizationId: row.organizationId,
      actor: 'system',
      requestId: 'replay',
      mandateId: row.mandateId,
      routingId: row.routingId,
      routeId: row.routeId,
      beneficiaryRef: row.beneficiaryRef,
      idempotencyKey: null,
      complianceOutcome: undefined,
      sandboxScenario: SANDBOX_PARTNER_SCENARIOS[0],
    });
    return loaded.route;
  }

  private async instructionCredential(partnerId: string, nowIso: string): Promise<string> {
    const existing = await this.deps.vault.getPlaintext(partnerId, PARTNER_INSTRUCTION_HMAC_KEY_NAME);
    if (existing !== null) {
      return existing;
    }
    const generated = sandboxPartnerHmacSecret(partnerId);
    await this.deps.vault.putPlaintext(partnerId, PARTNER_INSTRUCTION_HMAC_KEY_NAME, generated, nowIso);
    return generated;
  }

  private async transition(
    row: OrchestratedExecution,
    command: CreateOrchestratedExecutionCommand,
    status: OrchestratedExecutionStatus,
  ): Promise<OrchestratedExecution> {
    const updated: OrchestratedExecution = {
      ...row,
      status,
      transferSigned: false,
      fundsMoved: false,
      custody: false,
      meridianKeysUsed: false,
      sandbox: true,
      updatedAt: this.deps.clock.nowIso(),
    };
    assertNonCustodialExecution(updated);
    const stored = await this.deps.store.update(updated);
    await this.auditTransition(stored, command, row.status, status);
    return stored;
  }

  private async persist(
    row: OrchestratedExecution,
    command: CreateOrchestratedExecutionCommand,
    status: OrchestratedExecutionStatus,
    from: OrchestratedExecutionStatus | null,
  ): Promise<OrchestratedExecution> {
    assertNonCustodialExecution(row);
    try {
      const stored = await this.deps.store.save(row);
      await this.auditTransition(stored, command, from, status);
      return stored;
    } catch (error) {
      if (error instanceof IdempotencyConflictError && command.idempotencyKey !== null) {
        const existing = await this.deps.store.findByIdempotencyKey(
          command.organizationId,
          command.idempotencyKey,
        );
        if (existing !== null && existing.payloadFingerprint === row.payloadFingerprint) {
          return existing;
        }
      }
      throw error;
    }
  }

  private async terminate(
    row: OrchestratedExecution,
    command: CreateOrchestratedExecutionCommand,
    status: 'BLOCKED' | 'EXPIRED' | 'FAILED',
    reason: string,
  ): Promise<OrchestratedExecution> {
    const updated: OrchestratedExecution = {
      ...row,
      status,
      blockedReason: status === 'BLOCKED' ? reason : row.blockedReason,
      failureCode: status === 'FAILED' || status === 'EXPIRED' ? reason : row.failureCode,
      transferSigned: false,
      fundsMoved: false,
      custody: false,
      meridianKeysUsed: false,
      sandbox: true,
      updatedAt: this.deps.clock.nowIso(),
    };
    assertNonCustodialExecution(updated);
    const stored = await this.deps.store.update(updated);
    await this.auditTransition(stored, command, row.status, status, reason);
    return stored;
  }

  private async auditTransition(
    row: OrchestratedExecution,
    command: CreateOrchestratedExecutionCommand,
    from: OrchestratedExecutionStatus | null,
    to: OrchestratedExecutionStatus,
    reason?: string,
  ): Promise<void> {
    const type =
      to === 'CREATED'
        ? 'execution.created'
        : to === 'ROUTED'
          ? 'execution.routed'
          : to === 'COMPLIANCE_PASSED'
            ? 'execution.compliance_passed'
            : to === 'COMPLIANCE_REVIEW'
              ? 'execution.compliance_review'
              : to === 'BLOCKED'
                ? 'execution.blocked'
                : to === 'EXPIRED'
                  ? 'execution.expired'
                  : to === 'DISPATCHED'
                    ? 'execution.dispatched'
                    : to === 'SETTLING'
                      ? 'execution.settling'
                      : to === 'SETTLED'
                        ? 'execution.settled'
                        : 'execution.failed';
    await this.deps.auditLogger.record({
      type,
      actor: command.actor,
      requestId: command.requestId,
      comparisonId: null,
      providerId: row.partnerId,
      organizationId: row.organizationId,
      payload: {
        executionId: row.id,
        from,
        to,
        reason: reason ?? null,
        idempotencyKey: command.idempotencyKey,
        instructionHash: row.instructionHash,
        transferSigned: false,
        fundsMoved: false,
        custody: false,
        meridianKeysUsed: false,
        sandbox: true,
      },
    });
  }
}
