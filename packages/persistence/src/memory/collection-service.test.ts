import {
  BILLING_LIVE_SCOPE_KEY,
  CollectionService,
  DeferredPlatformFeeCollector,
  FixedClock,
  ForbiddenError,
  NotFoundError,
  RepositoryAuditLogger,
  SequentialIdGenerator,
  buildMonetizationEvent,
  collectionIdempotencyKey,
  noopLogger,
  requiredChecklistRef,
  resolveRevenueLifecycle,
  type BillingCollectionMode,
  type CollectionOutcome,
  type CollectionRequest,
  type Invoice,
  type LiveEnablementRecord,
  type MonetizationEvent,
  type PlatformFeeCollector,
  type RevenueOriginEnv,
} from '@meridian/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryPersistenceDriver } from './memory-driver.js';

/**
 * Spec §18.5 collection, against the real in-memory stores rather than mocks.
 *
 * The two properties worth a store are the ones a mock would fake away: the idempotency key is
 * unique, so a retry finds the first attempt instead of charging again; and confirming an attempt
 * promotes the snapshots the invoice billed in the same step, which is the only path to
 * `REALIZED_REVENUE` under 8-A.
 */

const ORG = 'org_collect';
const NOW = '2026-04-05T12:00:00.000Z';

/** A processor that confirms, so the realization path can be exercised at all. */
class StubProcessor implements PlatformFeeCollector {
  readonly kind = 'stub_processor';
  readonly collectionEnabled = true;
  readonly requests: CollectionRequest[] = [];

  constructor(private readonly outcome: Partial<CollectionOutcome> = {}) {}

  collect(request: CollectionRequest): Promise<CollectionOutcome> {
    this.requests.push(request);
    return Promise.resolve({
      confirmed: true,
      processorReference: 'ch_stub_1',
      confirmationSource: 'processor_sync_confirmed',
      failureReason: null,
      ...this.outcome,
    });
  }
}

function billingDetermination(): LiveEnablementRecord {
  return {
    id: 'lve_billing',
    scope: 'billing',
    scopeKey: BILLING_LIVE_SCOPE_KEY,
    region: 'US',
    enabled: true,
    signOff: {
      approvedBy: 'counsel@selvo.example',
      licenseBasis: 'Entity, tax handling, and processor agreement confirmed — determination 2026-03',
      approvedAt: '2026-03-01T00:00:00.000Z',
      expiresAt: '2027-03-01T00:00:00.000Z',
      checklistRef: requiredChecklistRef('billing', BILLING_LIVE_SCOPE_KEY),
    },
    createdAt: '2026-03-01T00:00:00.000Z',
    updatedAt: '2026-03-01T00:00:00.000Z',
    disabledAt: null,
    disabledReason: null,
  };
}

function snapshot(id: string, originEnv: RevenueOriginEnv): MonetizationEvent {
  return buildMonetizationEvent({
    id,
    organizationId: ORG,
    occurredAt: '2026-04-02T09:00:00.000Z',
    transactionType: 'multi_rail_quote',
    revenueSource: 'traditional_fx_routing_fee',
    rail: 'bank_fx',
    providerId: 'provider-one',
    providerName: 'Provider One',
    currency: 'USD',
    asset: 'USD',
    destinationAsset: 'KRW',
    agentId: null,
    economicStage: 'execution_intent',
    originEnv,
    settlementFinality: 'provider_confirmed',
    tpvMinorUnits: '10000000',
    providerCostMinorUnits: '30000',
    platformRevenueMinorUnits: '20000',
    partnerCommissionMinorUnits: '0',
    gainShareActive: false,
  });
}

interface Fixture {
  readonly persistence: InMemoryPersistenceDriver;
  readonly clock: FixedClock;
  readonly service: CollectionService;
  readonly processor: PlatformFeeCollector;
}

