import {
  CURRENCY_REGISTRY,
  DEFAULT_SCORING_WEIGHTS,
  RAIL_REGISTRY,
  SUPPORTED_CURRENCIES,
  type PersistenceDriver,
} from '@meridian/core';
import type { FastifyInstance } from 'fastify';
import type { AppContainer } from '../container.js';

/**
 * Operational and discovery endpoints.
 *
 * `/health` answers whether the process is up; `/ready` answers whether it can actually serve
 * traffic, which for this service means the store is reachable and the schema is present. Keeping
 * them separate stops an orchestrator from restarting a healthy process because a database blipped.
 */
export function registerSystemRoutes(app: FastifyInstance, container: AppContainer): void {
  const startedAt = Date.now();

  app.get('/health', () => ({
    status: 'ok',
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
        checks: { persistence: 'failed' },
      });
    }
    return reply.send({
      status: 'ready',
      checks: { persistence: 'ok' },
      persistenceDriver: persistence.kind,
    });
  });

  app.get('/v1/meta', () => ({
    data: {
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
    },
  }));
}
