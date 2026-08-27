import { NotFoundError, serializeMonetizationReport } from '@meridian/core';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppContainer } from '../container.js';
import { requireOrganization } from '../http/require-organization.js';
import { parseOrThrow } from '../http/validation.js';

const listQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) }).strict();
const idParams = z.object({ id: z.string().min(1).max(128) }).strict();

interface Envelope<TData> {
  readonly data: TData;
  readonly meta: { readonly mode: string; readonly disclaimer: string; readonly requestId: string };
}

export function registerDashboardRoutes(app: FastifyInstance, container: AppContainer): void {
  const envelope = <TData>(request: FastifyRequest, data: TData): Envelope<TData> => ({
    data,
    meta: {
      mode: container.config.mode,
      disclaimer: container.disclaimer,
      requestId: request.id,
    },
  });

  app.get('/dashboard/metrics', async (request) => {
    const principal = requireOrganization(request);
    const metrics = await container.persistence.dashboard.metrics(principal.organizationId);
    const volume = await container.persistence.dashboard.volumeByDay(principal.organizationId, 30);
    const cost = await container.persistence.dashboard.costByDay(principal.organizationId, 30);
    const providers = await container.persistence.dashboard.quotesByProvider(
      principal.organizationId,
    );
    return envelope(request, {
      metrics,
      charts: { volumeByDay: volume, costByDay: cost, providers },
    });
  });

  app.get('/dashboard/quotes', async (request) => {
    const principal = requireOrganization(request);
    const { limit } = parseOrThrow(listQuery, request.query, 'query');
    const quotes = await container.persistence.dashboard.listQuotes(principal.organizationId, {
      limit,
    });
    return envelope(request, { quotes });
  });

  app.get('/dashboard/quotes/:id', async (request) => {
    const principal = requireOrganization(request);
    const { id } = parseOrThrow(idParams, request.params, 'params');
    const quote = await container.persistence.dashboard.getQuote(principal.organizationId, id);
    if (quote === null) {
      throw new NotFoundError('Quote', id);
    }
    return envelope(request, quote);
  });

  app.get('/dashboard/transactions', async (request) => {
    const principal = requireOrganization(request);
    const { limit } = parseOrThrow(listQuery, request.query, 'query');
    const transactions = await container.persistence.dashboard.listTransactions(
      principal.organizationId,
      { limit },
    );
    return envelope(request, { transactions });
  });

  app.get('/dashboard/transactions/:id', async (request) => {
    const principal = requireOrganization(request);
    const { id } = parseOrThrow(idParams, request.params, 'params');
    const transaction = await container.persistence.dashboard.getTransaction(
      principal.organizationId,
      id,
    );
    if (transaction === null) {
      throw new NotFoundError('TransactionRequest', id);
    }
    return envelope(request, transaction);
  });

  app.get('/dashboard/providers', async (request) => {
    const principal = requireOrganization(request);
    const providers = await container.persistence.dashboard.quotesByProvider(
      principal.organizationId,
    );
    return envelope(request, { providers });
  });

  app.get('/dashboard/revenue', async (request) => {
    const principal = requireOrganization(request);
    const report = await container.persistence.dashboard.revenue(principal.organizationId);
    return envelope(request, serializeMonetizationReport(report));
  });

  app.get('/dashboard/settings', async (request) => {
    const principal = requireOrganization(request);
    const [organization, members, apiKeys] = await Promise.all([
      container.persistence.identity.findOrganization(principal.organizationId),
      container.persistence.identity.listMembers(principal.organizationId),
      container.persistence.identity.listApiKeys(principal.organizationId),
    ]);
    return envelope(request, {
      organization,
      members,
      apiKeys,
      role: principal.roles[0] ?? null,
    });
  });
}
