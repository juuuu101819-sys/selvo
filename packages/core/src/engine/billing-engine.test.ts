import { describe, expect, it } from 'vitest';
import { DEMO_ORGANIZATION_ID } from '../auth/demo-tenant.js';
import type { MonetizationEvent } from '../domain/monetization.js';
import { InvalidAmountError, ValidationError } from '../errors/index.js';
import { FixedClock } from '../ports/clock.js';
import { SequentialIdGenerator } from '../ports/id-generator.js';
import type { AuditEvent, AuditEventInput, AuditLogger } from '../ports/audit.js';
import type { BillingStore, IssueInvoiceInput } from '../ports/billing.js';
import type { Invoice } from '../domain/billing.js';
import { priceMonetization } from './monetization-engine.js';
import {
  draftInvoiceFromSnapshots,
  invoiceNumberFor,
  isBillableSnapshot,
  reconcilePeriod,
  runMonthlyBilling,
  utcMonthWindow,
} from './billing-engine.js';

function event(overrides: Partial<MonetizationEvent> = {}): MonetizationEvent {
  const priced = priceMonetization({
    tpvMinorUnits: overrides.tpvMinorUnits ?? '10000000',
    providerCostMinorUnits: overrides.providerCostMinorUnits ?? '30000',
    platformRevenueMinorUnits: overrides.platformRevenueMinorUnits ?? '20000',
    partnerCommissionMinorUnits: overrides.partnerCommissionMinorUnits,
  });
  return {
    id: 'mon_1',
    organizationId: DEMO_ORGANIZATION_ID,
    occurredAt: '2026-03-15T12:00:00.000Z',
    transactionType: 'multi_rail_quote',
    revenueSource: 'traditional_fx_routing_fee',
    rail: 'bank_fx',
    providerId: 'sandbox-northgate-bank',
    providerName: 'Northgate Bank',
    currency: 'USD',
    asset: 'USD',
    destinationAsset: 'KRW',
    agentId: null,
    fundsMoved: false,
    custody: false,
    realExecution: false,
    routeId: null,
    quoteId: null,
    economicStage: 'execution_intent',
    realizedRevenue: false,
    revenueRecognition: 'unrealized',
    originEnv: 'PRODUCTION',
    settlementFinality: 'unsettled',
    collectionReference: null,
    lifecycleState: 'EXPECTED_REVENUE',
    invoiceId: null,
    ...priced,
    ...overrides,
  };
}

class MemoryAudit implements AuditLogger {
  readonly events: AuditEvent[] = [];
  record(input: AuditEventInput): Promise<AuditEvent> {
    const stored: AuditEvent = {
      eventId: `evt_${this.events.length + 1}`,
      occurredAt: '2026-03-31T12:00:00.000Z',
      ...input,
    };
    this.events.push(stored);
    return Promise.resolve(stored);
  }
}

class MemoryBilling implements BillingStore {
  readonly events = new Map<string, MonetizationEvent>();
  readonly invoices = new Map<string, Invoice>();

  seed(row: MonetizationEvent): void {
    this.events.set(row.id, row);
  }

  listEventsInPeriod(input: {
    readonly periodStart: string;
    readonly periodEnd: string;
    readonly organizationId?: string;
  }): Promise<readonly MonetizationEvent[]> {
    return Promise.resolve(
      [...this.events.values()].filter((row) => {
        if (row.occurredAt < input.periodStart || row.occurredAt >= input.periodEnd) {
          return false;
        }
        return input.organizationId === undefined || row.organizationId === input.organizationId;
      }),
    );
  }

  findInvoiceByPeriod(input: {
    readonly organizationId: string;
    readonly periodStart: string;
    readonly currency: string;
  }): Promise<Invoice | null> {
    return Promise.resolve(
      [...this.invoices.values()].find(
        (invoice) =>
          invoice.organizationId === input.organizationId &&
          invoice.periodStart === input.periodStart &&
          invoice.currency === input.currency,
      ) ?? null,
    );
  }

  getInvoice(invoiceId: string): Promise<Invoice | null> {
    return Promise.resolve(this.invoices.get(invoiceId) ?? null);
  }

