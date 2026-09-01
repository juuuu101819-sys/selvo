import type { OrchestratedExecution } from '../domain/execution-orchestration.js';
import type { MonetizationEvent } from '../domain/monetization.js';
import { ForbiddenError } from '../errors/index.js';
import type { StoredPartnerInstruction } from '../ports/execution-partner.js';
import type { DashboardRepository } from '../ports/dashboard.js';
import type { OrchestratedExecutionStore } from '../ports/orchestrated-executions.js';
import type { PartnerInstructionStore } from '../ports/execution-partner.js';
import type { AuditLogger } from '../ports/audit.js';

export const RECONCILIATION_MISMATCH_KINDS = [
  'missing_partner_confirmation',
  'instruction_hash_mismatch',
  'amount_mismatch',
  'filled_amount_mismatch',
  'partner_status_mismatch',
  'missing_fee_attribution',
  'fee_tpv_mismatch',
  'non_custodial_violation',
] as const;
export type ReconciliationMismatchKind = (typeof RECONCILIATION_MISMATCH_KINDS)[number];

export interface ReconciliationMismatch {
  readonly executionId: string;
  readonly organizationId: string;
  readonly kind: ReconciliationMismatchKind;
  readonly severity: 'mismatch' | 'critical';
  readonly expected: string;
  readonly actual: string;
  readonly fundsMoved: false;
  readonly custody: false;
  readonly sandbox: true;
}

export function isReconciliationMismatchKind(value: unknown): value is ReconciliationMismatchKind {
  return (
    typeof value === 'string' &&
    (RECONCILIATION_MISMATCH_KINDS as readonly string[]).includes(value)
  );
}

function mismatch(
  execution: OrchestratedExecution,
  kind: ReconciliationMismatchKind,
  expected: string,
  actual: string,
  severity: 'mismatch' | 'critical' = 'mismatch',
): ReconciliationMismatch {
  return {
    executionId: execution.id,
    organizationId: execution.organizationId,
    kind,
    severity,
    expected,
    actual,
    fundsMoved: false,
    custody: false,
    sandbox: true,
  };
}

/**
 * Match dispatched instruction ↔ partner confirmation ↔ fee attribution.
 *
 * Hashes and integer minor units only. A flagged mismatch is not a funds movement.
 */
export function reconcileExecution(input: {
  readonly execution: OrchestratedExecution;
  readonly partner: StoredPartnerInstruction | null;
  readonly monetization: MonetizationEvent | null;
}): readonly ReconciliationMismatch[] {
  const found: ReconciliationMismatch[] = [];
  const { execution, partner, monetization } = input;

  if (execution.fundsMoved !== false || execution.custody !== false || execution.meridianKeysUsed !== false) {
    found.push(
      mismatch(execution, 'non_custodial_violation', 'false', 'true', 'critical'),
    );
  }
  if (partner !== null && (partner.fundsMoved !== false || partner.custody !== false)) {
    found.push(
      mismatch(execution, 'non_custodial_violation', 'partner.fundsMoved=false', 'true', 'critical'),
    );
  }
  if (monetization !== null && (monetization.fundsMoved !== false || monetization.realizedRevenue !== false)) {
    found.push(
      mismatch(
        execution,
        'non_custodial_violation',
        'realizedRevenue=false',
        String(monetization.realizedRevenue),
        'critical',
      ),
    );
  }

  const dispatched =
    execution.status === 'DISPATCHED' ||
    execution.status === 'SETTLING' ||
    execution.status === 'SETTLED' ||
    execution.status === 'FAILED';
  if (!dispatched) {
    return found;
  }

  if (partner === null) {
    found.push(
      mismatch(execution, 'missing_partner_confirmation', execution.partnerInstructionId ?? 'present', 'null'),
    );
    if (execution.status === 'SETTLED' && monetization === null) {
      found.push(
        mismatch(execution, 'missing_fee_attribution', execution.monetizationEventId ?? 'present', 'null'),
      );
    }
    return found;
  }

  if (
    execution.instructionHash !== null &&
    partner.instructionHash !== execution.instructionHash
  ) {
    found.push(
      mismatch(execution, 'instruction_hash_mismatch', execution.instructionHash, partner.instructionHash),
    );
  }
  if (partner.amountMinorUnits !== execution.amountMinorUnits) {
    found.push(
      mismatch(execution, 'amount_mismatch', execution.amountMinorUnits, partner.amountMinorUnits),
    );
  }
  if (execution.status === 'SETTLED') {
    if (partner.status !== 'settled') {
      found.push(
        mismatch(execution, 'partner_status_mismatch', 'settled', partner.status),
      );
    }
    if (partner.filledMinorUnits !== execution.amountMinorUnits) {
      found.push(
        mismatch(
          execution,
          'filled_amount_mismatch',
          execution.amountMinorUnits,
          partner.filledMinorUnits,
        ),
      );
    }
    if (monetization === null) {
      found.push(
        mismatch(execution, 'missing_fee_attribution', execution.monetizationEventId ?? 'present', 'null'),
      );
    } else if (monetization.tpvMinorUnits !== execution.amountMinorUnits) {
      found.push(
        mismatch(execution, 'fee_tpv_mismatch', execution.amountMinorUnits, monetization.tpvMinorUnits),
      );
    }
  }
  return found;
}

export interface ReconciliationEngineDependencies {
  readonly enabled: boolean;
  readonly sandboxMode: boolean;
  readonly executions: OrchestratedExecutionStore;
  readonly partners: PartnerInstructionStore;
  readonly dashboard: DashboardRepository;
  readonly auditLogger: AuditLogger;
}

export class ReconciliationEngine {
  constructor(private readonly deps: ReconciliationEngineDependencies) {}

  assertEnabled(): void {
    if (!this.deps.enabled) {
      throw new ForbiddenError('Sandbox settlement reconciliation is disabled.', {
        failClosed: true,
        reason: 'execution_disabled',
        flag: 'EXECUTION_ENABLED',
      });
    }
    if (!this.deps.sandboxMode) {
      throw new ForbiddenError('Settlement reconciliation is sandbox-only.', {
        failClosed: true,
        reason: 'execution_sandbox_only',
        flag: 'EXECUTION_ENABLED',
      });
    }
  }

  async listMismatches(input: {
    readonly organizationId: string;
    readonly actor: string;
    readonly requestId: string;
  }): Promise<readonly ReconciliationMismatch[]> {
    this.assertEnabled();
    const executions = await this.deps.executions.listByOrganization(input.organizationId);
    const mismatches: ReconciliationMismatch[] = [];
    for (const execution of executions) {
      const partner =
        execution.partnerInstructionId === null
          ? null
          : await this.deps.partners.findById(execution.partnerInstructionId, execution.organizationId);
      const monetization =
        execution.monetizationEventId === null
          ? null
          : await this.deps.dashboard.getMonetizationEvent(
              execution.organizationId,
              execution.monetizationEventId,
            );
      mismatches.push(...reconcileExecution({ execution, partner, monetization }));
    }
    await this.deps.auditLogger.record({
      type: 'reconciliation.listed',
      actor: input.actor,
      requestId: input.requestId,
      comparisonId: null,
      providerId: null,
      organizationId: input.organizationId,
      payload: {
        mismatchCount: mismatches.length,
        fundsMoved: false,
        custody: false,
        sandbox: true,
      },
    });
    return mismatches;
  }
}