async function fixture(options: {
  readonly mode: BillingCollectionMode;
  readonly billingLiveEnabled?: boolean;
  readonly collector?: PlatformFeeCollector;
  readonly determination?: boolean;
  readonly originEnv?: RevenueOriginEnv;
  /** Mode the invoice was issued under, when it differs from the mode collecting it. */
  readonly issuedMode?: BillingCollectionMode;
} = { mode: 'RECORD_ONLY' }): Promise<Fixture & { readonly invoice: Invoice }> {
  const persistence = new InMemoryPersistenceDriver();
  const clock = new FixedClock(NOW);
  const ids = new SequentialIdGenerator();
  const collector = options.collector ?? new DeferredPlatformFeeCollector();

  await persistence.dashboard.recordMonetizationEvent(
    snapshot('mon_collect_1', options.originEnv ?? 'PRODUCTION'),
  );
  const invoice = await persistence.billing.issueInvoice({
    id: 'inv_1',
    invoiceNumber: 'INV-202604-orgcollect-USD',
    organizationId: ORG,
    periodStart: '2026-04-01T00:00:00.000Z',
    periodEnd: '2026-05-01T00:00:00.000Z',
    currency: 'USD',
    collectionMode: options.issuedMode ?? options.mode,
    subtotalMinorUnits: '20000',
    taxMinorUnits: '0',
    totalMinorUnits: '20000',
    issuedAt: '2026-05-01T00:00:00.000Z',
    issuedByActor: 'onboarding_operator',
    lines: [
      {
        id: 'inl_1',
        monetizationEventId: 'mon_collect_1',
        eventClass: 'FLAT_DECISION',
        description: 'Routing decision mon_collect_1',
        quantity: '1',
        platformRevenueMinorUnits: '20000',
        economicStage: 'execution_intent',
        transactionType: 'multi_rail_quote',
        revenueSource: 'traditional_fx_routing_fee',
        occurredAt: '2026-04-02T09:00:00.000Z',
      },
    ],
  });

  if (options.determination === true) {
    await persistence.liveEnablement.upsert(billingDetermination());
  }

  const service = new CollectionService({
    mode: options.mode,
    billingLiveEnabled: options.billingLiveEnabled ?? options.mode === 'LIVE',
    billing: persistence.billing,
    collections: persistence.collections,
    liveEnablement: persistence.liveEnablement,
    collector,
    clock,
    ids,
    auditLogger: new RepositoryAuditLogger({
      repository: persistence.auditLog,
      clock,
      ids,
      logger: noopLogger,
    }),
  });

  return { persistence, clock, service, processor: collector, invoice };
}

const COMMAND = { actor: 'onboarding_operator', requestId: 'req_1' } as const;

async function eventById(
  persistence: InMemoryPersistenceDriver,
  id: string,
): Promise<MonetizationEvent> {
  const report = await persistence.dashboard.revenue(ORG);
  const found = report.events.find((event) => event.id === id);
  if (found === undefined) {
    throw new Error(`no monetization event ${id}`);
  }
  return found;
}

describe('RECORD_ONLY records the attempt and collects nothing', () => {
  let ctx: Awaited<ReturnType<typeof fixture>>;

  beforeEach(async () => {
    ctx = await fixture({ mode: 'RECORD_ONLY' });
  });

  it('records an attempt whose terminal state is not a payment', async () => {
    const result = await ctx.service.collectInvoice({ invoiceId: 'inv_1', ...COMMAND });
    expect(result.collected).toBe(false);
    expect(result.mode).toBe('RECORD_ONLY');
    // `recorded` is deliberately not `succeeded`: the amount and the intent are auditable and no
    // money was requested, and those two facts must not share a status.
    expect(result.attempt.status).toBe('recorded');
    expect(result.attempt.processorReference).toBeNull();
    expect(result.attempt.processorKind).toBeNull();
    expect(result.attempt.amountMinorUnits).toBe('20000');
  });

  it('leaves the invoice uncollected and the snapshot unrealized', async () => {
    await ctx.service.collectInvoice({ invoiceId: 'inv_1', ...COMMAND });
    const invoice = await ctx.persistence.billing.getInvoice('inv_1');
    expect(invoice?.collectionStatus).toBe('uncollected');
    expect(invoice?.collectionReference).toBeNull();

    const event = await eventById(ctx.persistence, 'mon_collect_1');
    expect(event.revenueRecognition).toBe('invoiced');
    expect(event.realizedRevenue).toBe(false);
    expect(event.lifecycleState).toBe('ATTRIBUTED_REVENUE');
  });

  it('never contacts the processor', async () => {
    const processor = new StubProcessor();
    const live = await fixture({
      mode: 'RECORD_ONLY',
      collector: processor,
      determination: true,
      billingLiveEnabled: true,
    });
    await live.service.collectInvoice({ invoiceId: 'inv_1', ...COMMAND });
    expect(processor.requests).toEqual([]);
  });

  it('does not create a second attempt when run again', async () => {
    const first = await ctx.service.collectInvoice({ invoiceId: 'inv_1', ...COMMAND });
    const second = await ctx.service.collectInvoice({ invoiceId: 'inv_1', ...COMMAND });
    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.attempt.id).toBe(first.attempt.id);
    expect(await ctx.persistence.collections.listAttemptsForInvoice('inv_1')).toHaveLength(1);
  });

  it('refuses an invoice that does not exist', async () => {
    await expect(
      ctx.service.collectInvoice({ invoiceId: 'inv_missing', ...COMMAND }),
    ).rejects.toThrow(NotFoundError);
  });

  it('audits the record without claiming a payment', async () => {
    await ctx.service.collectInvoice({ invoiceId: 'inv_1', ...COMMAND });
    const events = await ctx.persistence.auditLog.list({ limit: 50 });
    const recorded = events.find((event) => event.type === 'billing.collection.recorded');
    expect(recorded?.payload).toMatchObject({ collected: false, fundsMoved: false });
    expect(events.some((event) => event.type === 'billing.revenue.recognized')).toBe(false);
  });
});

