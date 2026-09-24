import type { Invoice } from '../domain/billing.js';
import {
  collectionIdempotencyKey,
  type BillingCollectionMode,
  type CollectionAttempt,
} from '../domain/collection.js';
import {
  BILLING_LIVE_SCOPE_KEY,
  evaluateLiveBilling,
  type LiveBillingEvaluation,
} from '../domain/live-enablement.js';
import { ForbiddenError, NotFoundError } from '../errors/index.js';
import type { AuditLogger } from '../ports/audit.js';
import type { BillingStore, CollectionStore } from '../ports/billing.js';
import type { Clock } from '../ports/clock.js';
import type { IdGenerator } from '../ports/id-generator.js';
import type { LiveEnablementStore } from '../ports/live-enablement.js';
import type { PlatformFeeCollector } from '../ports/payment-collector.js';
import { parseWireReference } from '../ports/wire-manual-collector.js';

/**
 * Invoice collection in both modes (§18.5).
 *
 * `RECORD_ONLY` is the launch state and the default: the full pipeline runs, an attempt is
 * recorded so the amount and the intent are auditable, and no processor is contacted. `LIVE`
 * charges through a contracted processor adapter.
 *
 * Two properties this class exists to guarantee:
 *
 * - **A retry cannot double-charge.** Every attempt is keyed by the invoice, so a second call
 *   finds the first attempt and returns it rather than charging again.
 * - **Only a confirmed processor success realizes revenue.** `recognition = 'collected'` is
 *   written in exactly one place, from exactly one input: an outcome the processor affirmatively
 *   confirmed, carrying a reference. That is what allows `REALIZED_REVENUE` under 8-A, and it is
 *   why a non-erroring API call is not enough.
 */

export interface CollectionServiceDependencies {
  readonly mode: BillingCollectionMode;
  readonly billingLiveEnabled: boolean;
  readonly billing: BillingStore;
  readonly collections: CollectionStore;
  readonly liveEnablement: LiveEnablementStore;
  readonly collector: PlatformFeeCollector;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly auditLogger: AuditLogger;
}

export interface CollectInvoiceCommand {
  readonly invoiceId: string;
  readonly actor: string;
  readonly requestId: string | null;
  /**
   * Processor-side token for the org's stored payment method, required in `LIVE`. An opaque
   * reference; this service never accepts a payment credential.
   */
  readonly paymentMethodToken?: string | undefined;
}

export interface CollectInvoiceResult {
  readonly invoiceId: string;
  readonly mode: BillingCollectionMode;
  /** True only for a processor-confirmed payment. Always false in `RECORD_ONLY`. */
  readonly collected: boolean;
  /** True when this call found an existing attempt instead of starting one. */
  readonly replayed: boolean;
  readonly attempt: CollectionAttempt;
  readonly gate: LiveBillingEvaluation;
}

export interface ConfirmWireInvoiceCommand {
  readonly invoiceId: string;
  readonly wireReference: string;
  readonly actor: string;
  readonly requestId: string | null;
  readonly notes?: string | undefined;
}

export class CollectionService {
  constructor(private readonly deps: CollectionServiceDependencies) {}

  /** The gate as it stands now, for operators and for the ops endpoint. */
  async gate(): Promise<LiveBillingEvaluation> {
    return evaluateLiveBilling({
      nowIso: this.deps.clock.nowIso(),
      billingLiveEnabled: this.deps.billingLiveEnabled,
      billingRecord: await this.deps.liveEnablement.find('billing', BILLING_LIVE_SCOPE_KEY),
      collectorImplemented: this.deps.collector.collectionEnabled,
    });
  }

