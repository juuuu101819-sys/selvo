import {
  serializeAssetCatalog,
  serializeCurrencyCatalog,
  serializeFinancialQuote,
  serializeRouteSearch,
  type AssetCatalogEntryDto,
  type CurrencyCatalogEntryDto,
  type FinancialQuoteDto,
  type RouteSearchDto,
} from '@meridian/core';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AppContainer } from '../container.js';
import { assertClaimedOrganization, requireScope } from '../http/require-organization.js';
import {
  createFinancialQuoteSchema,
  parseOrThrow,
  resolveRouteRequest,
  resolveSearchRoutesRequest,
  searchRoutesSchema,
} from '../http/validation.js';

interface ResponseEnvelope<TData> {
  readonly data: TData;
  readonly meta: {
    readonly mode: string;
    readonly disclaimer: string;
    readonly requestId: string;
  };
}

/**
 * Versioned financial routing API.
 *
 * `POST /quote` ranks live multi-rail quotes. `POST /routes/search` discovers graph paths and
 * catalog providers for a pair without running a second quote engine. Catalog GETs are public.
 */
export function registerFinancialRoutingRoutes(
  app: FastifyInstance,
  container: AppContainer,
): void {
  const envelope = <TData>(request: FastifyRequest, data: TData): ResponseEnvelope<TData> => ({
    data,
    meta: {
      mode: container.config.mode,
      disclaimer: container.disclaimer,
      requestId: request.id,
    },
  });

  app.get('/assets', (request) => {
    return envelope<{ assets: readonly AssetCatalogEntryDto[] }>(request, {
      assets: serializeAssetCatalog(),
    });
  });

  app.get('/currencies', (request) => {
    return envelope<{ currencies: readonly CurrencyCatalogEntryDto[] }>(request, {
      currencies: serializeCurrencyCatalog(),
    });
  });

  app.post('/quote', async (request, reply) => {
    const body = parseOrThrow(createFinancialQuoteSchema, request.body, 'body');
    assertClaimedOrganization(request, body.organizationId);
    const principal = requireScope(request, 'quote:read');
    const resolved = resolveRouteRequest(body);

    const routing = await container.routing.evaluate({
      organizationId: principal.organizationId,
      sourceAsset: resolved.sourceAsset,
      destinationAsset: resolved.destinationAsset,
      amountMinorUnits: resolved.amountMinorUnits,
      weights: body.preferences?.weights ?? null,
      actor: principal.actor,
      requestId: request.id,
    });

    return reply
      .status(201)
      .send(envelope<FinancialQuoteDto>(request, serializeFinancialQuote(routing, request.id)));
  });

  app.post('/routes/search', async (request, reply) => {
    const body = parseOrThrow(searchRoutesSchema, request.body, 'body');
    assertClaimedOrganization(request, body.organizationId);
    const principal = requireScope(request, 'route:read');
    const resolved = resolveSearchRoutesRequest(body);

    const graph = await container.routeGraph.discover({
      organizationId: principal.organizationId,
      sourceAsset: resolved.sourceAsset,
      destinationAsset: resolved.destinationAsset,
      amountMinorUnits: resolved.amountMinorUnits,
      actor: principal.actor,
      requestId: request.id,
      ...(resolved.maxHops === undefined ? {} : { maxHops: resolved.maxHops }),
    });

    const matchingProviders = container.financialProviders.eligible({
      sourceAsset: resolved.sourceAsset,
      targetAsset: resolved.destinationAsset,
      amountMinorUnits: resolved.amountMinorUnits ?? '1',
      requestedAt: container.clock.nowIso(),
    });

    return reply.status(200).send(
      envelope<RouteSearchDto>(
        request,
        serializeRouteSearch({
          requestId: request.id,
          sourceAsset: resolved.sourceAsset,
          destinationAsset: resolved.destinationAsset,
          graph,
          matchingProviders,
        }),
      ),
    );
  });
}