  getInvoiceForOrganization(organizationId: string, invoiceId: string): Promise<Invoice | null> {
    const invoice = this.invoices.get(invoiceId);
    if (invoice === undefined || invoice.organizationId !== organizationId) {
      return Promise.resolve(null);
    }
    return Promise.resolve(invoice);
  }

  listInvoicesForOrganization(organizationId: string): Promise<readonly Invoice[]> {
    return Promise.resolve(
      [...this.invoices.values()].filter((invoice) => invoice.organizationId === organizationId),
    );
  }

  listInvoicesForPeriod(periodStart: string): Promise<readonly Invoice[]> {
    return Promise.resolve(
      [...this.invoices.values()].filter((invoice) => invoice.periodStart === periodStart),
    );
  }

  issueInvoice(input: IssueInvoiceInput): Promise<Invoice> {
    for (const line of input.lines) {
      const snapshot = this.events.get(line.monetizationEventId);
      if (snapshot === undefined) {
        return Promise.reject(new Error(`missing snapshot ${line.monetizationEventId}`));
      }
      if (snapshot.revenueRecognition !== 'unrealized' || snapshot.invoiceId !== null) {
        return Promise.reject(new Error(`snapshot already billed ${line.monetizationEventId}`));
      }
    }
    const invoice: Invoice = {
      id: input.id,
      invoiceNumber: input.invoiceNumber,
      organizationId: input.organizationId,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      currency: input.currency,
      status: 'issued',
      collectionStatus: 'uncollected',
      issuerLegalEntity: 'unconfirmed',
      taxCalculation: 'deferred',
      subtotalMinorUnits: input.subtotalMinorUnits,
      taxMinorUnits: '0',
      totalMinorUnits: input.totalMinorUnits,
      issuedAt: input.issuedAt,
      issuedByActor: input.issuedByActor,
      lines: input.lines.map((line) => ({ ...line, invoiceId: input.id })),
    };
    this.invoices.set(invoice.id, invoice);
    for (const line of invoice.lines) {
      const snapshot = this.events.get(line.monetizationEventId);
      if (snapshot !== undefined) {
        this.events.set(line.monetizationEventId, {
          ...snapshot,
          revenueRecognition: 'invoiced',
          invoiceId: invoice.id,
          realizedRevenue: false,
        });
      }
    }
    return Promise.resolve(invoice);
  }
}

describe('utcMonthWindow', () => {
  it('accepts the first instant of a UTC month and returns an exclusive end', () => {
    expect(utcMonthWindow('2026-03-01T00:00:00.000Z')).toEqual({
      periodStart: '2026-03-01T00:00:00.000Z',
      periodEnd: '2026-04-01T00:00:00.000Z',
    });
    expect(utcMonthWindow('2026-12-01T00:00:00.000Z').periodEnd).toBe('2027-01-01T00:00:00.000Z');
  });

  it('rejects a mid-month or non-UTC instant', () => {
    expect(() => utcMonthWindow('2026-03-15T00:00:00.000Z')).toThrow(ValidationError);
    expect(() => utcMonthWindow('2026-03-01T00:00:00.000+00:00')).toThrow(ValidationError);
  });
});

describe('isBillableSnapshot', () => {
  it('bills execution intents and enterprise subscriptions with positive platform revenue', () => {
    expect(isBillableSnapshot(event())).toBe(true);
    expect(
      isBillableSnapshot(
        event({
          id: 'mon_sub',
          transactionType: 'enterprise_subscription',
          economicStage: 'route_quote',
          tpvMinorUnits: '0',
          platformRevenueMinorUnits: '200000',
        }),
      ),
    ).toBe(true);
  });

  it('never bills a route view, a zero-fee intent, or an already invoiced snapshot', () => {
    expect(isBillableSnapshot(event({ economicStage: 'route_quote' }))).toBe(false);
    expect(isBillableSnapshot(event({ economicStage: 'route_selected' }))).toBe(false);
    expect(isBillableSnapshot(event({ platformRevenueMinorUnits: '0' }))).toBe(false);
    expect(
      isBillableSnapshot(event({ revenueRecognition: 'invoiced', invoiceId: 'inv_1' })),
    ).toBe(false);
  });
});