describe('LIVE refuses to collect until its own gate is satisfied', () => {
  it('refuses when the flag is on but no determination is recorded', async () => {
    const ctx = await fixture({ mode: 'LIVE', collector: new StubProcessor() });
    await expect(ctx.service.collectInvoice({ invoiceId: 'inv_1', ...COMMAND })).rejects.toThrow(
      ForbiddenError,
    );
    const invoice = await ctx.persistence.billing.getInvoice('inv_1');
    expect(invoice?.collectionStatus).toBe('uncollected');
  });

  it('refuses when a determination exists but no processor adapter can collect', async () => {
    // A recorded legal opinion does not conjure a payments relationship, and the deferred
    // collector reports that honestly rather than returning a success it cannot substantiate.
    const ctx = await fixture({ mode: 'LIVE', determination: true });
    const gate = await ctx.service.gate();
    expect(gate.collectionActive).toBe(false);
    expect(gate.legalEntityConfirmed).toBe(true);
    expect(gate.blockingReasons).toContain('collection_adapter_not_implemented');
    await expect(ctx.service.collectInvoice({ invoiceId: 'inv_1', ...COMMAND })).rejects.toThrow(
      /not active/,
    );
  });

  it('records the refusal as a failed attempt, keeping the key reusable', async () => {
    const ctx = await fixture({ mode: 'LIVE', determination: true });
    await expect(
      ctx.service.collectInvoice({ invoiceId: 'inv_1', ...COMMAND }),
    ).rejects.toThrow(ForbiddenError);
    const attempt = await ctx.persistence.collections.findAttemptByKey(
      collectionIdempotencyKey('inv_1'),
    );
    expect(attempt?.status).toBe('failed');
    expect(attempt?.failureReason).toContain('collection_adapter_not_implemented');
  });

  it('refuses to collect without a processor payment-method token', async () => {
    const processor = new StubProcessor();
    const ctx = await fixture({ mode: 'LIVE', determination: true, collector: processor });
    await expect(
      ctx.service.collectInvoice({ invoiceId: 'inv_1', ...COMMAND }),
    ).rejects.toThrow(/token is required/);
    expect(processor.requests).toEqual([]);
  });
});

