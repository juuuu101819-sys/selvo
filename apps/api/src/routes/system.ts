import {
  CURRENCY_REGISTRY,
  DEFAULT_SCORING_WEIGHTS,
  RAIL_REGISTRY,
  SUPPORTED_CURRENCIES,
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
      /** Non-custodial by design; see docs/COMPLIANCE.md. */
      capabilities: {
        compareRoutes: true,
        executeTransactions: false,
        custodyFunds: false,
        holdCryptoAssets: false,
        issueStablecoins: false,
      },
      authentication: {
        scheme: container.authenticator.scheme,
        enforcing: container.authenticator.enforcing,
        principalKind: principalOf(request).kind,
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
    },
    meta: {
      mode: container.config.mode,
      disclaimer: container.disclaimer,
      requestId: request.id,
    },
  }));
}
