import {
  DEFAULT_SUBSCRIPTION_TIERS,
  NotFoundError,
  SUBSCRIPTION_TIERS,
  SUBSCRIPTION_TIER_LABELS,
  invoiceCollectionRollup,
  reconcilePeriod,
  runMonthlyBilling,
  serializeBillingRunResult,
  serializeInvoice,
  serializeReconciliationReport,
  tierDefinition,
  utcMonthWindow,
  uuidIdGenerator,
} from '@meridian/core';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppContainer } from '../container.js';
import { parseOrThrow, dashboardListQuerySchema } from '../http/validation.js';
import { resolveListCursor, slicePage } from '../http/list-page.js';
import { requireOrganization } from '../http/require-organization.js';
import { ONBOARDING_OPERATOR_HEADER, requireOnboardingOperator } from '../onboarding/operator.js';

const periodQuery = z
  .object({
    periodStart: z.string().min(10).max(40),
  })
  .strict();

const runBody = z
  .object({
    periodStart: z.string().min(10).max(40),
    organizationId: z.string().min(1).max(128).optional(),
  })
  .strict();

const idParams = z.object({ id: z.string().min(1).max(128) }).strict();

const subscriptionBody = z
  .object({
    organizationId: z.string().trim().min(1).max(128),
    tier: z.enum(SUBSCRIPTION_TIERS),
    startedAt: z.string().min(10).max(40).optional(),
    /**
     * Negotiated flat per-decision fee, in minor units. A constant, never a rate — the regex
     * rejects anything with a decimal point or a percent sign so a rate cannot be smuggled in as
     * a "fee" (§18.2).
     */
    flatDecisionFeeMinorUnits: z
      .string()
      .trim()
      .regex(/^\d+$/, 'flatDecisionFeeMinorUnits must be a non-negative integer of minor units.')
      .max(24)
      .optional(),
  })
  .strict();

const collectBody = z
  .object({
    /** Processor-side token for the org's stored payment method. Never a raw credential. */
    paymentMethodToken: z.string().trim().min(1).max(256).optional(),
  })
  .strict();

const usageQuery = z
  .object({
    periodStart: z.string().min(10).max(40).optional(),
  })
  .strict();

interface Envelope<TData> {
  readonly data: TData;
  readonly meta: { readonly mode: string; readonly disclaimer: string; readonly requestId: string };
}

function operatorSecret(): string | undefined {
  const value = process.env['ONBOARDING_OPERATOR_SECRET'];
  return value === undefined || value.trim() === '' ? undefined : value;
}

function presentedOperatorKey(request: FastifyRequest): string | undefined {
  const header = request.headers[ONBOARDING_OPERATOR_HEADER];
  return typeof header === 'string' ? header : undefined;
}

