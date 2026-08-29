import {
  NotFoundError,
  reconcilePeriod,
  runMonthlyBilling,
  serializeBillingRunResult,
  serializeInvoice,
  serializeReconciliationReport,
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
        collectionStatus: 'deferred' as const,
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