describe('only a confirmed processor success realizes revenue', () => {
  const TOKEN = { paymentMethodToken: 'pm_stub_token' };

  it('writes collected recognition and promotes the snapshot to realized', async () => {
    const processor = new StubProcessor();
    const ctx = await fixture({ mode: 'LIVE', determination: true, collector: processor });

    const result = await ctx.service.collectInvoice({ invoiceId: 'inv_1', ...COMMAND, ...TOKEN });
    expect(result.collected).toBe(true);
    expect(result.attempt.status).toBe('succeeded');
    expect(result.attempt.processorReference).toBe('ch_stub_1');
    expect(result.attempt.confirmationSource).toBe('processor_sync_confirmed');

    const invoice = await ctx.persistence.billing.getInvoice('inv_1');
    expect(invoice?.collectionStatus).toBe('collected');
    expect(invoice?.collectionReference).toBe('ch_stub_1');

    const event = await eventById(ctx.persistence, 'mon_collect_1');
    expect(event.revenueRecognition).toBe('collected');
    expect(event.realizedRevenue).toBe(true);
    expect(event.lifecycleState).toBe('REALIZED_REVENUE');
  });

  it('moves an invoice issued before collection went live into LIVE when it is paid', async () => {
    // Launch issues invoices under RECORD_ONLY, so the first invoices ever collected will have
    // been issued in that mode. `collectionMode` describes where the invoice stands now: leaving
    // it at RECORD_ONLY next to a collected status would be the label lying about a real payment.
    const processor = new StubProcessor();
    const ctx = await fixture({
      mode: 'LIVE',
      issuedMode: 'RECORD_ONLY',
      determination: true,
      collector: processor,
    });
    expect(ctx.invoice.collectionMode).toBe('RECORD_ONLY');

    await ctx.service.collectInvoice({ invoiceId: 'inv_1', ...COMMAND, ...TOKEN });

    const invoice = await ctx.persistence.billing.getInvoice('inv_1');
    expect(invoice?.collectionStatus).toBe('collected');
    expect(invoice?.collectionMode).toBe('LIVE');
  });

  it('passes the processor a token and an idempotency key, never a credential', async () => {
    const processor = new StubProcessor();
    const ctx = await fixture({ mode: 'LIVE', determination: true, collector: processor });
    await ctx.service.collectInvoice({ invoiceId: 'inv_1', ...COMMAND, ...TOKEN });

    expect(processor.requests).toHaveLength(1);
    expect(processor.requests[0]).toEqual({
      invoiceId: 'inv_1',
      organizationId: ORG,
      currency: 'USD',
      amountMinorUnits: '20000',
      paymentMethodToken: 'pm_stub_token',
      idempotencyKey: collectionIdempotencyKey('inv_1'),
    });
    expect(JSON.stringify(processor.requests)).not.toMatch(/card|cvv|iban|accountNumber/i);
  });

  it('charges once when collection is retried', async () => {
    // The retry case §18.5 exists for: an operator clicking twice, or a processor redelivering a
    // webhook, must not produce a second charge or a second recognition.
    const processor = new StubProcessor();
    const ctx = await fixture({ mode: 'LIVE', determination: true, collector: processor });

    const first = await ctx.service.collectInvoice({ invoiceId: 'inv_1', ...COMMAND, ...TOKEN });
    const second = await ctx.service.collectInvoice({ invoiceId: 'inv_1', ...COMMAND, ...TOKEN });

    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.collected).toBe(true);
    expect(second.attempt.id).toBe(first.attempt.id);
    expect(processor.requests).toHaveLength(1);
    expect(await ctx.persistence.collections.listAttemptsForInvoice('inv_1')).toHaveLength(1);
  });

  it('treats an accepted-but-unconfirmed outcome as a failure', async () => {
    // "The API call didn't error" is not collection. A queued charge leaves the invoice unpaid.
    const processor = new StubProcessor({
      confirmed: false,
      processorReference: 'ch_pending',
      failureReason: 'charge_pending',
    });
    const ctx = await fixture({ mode: 'LIVE', determination: true, collector: processor });

    const result = await ctx.service.collectInvoice({ invoiceId: 'inv_1', ...COMMAND, ...TOKEN });
    expect(result.collected).toBe(false);
    expect(result.attempt.status).toBe('failed');
    expect(result.attempt.failureReason).toBe('charge_pending');

    const invoice = await ctx.persistence.billing.getInvoice('inv_1');
    expect(invoice?.collectionStatus).toBe('uncollected');
    const event = await eventById(ctx.persistence, 'mon_collect_1');
    expect(event.realizedRevenue).toBe(false);
  });

  it('treats a confirmation with no reference as a failure', async () => {
    const processor = new StubProcessor({ confirmed: true, processorReference: null });
    const ctx = await fixture({ mode: 'LIVE', determination: true, collector: processor });

    const result = await ctx.service.collectInvoice({ invoiceId: 'inv_1', ...COMMAND, ...TOKEN });
    expect(result.collected).toBe(false);
    expect(result.attempt.failureReason).toBe('processor_did_not_confirm');
  });

  it('still refuses to realize a sandbox-origin snapshot it just collected', async () => {
    // 8-A rule 3 is independent of §18.5: a real payment for a simulated route does not make the
    // simulated economics real, so the snapshot stops at attributed even though cash arrived.
    const processor = new StubProcessor();
    const ctx = await fixture({
      mode: 'LIVE',
      determination: true,
      collector: processor,
      originEnv: 'PARTNER_SANDBOX',
    });

    const result = await ctx.service.collectInvoice({ invoiceId: 'inv_1', ...COMMAND, ...TOKEN });
    expect(result.collected).toBe(true);

    const event = await eventById(ctx.persistence, 'mon_collect_1');
    expect(event.revenueRecognition).toBe('collected');
    expect(event.realizedRevenue).toBe(false);
    expect(event.lifecycleState).toBe('ATTRIBUTED_REVENUE');
    expect(
      resolveRevenueLifecycle(event).capReasons,
    ).toContain('non_production_origin');

    const report = await ctx.persistence.dashboard.revenue(ORG);
    expect(report.summary.realizedRevenueMinorUnits).toBe('0');
  });

  it('reports the collection on the period reconciliation instead of a fixed zero', async () => {
    const processor = new StubProcessor();
    const ctx = await fixture({ mode: 'LIVE', determination: true, collector: processor });
    await ctx.service.collectInvoice({ invoiceId: 'inv_1', ...COMMAND, ...TOKEN });

    const invoices = await ctx.persistence.billing.listInvoicesForPeriod(
      '2026-04-01T00:00:00.000Z',
    );
    expect(invoices).toHaveLength(1);
    expect(invoices[0]?.collectionStatus).toBe('collected');
  });
});