describe('draftInvoiceFromSnapshots', () => {
  it('copies snapshot platform revenue and traces every line to a snapshot id', () => {
    const huge = (2n ** 53n + 17n).toString();
    const draft = draftInvoiceFromSnapshots({
      organizationId: DEMO_ORGANIZATION_ID,
      periodStart: '2026-03-01T00:00:00.000Z',
      periodEnd: '2026-04-01T00:00:00.000Z',
      currency: 'USD',
      events: [
        event({ id: 'mon_a', platformRevenueMinorUnits: '20000' }),
        event({ id: 'mon_b', platformRevenueMinorUnits: huge }),
      ],
    });
    expect(draft.lines.map((line) => line.monetizationEventId)).toEqual(['mon_a', 'mon_b']);
    expect(draft.taxMinorUnits).toBe('0');
    expect(draft.subtotalMinorUnits).toBe((20000n + 2n ** 53n + 17n).toString());
    expect(draft.totalMinorUnits).toBe(draft.subtotalMinorUnits);
    expect(draft.totalMinorUnits).not.toBe(String(Number(draft.totalMinorUnits)));
  });

  it('rejects a non-integer copied amount', () => {
    expect(() =>
      draftInvoiceFromSnapshots({
        organizationId: DEMO_ORGANIZATION_ID,
        periodStart: '2026-03-01T00:00:00.000Z',
        periodEnd: '2026-04-01T00:00:00.000Z',
        currency: 'USD',
        events: [event({ platformRevenueMinorUnits: '20.5' })],
      }),
    ).toThrow(InvalidAmountError);
  });
});

describe('runMonthlyBilling', () => {
  it('issues one invoice from billable snapshots, is idempotent, and never sets realizedRevenue', async () => {
    const store = new MemoryBilling();
    store.seed(event({ id: 'mon_intent', economicStage: 'execution_intent' }));
    store.seed(
      event({
        id: 'mon_quote',
        economicStage: 'route_quote',
        platformRevenueMinorUnits: '99999',
      }),
    );
    store.seed(
      event({
        id: 'mon_sub',
        transactionType: 'enterprise_subscription',
        economicStage: 'route_quote',
        tpvMinorUnits: '0',
        platformRevenueMinorUnits: '200000',
        partnerCommissionMinorUnits: '0',
      }),
    );
    const audit = new MemoryAudit();
    const deps = {
      store,
      auditLogger: audit,
      ids: new SequentialIdGenerator(),
      clock: new FixedClock('2026-04-01T00:00:00.000Z'),
    };
    const first = await runMonthlyBilling(deps, {
      periodStart: '2026-03-01T00:00:00.000Z',
      actor: 'onboarding_operator',
      requestId: 'req_1',
    });
    expect(first.createdInvoiceIds).toHaveLength(1);
    expect(first.reusedInvoiceIds).toHaveLength(0);
    const invoice = first.invoices[0];
    expect(invoice).toBeDefined();
    if (invoice === undefined) {
      throw new Error('expected invoice');
    }
    expect(invoice.lines.map((line) => line.monetizationEventId).sort()).toEqual([
      'mon_intent',
      'mon_sub',
    ]);
    expect(invoice.totalMinorUnits).toBe('220000');
    expect(invoice.status).toBe('issued');
    expect(invoice.collectionStatus).toBe('uncollected');
    expect(invoice.issuerLegalEntity).toBe('unconfirmed');
    expect(invoice.taxCalculation).toBe('deferred');
    expect(invoice.taxMinorUnits).toBe('0');
    expect(store.events.get('mon_intent')?.revenueRecognition).toBe('invoiced');
    expect(store.events.get('mon_intent')?.realizedRevenue).toBe(false);
    expect(store.events.get('mon_intent')?.invoiceId).toBe(invoice.id);
    expect(store.events.get('mon_quote')?.revenueRecognition).toBe('unrealized');
    expect(store.events.get('mon_quote')?.invoiceId).toBeNull();
    expect(audit.events.map((row) => row.type)).toEqual([
      'billing.invoice.issued',
      'billing.revenue.recognized',
    ]);
    expect(audit.events[1]?.payload['to']).toBe('invoiced');
    expect(audit.events[1]?.payload['realizedRevenue']).toBe(false);

    const second = await runMonthlyBilling(deps, {
      periodStart: '2026-03-01T00:00:00.000Z',
      actor: 'onboarding_operator',
      requestId: 'req_2',
    });
    expect(second.createdInvoiceIds).toHaveLength(0);
    expect(second.reusedInvoiceIds).toEqual([invoice.id]);
    expect(second.invoices).toHaveLength(1);
    expect(second.invoices[0]?.lines).toHaveLength(2);
    expect([...store.invoices.values()]).toHaveLength(1);
    expect(invoiceNumberFor({
      organizationId: DEMO_ORGANIZATION_ID,
      periodStart: '2026-03-01T00:00:00.000Z',
      currency: 'USD',
    })).toBe(invoice.invoiceNumber);
  });

  it('skips an empty period rather than issuing a zero invoice', async () => {
    const store = new MemoryBilling();
    store.seed(event({ id: 'mon_view', economicStage: 'route_quote' }));
    const result = await runMonthlyBilling(
      {
        store,
        auditLogger: new MemoryAudit(),
        ids: new SequentialIdGenerator(),
        clock: new FixedClock(),
      },
      { periodStart: '2026-03-01T00:00:00.000Z', actor: 'system', requestId: null },
    );
    expect(result.invoices).toHaveLength(0);
    expect(result.createdInvoiceIds).toHaveLength(0);
    expect(result.skippedOrganizationIds).toContain(DEMO_ORGANIZATION_ID);
  });
});

