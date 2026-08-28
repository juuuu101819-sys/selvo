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
import { parseOrThrow } from '../http/validation.js';
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

const listQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) }).strict();
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
    const { limit } = parseOrThrow(listQuery, request.query, 'query');
    const invoices = await container.persistence.billing.listInvoicesForOrganization(
      principal.organizationId,
      { limit },
    );
    return envelope(request, {
      invoices: invoices.map(serializeInvoice),
      collectionStatus: 'deferred' as const,
    });
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