  async collectInvoice(command: CollectInvoiceCommand): Promise<CollectInvoiceResult> {
    const invoice = await this.deps.billing.getInvoice(command.invoiceId);
    if (invoice === null) {
      throw new NotFoundError('Invoice', command.invoiceId);
    }
    const gate = await this.gate();
    const idempotencyKey = collectionIdempotencyKey(invoice.id);

    // An already-collected invoice is the most important replay case: returning the stored
    // attempt is what stops a duplicate webhook or an impatient operator from charging twice.
    const existing = await this.deps.collections.findAttemptByKey(idempotencyKey);
    if (existing !== null && existing.status === 'succeeded') {
      return {
        invoiceId: invoice.id,
        mode: existing.mode,
        collected: true,
        replayed: true,
        attempt: existing,
        gate,
      };
    }

    const mode = this.deps.mode;
    const now = this.deps.clock.nowIso();
    const { attempt, created } = await this.deps.collections.beginAttempt({
      id: this.deps.ids.generate('col'),
      invoiceId: invoice.id,
      organizationId: invoice.organizationId,
      idempotencyKey,
      mode,
      status: mode === 'LIVE' ? 'pending' : 'recorded',
      currency: invoice.currency,
      amountMinorUnits: invoice.totalMinorUnits,
      processorKind: mode === 'LIVE' ? this.deps.collector.kind : null,
      createdAt: now,
    });

    if (mode === 'RECORD_ONLY') {
      await this.recordAudit('billing.collection.recorded', command, invoice, {
        mode,
        collected: false,
        fundsMoved: false,
        idempotencyKey,
        created,
        reasons: ['collection_mode_record_only'],
      });
      return { invoiceId: invoice.id, mode, collected: false, replayed: !created, attempt, gate };
    }

    if (!gate.collectionActive) {
      await this.deps.collections.failAttempt({
        idempotencyKey,
        failureReason: gate.blockingReasons.join(','),
        failedAt: now,
      });
      await this.recordAudit('billing.collection.refused', command, invoice, {
        mode,
        collected: false,
        fundsMoved: false,
        idempotencyKey,
        reasons: [...gate.blockingReasons],
      });
      throw new ForbiddenError(
        'Live collection is not active. The invoice remains recorded and uncollected.',
        {
          flag: 'BILLING_LIVE_ENABLED',
          collected: false,
          reasons: gate.blockingReasons,
          checklistRef: 'GO_LIVE_CHECKLIST.md#billing-collection',
        },
      );
    }

    const paymentMethodToken = command.paymentMethodToken;
    if (paymentMethodToken === undefined || paymentMethodToken.trim() === '') {
      await this.deps.collections.failAttempt({
        idempotencyKey,
        failureReason: 'payment_method_token_missing',
        failedAt: now,
      });
      throw new ForbiddenError(
        'A processor payment-method token is required to collect. Raw payment credentials are never accepted.',
        { invoiceId: invoice.id, collected: false },
      );
    }

    const outcome = await this.deps.collector.collect({
      invoiceId: invoice.id,
      organizationId: invoice.organizationId,
      currency: invoice.currency,
      amountMinorUnits: invoice.totalMinorUnits,
      paymentMethodToken,
      idempotencyKey,
    });

    // Anything short of an affirmative confirmation with a reference is a failure. A queued or
    // accepted charge is not money received, and treating it as such would let 8-A's realization
    // chain rest on an unverified claim.
    if (!outcome.confirmed || outcome.processorReference === null) {
      const failed = await this.deps.collections.failAttempt({
        idempotencyKey,
        failureReason: outcome.failureReason ?? 'processor_did_not_confirm',
        failedAt: this.deps.clock.nowIso(),
      });
      await this.recordAudit('billing.collection.refused', command, invoice, {
        mode,
        collected: false,
        fundsMoved: false,
        idempotencyKey,
        reasons: [outcome.failureReason ?? 'processor_did_not_confirm'],
      });
      return { invoiceId: invoice.id, mode, collected: false, replayed: false, attempt: failed, gate };
    }

    const confirmed = await this.deps.collections.confirmAttempt({
      idempotencyKey,
      processorReference: outcome.processorReference,
      processorKind: this.deps.collector.kind,
      confirmationSource: outcome.confirmationSource ?? 'processor_sync_confirmed',
      confirmedAt: this.deps.clock.nowIso(),
    });

    await this.recordAudit('billing.revenue.recognized', command, invoice, {
      mode,
      collected: true,
      // The platform's own fee was paid by the customer through the processor. `fundsMoved` means
      // customer settlement funds moving through SELVO, which collecting a fee is not, so the two
      // facts are stated separately rather than letting one `false` cover both.
      platformFeeCollected: true,
      customerSettlementFundsMoved: false,
      idempotencyKey,
      from: 'invoiced',
      to: 'collected',
      processorKind: this.deps.collector.kind,
      confirmationSource: confirmed.confirmationSource,
    });

    return {
      invoiceId: invoice.id,
      mode,
      collected: true,
      replayed: false,
      attempt: confirmed,
      gate,
    };
  }