export function registerBillingRoutes(app: FastifyInstance, container: AppContainer): void {
  const envelope = <TData>(request: FastifyRequest, data: TData): Envelope<TData> => ({
    data,
    meta: {
      mode: container.config.mode,
      disclaimer: container.disclaimer,
      requestId: request.id,
    },
  });

  app.post('/ops/billing/invoices/run', async (request) => {
    requireOnboardingOperator(presentedOperatorKey(request), operatorSecret());
    const body = parseOrThrow(runBody, request.body, 'body');
    const result = await runMonthlyBilling(
      {
        store: container.persistence.billing,
        auditLogger: container.auditLogger,
        ids: uuidIdGenerator,
        clock: container.clock,
        subscriptions: container.persistence.subscriptions,
        usage: container.persistence.usageMeter,
        collectionMode: container.config.billingCollectionMode,
      },
      {
        periodStart: body.periodStart,
        ...(body.organizationId === undefined ? {} : { organizationId: body.organizationId }),
        actor: 'onboarding_operator',
        requestId: request.id,
      },
    );
    return envelope(request, serializeBillingRunResult(result));
  });

  app.get('/ops/billing/reconciliation', async (request) => {
    requireOnboardingOperator(presentedOperatorKey(request), operatorSecret());
    const { periodStart } = parseOrThrow(periodQuery, request.query, 'query');
    const { periodEnd } = utcMonthWindow(periodStart);
    const [events, invoices] = await Promise.all([
      container.persistence.billing.listEventsInPeriod({ periodStart, periodEnd }),
      container.persistence.billing.listInvoicesForPeriod(periodStart),
    ]);
    return envelope(
      request,
      serializeReconciliationReport(reconcilePeriod({ periodStart, periodEnd, events, invoices })),
    );
  });

  app.post('/ops/billing/subscriptions', async (request) => {
    requireOnboardingOperator(presentedOperatorKey(request), operatorSecret());
    const body = parseOrThrow(subscriptionBody, request.body, 'body');
    const definition = tierDefinition(DEFAULT_SUBSCRIPTION_TIERS, body.tier);
    const subscription = await container.persistence.subscriptions.upsertSubscription({
      organizationId: body.organizationId,
      tier: body.tier,
      currency: definition.currency,
      startedAt: body.startedAt ?? container.clock.nowIso(),
      cancelledAt: null,
      flatDecisionFeeMinorUnits: body.flatDecisionFeeMinorUnits ?? null,
    });
    await container.auditLogger.record({
      type: 'billing.subscription.assigned',
      actor: 'onboarding_operator',
      requestId: request.id,
      comparisonId: null,
      providerId: null,
      organizationId: subscription.organizationId,
      payload: {
        tier: subscription.tier,
        currency: subscription.currency,
        startedAt: subscription.startedAt,
        monthlyBaseMinorUnits: definition.monthlyBaseMinorUnits,
        includedCalls: definition.includedCalls,
        flatDecisionFeeMinorUnits:
          subscription.flatDecisionFeeMinorUnits ?? definition.flatDecisionFeeMinorUnits,
        collected: false,
        fundsMoved: false,
        pricesAreProvisional: true,
      },
    });
    return envelope(request, {
      subscription,
      tierDefinition: definition,
      // Nobody is charged by assigning a tier: the amounts only reach a customer through an
      // invoice, and invoices are recorded rather than collected until the §18.5 gate opens.
      collectionMode: container.config.billingCollectionMode,
      pricesAreProvisional: true,
    });
  });

  app.post('/ops/billing/invoices/:id/collect', async (request) => {
    requireOnboardingOperator(presentedOperatorKey(request), operatorSecret());
    const { id } = parseOrThrow(idParams, request.params, 'params');
    const body = parseOrThrow(collectBody, request.body ?? {}, 'body');
    const result = await container.collections.collectInvoice({
      invoiceId: id,
      actor: 'onboarding_operator',
      requestId: request.id,
      ...(body.paymentMethodToken === undefined
        ? {}
        : { paymentMethodToken: body.paymentMethodToken }),
    });
    return envelope(request, {
      invoiceId: result.invoiceId,
      mode: result.mode,
      collected: result.collected,
      replayed: result.replayed,
      attempt: result.attempt,
      gate: result.gate,
      fundsMoved: false,
    });
  });

  app.get('/ops/billing/collection', async (request) => {
    requireOnboardingOperator(presentedOperatorKey(request), operatorSecret());
    const gate = await container.collections.gate();
    return envelope(request, {
      mode: container.config.billingCollectionMode,
      billingLiveEnabled: container.config.billingLiveEnabled,
      gate,
      checklistRef: 'GO_LIVE_CHECKLIST.md#billing-collection',
    });
  });

  app.get('/dashboard/usage', async (request) => {
    const principal = requireOrganization(request);
    const query = parseOrThrow(usageQuery, request.query, 'query');
    const snapshot = await container.usageMetering.snapshot({
      organizationId: principal.organizationId,
      ...(query.periodStart === undefined ? {} : { periodStart: query.periodStart }),
    });
    const definition = tierDefinition(DEFAULT_SUBSCRIPTION_TIERS, snapshot.tier);
    return envelope(request, {
      ...snapshot,
      tierLabel: SUBSCRIPTION_TIER_LABELS[snapshot.tier],
      monthlyBaseMinorUnits: definition.monthlyBaseMinorUnits,
      overagePerCallMinorUnits: definition.overagePerCallMinorUnits,
      // What this period would be invoiced, not what has been paid. Nothing here is collected.
      collectionMode: container.config.billingCollectionMode,
      collected: false,
      pricesAreProvisional: true,
    });
  });

  app.get('/dashboard/invoices', async (request) => {
    const principal = requireOrganization(request);
    const query = parseOrThrow(dashboardListQuerySchema, request.query, 'query');
    const after = await resolveListCursor(
      query.cursor,
      (id) =>
        container.persistence.billing.getInvoiceForOrganization(principal.organizationId, id),
      (invoice) => ({ sortAt: invoice.issuedAt, id: invoice.id }),
    );
    const invoices = await container.persistence.billing.listInvoicesForOrganization(
      principal.organizationId,
      {
        limit: query.limit + 1,
        ...(after === undefined ? {} : { after }),
      },
    );
    const page = slicePage(invoices, query.limit, (invoice) => ({
      sortAt: invoice.issuedAt,
      id: invoice.id,
    }));
    return {
      data: {
        invoices: page.items.map(serializeInvoice),
        // Derived from the page rather than stated as a constant: once the §18.5 gate opens, a
        // fixed "deferred" would be the dashboard telling a customer their paid invoice is unpaid.
        collectionStatus: invoiceCollectionRollup(page.items),
      },
      meta: {
        mode: container.config.mode,
        disclaimer: container.disclaimer,
        requestId: request.id,
        limit: query.limit,
        nextCursor: page.nextCursor,
      },
    };
  });

  app.get('/dashboard/invoices/:id', async (request) => {
    const principal = requireOrganization(request);
    const { id } = parseOrThrow(idParams, request.params, 'params');
    const invoice = await container.persistence.billing.getInvoiceForOrganization(
      principal.organizationId,
      id,
    );
    if (invoice === null) {
      throw new NotFoundError('Invoice', id);
    }
    return envelope(request, serializeInvoice(invoice));
  });
}
