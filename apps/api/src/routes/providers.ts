import {
  noopLogger,
  NotFoundError,
  serializeFinancialProvider,
  serializeNormalizedQuote,
  type FinancialProviderDto,
  type NormalizedQuoteDto,
} from '@meridian/core';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { principalOf } from '../http/authentication.js';
import type { AppContainer } from '../container.js';
import {
  createProviderQuoteSchema,
  parseOrThrow,
  providerIdParamsSchema,
  resolveProviderQuoteRequest,
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
 * Multi-rail provider catalog and normalised quotes.
 *
 * This is not the comparison engine. `GET /providers` lists every financial adapter; `POST
 * /provider-quotes` asks one of them for an indicative price, including fiat ↔ stablecoin and
 * read-only DeFi pairs. Quotes are never executable.
 */
export function registerProviderCatalogRoutes(app: FastifyInstance, container: AppContainer): void {
  const envelope = <TData>(request: FastifyRequest, data: TData): ResponseEnvelope<TData> => ({
    data,
    meta: {
      mode: container.config.mode,
      disclaimer: container.disclaimer,
      requestId: request.id,
    },
  });

  app.get('/providers', (request) => {
    const providers = container.financialProviders.all().map(serializeFinancialProvider);
    return {
      data: { providers },
      meta: {
        mode: container.config.mode,
        disclaimer: container.disclaimer,
        requestId: request.id,
        count: providers.length,
      },
    };
  });

  app.get('/providers/:providerId', (request) => {
    const { providerId } = parseOrThrow(providerIdParamsSchema, request.params, 'params');
    const provider = container.financialProviders.get(providerId);
    if (provider === null) {
      throw new NotFoundError('Provider', providerId);
    }
    return envelope<FinancialProviderDto>(request, serializeFinancialProvider(provider));
  });

  app.post('/provider-quotes', async (request, reply) => {
    const body = parseOrThrow(createProviderQuoteSchema, request.body, 'body');
    const resolved = resolveProviderQuoteRequest(body);
    const provider = container.financialProviders.get(resolved.providerId);
    if (provider === null) {
      throw new NotFoundError('Provider', resolved.providerId);
    }

    const quote = await provider.getQuote(
      {
        sourceAsset: resolved.sourceAsset,
        targetAsset: resolved.targetAsset,
        amountMinorUnits: resolved.amountMinorUnits,
        requestedAt: container.clock.nowIso(),
      },
      {
        clock: container.clock,
        logger: noopLogger,
        requestId: request.id,
        signal: undefined,
      },
    );

    await container.auditLogger.record({
      type: 'provider.quote.received',
      actor: principalOf(request).actor,
      requestId: request.id,
      comparisonId: null,
      providerId: provider.descriptor.id,
      payload: {
        conversionKind: quote.conversionKind,
        sourceAsset: quote.sourceAsset,
        targetAsset: quote.targetAsset,
        executable: false,
      },
    });

    return reply
      .status(201)
      .send(envelope<NormalizedQuoteDto>(request, serializeNormalizedQuote(quote)));
  });
}