  /**
   * Operator-confirmed wire deposit for one invoice (§18.5).
   *
   * Skips processor tokens and {@link PlatformFeeCollector.collect}; writes through
   * {@link CollectionStore.confirmAttempt} only, with `confirmationSource: operator_manual`.
   */
  async confirmWireInvoice(command: ConfirmWireInvoiceCommand): Promise<CollectInvoiceResult> {
    const processorReference = parseWireReference(command.wireReference);
    const invoice = await this.deps.billing.getInvoice(command.invoiceId);
    if (invoice === null) {
      throw new NotFoundError('Invoice', command.invoiceId);
    }
    const gate = await this.gate();
    const idempotencyKey = collectionIdempotencyKey(invoice.id);

    const existing = await this.deps.collections.findAttemptByKey(idempotencyKey);
    if (existing !== null && existing.status === 'succeeded') {
      return {
        invoiceId: invoice.id,
        mode: existing.mode,
        collected: true,
        replayed: true,
        attempt: existing,
        gate,
      };
    }

    const mode = this.deps.mode;
    if (mode === 'RECORD_ONLY') {
      throw new ForbiddenError(
        'Wire confirmation requires live billing mode. The invoice remains recorded and uncollected.',
        {
          flag: 'BILLING_LIVE_ENABLED',
          collected: false,
          reasons: ['collection_mode_record_only'],
          checklistRef: 'GO_LIVE_CHECKLIST.md#billing-collection',
        },
      );
    }

    const now = this.deps.clock.nowIso();
    const auditCommand = {
      invoiceId: command.invoiceId,
      actor: command.actor,
      requestId: command.requestId,
    };

    if (!gate.collectionActive) {
      await this.recordAudit('billing.collection.refused', auditCommand, invoice, {
        mode,
        collected: false,
        fundsMoved: false,
        customerSettlementFundsMoved: false,
        idempotencyKey,
        reasons: [...gate.blockingReasons],
        confirmationKind: 'operator_manual_wire',
      });
      throw new ForbiddenError(
        'Live collection is not active. The invoice remains recorded and uncollected.',
        {
          flag: 'BILLING_LIVE_ENABLED',
          collected: false,
          reasons: gate.blockingReasons,
          checklistRef: 'GO_LIVE_CHECKLIST.md#billing-collection',
        },
      );
    }

    const { attempt, created } = await this.deps.collections.beginAttempt({
      id: this.deps.ids.generate('col'),
      invoiceId: invoice.id,
      organizationId: invoice.organizationId,
      idempotencyKey,
      mode: 'LIVE',
      status: 'pending',
      currency: invoice.currency,
      amountMinorUnits: invoice.totalMinorUnits,
      processorKind: this.deps.collector.kind,
      createdAt: now,
    });

    if (attempt.mode !== 'LIVE') {
      throw new ForbiddenError(
        'A prior record-only collection attempt prevents wire confirmation for this invoice.',
        { invoiceId: invoice.id, collected: false },
      );
    }

    const confirmed = await this.deps.collections.confirmAttempt({
      idempotencyKey,
      processorReference,
      processorKind: this.deps.collector.kind,
      confirmationSource: 'operator_manual',
      confirmedAt: now,
    });

    await this.recordAudit('billing.revenue.recognized', auditCommand, invoice, {
      mode: 'LIVE',
      collected: true,
      fundsMoved: false,
      platformFeeCollected: true,
      customerSettlementFundsMoved: false,
      idempotencyKey,
      from: 'invoiced',
      to: 'collected',
      processorKind: this.deps.collector.kind,
      confirmationSource: confirmed.confirmationSource,
      confirmationKind: 'operator_manual_wire',
      ...(command.notes === undefined ? {} : { notes: command.notes }),
    });

    return {
      invoiceId: invoice.id,
      mode: 'LIVE',
      collected: true,
      replayed: !created,
      attempt: confirmed,
      gate,
    };
  }

  private async recordAudit(
    type: 'billing.collection.recorded' | 'billing.collection.refused' | 'billing.revenue.recognized',
    command: Pick<CollectInvoiceCommand, 'actor' | 'requestId' | 'invoiceId'>,
    invoice: Invoice,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.deps.auditLogger.record({
      type,
      actor: command.actor,
      requestId: command.requestId,
      comparisonId: null,
      providerId: null,
      organizationId: invoice.organizationId,
      payload: {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        currency: invoice.currency,
        totalMinorUnits: invoice.totalMinorUnits,
        ...payload,
      },
    });
  }
}
