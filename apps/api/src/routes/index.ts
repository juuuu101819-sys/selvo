import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import type { AppContainer } from '../container.js';
import { registerAuthentication } from '../http/authentication.js';
import { registerComparisonRoutes } from './comparisons.js';
import { registerExecutionRoutes } from './executions.js';
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
    registerAuthentication(instance, container.authenticator);
    registerVersionedHealthRoute(instance);
    registerMetaRoutes(instance, container);
    registerComparisonRoutes(instance, container);
    registerExecutionRoutes(instance, container);
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
