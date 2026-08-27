import {
  ASSET_REGISTRY,
  CURRENCY_REGISTRY,
  DEFAULT_SCORING_WEIGHTS,
  INTERACTION_MODELS,
  PLATFORM_CAPABILITIES,
  PRODUCT,
  RAIL_FAMILY_REGISTRY,
  RAIL_REGISTRY,
  ROUTING_PIPELINE,
  SUPPORTED_CURRENCIES,
  serializeFinancialProvider,
  type PersistenceDriver,
} from '@meridian/core';
import type { FastifyInstance } from 'fastify';
import { SERVICE_NAME, SERVICE_VERSION } from '../config/service.js';
import { principalOf } from '../http/authentication.js';
import type { AppContainer } from '../container.js';

/**
 * Liveness and readiness, mounted without a version prefix.
 *
 * `/health` answers whether the process is up; `/ready` answers whether it can serve traffic, which
 * for this service means the store is reachable and its schema present. Keeping them separate stops
 * an orchestrator restarting a healthy process because a database blipped.
 */
export function registerOperationalRoutes(app: FastifyInstance, container: AppContainer): void {
  const startedAt = Date.now();

  app.get('/health', () => ({
    status: 'ok',
    service: SERVICE_NAME,
    version: SERVICE_VERSION,
    mode: container.config.mode,
    engineVersion: container.engineVersion,
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
  }));

  app.get('/ready', async (_request, reply) => {
    const persistence: PersistenceDriver = container.persistence;
    try {
      await persistence.healthCheck();
    } catch (error) {
      app.log.error({ err: error }, 'Readiness check failed');
      return reply.status(503).send({
        status: 'unavailable',
        service: SERVICE_NAME,
        checks: { persistence: 'failed' },
      });
    }
    return reply.send({
      status: 'ready',
      service: SERVICE_NAME,
      checks: { persistence: 'ok' },
      persistenceDriver: persistence.kind,
    });
  });
}

/**
 * The versioned health endpoint.
 *
 * Its response is a fixed three-field contract — status, service, version — with no envelope and
 * nothing derived from runtime state. A health check that changes shape as the service evolves is
 * a health check that eventually breaks the monitor watching it.
 */
export function registerVersionedHealthRoute(app: FastifyInstance): void {
  app.get('/health', () => ({
    status: 'ok',
    service: SERVICE_NAME,
    version: SERVICE_VERSION,
  }));
}

/** Discovery: everything a client needs to build a valid comparison request. */
export function registerMetaRoutes(app: FastifyInstance, container: AppContainer): void {
  app.get('/meta', (request) => ({
    data: {
      service: SERVICE_NAME,
      version: SERVICE_VERSION,
      mode: container.config.mode,
      engineVersion: container.engineVersion,
      product: {
        kind: PRODUCT.kind,
        name: PRODUCT.name,
        positioning: PRODUCT.positioning,
        scope: [...PRODUCT.scope],
        customers: [...PRODUCT.customers],
        notFor: [...PRODUCT.notFor],
      },
      pipeline: ROUTING_PIPELINE.map((stage) => ({
        id: stage.id,
        label: stage.label,
        status: stage.status,
      })),
      railFamilies: Object.values(RAIL_FAMILY_REGISTRY),
      interactionModels: INTERACTION_MODELS.map((model) => ({
        id: model.id,
        payer: model.payer,
        payee: model.payee,
        label: model.label,
        status: model.status,
      })),
      /** Non-custodial by design; see docs/COMPLIANCE.md. Single source: PLATFORM_CAPABILITIES. */
      capabilities: { ...PLATFORM_CAPABILITIES },
      execution: {
        implemented: false,
        delegated: PLATFORM_CAPABILITIES.delegateExecution,
        statusCode: 501,
        reason:
          'Meridian discovers and ranks routes. Settlement is delegated to licensed or authorized ' +
          'providers. Direct execution, custody and private-key control are out of scope and not implemented.',
      },
      authentication: {
        scheme: container.authenticator.scheme,
        enforcing: container.authenticator.enforcing,
        principalKind: principalOf(request).kind,
        economicActor: principalOf(request).economicActor,
      },
      persistenceDriver: container.persistence.kind,
      pricing: container.pricing,
      defaultScoringWeights: container.config.weights,
      platformDefaultScoringWeights: DEFAULT_SCORING_WEIGHTS,
      providerTimeoutMs: container.config.providerTimeoutMs,
      providers: container.providers.map((provider) => ({
        id: provider.id,
        name: provider.name,
        rail: provider.rail,
        railLabel: RAIL_REGISTRY[provider.rail].label,
        licensing: provider.licensing,
        jurisdictions: provider.jurisdictions,
        description: provider.description,
        pricingVersion: provider.pricingVersion,
      })),
      rails: Object.values(RAIL_REGISTRY),
      currencies: SUPPORTED_CURRENCIES.map((code) => CURRENCY_REGISTRY[code]),
      assets: Object.values(ASSET_REGISTRY),
      providerCatalog: {
        categories: ['traditional', 'stablecoin', 'defi'],
        providers: container.financialProviders.all().map(serializeFinancialProvider),
      },
    },
    meta: {
      mode: container.config.mode,
      disclaimer: container.disclaimer,
      requestId: request.id,
    },
  }));
}
