import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import type { AppContainer } from '../container.js';
import { registerAuthentication, registerRequestLogging } from '../http/authentication.js';
import { registerRateLimiting } from '../http/rate-limit.js';
import { registerAgentPaymentRoutes } from './agent-payments.js';
import { registerMandateRoutes } from './mandates.js';
import { registerPartnerInstructionRoutes } from './partner-instructions.js';
import { registerNlRoutingRoutes } from './nl-routing.js';
import { registerOnboardingRoutes } from './onboarding.js';
import { registerOpsRoutingRoutes } from './ops-routing.js';
import { registerBillingRoutes } from './billing.js';
import { registerApiKeyRoutes } from './api-keys.js';
import { registerAuthRoutes } from './auth.js';
import { registerMfaRoutes } from './auth-mfa.js';
import { registerOidcRoutes } from './auth-oidc.js';
import { registerComparisonRoutes } from './comparisons.js';
import { registerDashboardRoutes } from './dashboard.js';
import { registerDefiRoutes } from './defi-routes.js';
import { registerExecutionIntentRoutes } from './execution-intents.js';
import { registerExecutionRoutes } from './executions.js';
import { registerReceiptVerificationRoute } from './receipts.js';
import { registerReconciliationRoutes } from './reconciliation.js';
import { registerAuditExportRoute } from './audit-export.js';
import { registerFinancialRoutingRoutes } from './financial-routing.js';
import { registerOpenApiRoute } from './openapi.js';
import { registerProviderCatalogRoutes } from './providers.js';
import { registerRouteGraphRoutes } from './route-graph.js';
import { registerRoutingRoutes } from './routing.js';
import { registerSimulateRoute } from './simulate.js';
import { registerStablecoinRoutes } from './stablecoin-routes.js';
import {
  registerMetaRoutes,
  registerOperationalRoutes,
  registerVersionedHealthRoute,
} from './system.js';

/** Canonical prefix for version 1 of the API. */
export const API_V1_PREFIX = '/api/v1';

/**
 * The original unprefixed mount, kept so the first integrations do not break.
 *
 * Responses carry a `Deprecation` header pointing at the canonical prefix. It exists for one
 * version and then goes; a versioned API is only useful if retiring a version is routine.
 */
export const LEGACY_V1_PREFIX = '/v1';

export async function registerRoutes(app: FastifyInstance, container: AppContainer): Promise<void> {
  // Unversioned and unauthenticated, deliberately: an orchestrator should not have to track API
  // versions to decide whether a process is alive, and a liveness probe must not start failing
  // because a proxy attached a credential the service cannot verify.
  registerOperationalRoutes(app, container);

  // eslint-disable-next-line @typescript-eslint/require-await -- Fastify's plugin contract is async.
  const v1: FastifyPluginAsync = async (instance) => {
    // Registered inside the plugin so authentication is scoped to the versioned API by Fastify's
    // encapsulation, rather than applied globally and then excepted route by route.
    registerAuthentication(instance, container.authenticator, container.auditLogger);
    registerRateLimiting(instance, {
      settings: container.config.rateLimit,
      store: container.persistence.rateLimits,
      nowMs: () => container.clock.nowMs(),
    });
    registerRequestLogging(instance);
    registerVersionedHealthRoute(instance);
    registerMetaRoutes(instance, container);
    registerOpenApiRoute(instance);
    registerAuthRoutes(instance, container);
    registerMfaRoutes(instance, container);
    registerOidcRoutes(instance, container);
    registerComparisonRoutes(instance, container);
    registerRoutingRoutes(instance, container);
    registerSimulateRoute(instance, container);
    registerRouteGraphRoutes(instance, container);
    registerStablecoinRoutes(instance, container);
    registerDefiRoutes(instance, container);
    registerFinancialRoutingRoutes(instance, container);
    registerProviderCatalogRoutes(instance, container);
    registerApiKeyRoutes(instance, container);
    registerAgentPaymentRoutes(instance, container);
    registerMandateRoutes(instance, container);
    registerPartnerInstructionRoutes(instance, container);
    registerNlRoutingRoutes(instance, container);
    registerDashboardRoutes(instance, container);
    registerOnboardingRoutes(instance, container);
    registerOpsRoutingRoutes(instance, container);
    registerBillingRoutes(instance, container);
    registerExecutionIntentRoutes(instance, container);
    registerExecutionRoutes(instance, container);
    registerReceiptVerificationRoute(instance, container);
    registerReconciliationRoutes(instance, container);
    registerAuditExportRoute(instance, container);
  };

  await app.register(v1, { prefix: API_V1_PREFIX });

  await app.register(
    async (instance) => {
      instance.addHook('onSend', (_request, reply, payload, done) => {
        reply.header('Deprecation', 'true');
        reply.header('Link', `<${API_V1_PREFIX}>; rel="successor-version"`);
        done(null, payload);
      });
      await instance.register(v1);
    },
    { prefix: LEGACY_V1_PREFIX },
  );
}