describe('reconcilePeriod', () => {
  it('separates quoted, billable, invoiced, and collected (always zero) without double-counting', () => {
    const quoted = event({ id: 'mon_view', economicStage: 'route_quote' });
    const billed = event({
      id: 'mon_intent',
      revenueRecognition: 'invoiced',
      invoiceId: 'inv_1',
    });
    const invoice: Invoice = {
      id: 'inv_1',
      invoiceNumber: 'INV-202603-orgdemo-USD',
      organizationId: DEMO_ORGANIZATION_ID,
      periodStart: '2026-03-01T00:00:00.000Z',
      periodEnd: '2026-04-01T00:00:00.000Z',
      currency: 'USD',
      status: 'issued',
      collectionStatus: 'uncollected',
      issuerLegalEntity: 'unconfirmed',
      taxCalculation: 'deferred',
      subtotalMinorUnits: '20000',
      taxMinorUnits: '0',
      totalMinorUnits: '20000',
      issuedAt: '2026-04-01T00:00:00.000Z',
      issuedByActor: 'system',
      lines: [
        {
          id: 'inl_1',
          invoiceId: 'inv_1',
          monetizationEventId: 'mon_intent',
          platformRevenueMinorUnits: '20000',
          economicStage: 'execution_intent',
          transactionType: 'multi_rail_quote',
          revenueSource: 'traditional_fx_routing_fee',
          occurredAt: '2026-03-15T12:00:00.000Z',
        },
      ],
    };
    const report = reconcilePeriod({
      periodStart: '2026-03-01T00:00:00.000Z',
      periodEnd: '2026-04-01T00:00:00.000Z',
      events: [quoted, billed],
      invoices: [invoice],
    });
    expect(report.collectionStatus).toBe('deferred');
    const usd = report.byCurrency[0];
    expect(usd?.quotedPlatformRevenueMinorUnits).toBe('40000');
    expect(usd?.billablePlatformRevenueMinorUnits).toBe('20000');
    expect(usd?.invoicedPlatformRevenueMinorUnits).toBe('20000');
    expect(usd?.collectedPlatformRevenueMinorUnits).toBe('0');
    expect(usd?.unbilledBillableMinorUnits).toBe('0');
    expect(usd?.duplicateBilledSnapshotIds).toEqual([]);
    expect(report.billedSnapshotIds).toEqual(['mon_intent']);
  });
});
