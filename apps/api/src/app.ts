import { randomUUID } from 'node:crypto';
import cors from '@fastify/cors';
import { ValidationError, type Clock } from '@meridian/core';
import Fastify, { type FastifyInstance } from 'fastify';
import { provisionDemoTenants } from './auth/provision-demo.js';
import type { OidcClient } from './auth/oidc-client.js';
import { shouldProvisionDemoTenants, type AppConfig } from './config/env.js';
import { createContainer, type AppContainer } from './container.js';
import { registerErrorHandling } from './http/errors.js';
import { PinoLoggerAdapter } from './logging/pino-logger.js';
import { registerImplementedRouteCollector, type ImplementedRoute } from './openapi/implemented.js';
import { registerRoutes } from './routes/index.js';

/** One megabyte is far more than any comparison request needs, and bounds the attack surface. */
const MAX_BODY_BYTES = 1_048_576;

export interface BuiltApp {
  readonly app: FastifyInstance;
  readonly container: AppContainer;
  readonly implementedRoutes: readonly ImplementedRoute[];
}

export interface CreateAppOptions {
  readonly config: AppConfig;
  /** Injectable so tests can pin timestamps and assert on reproducible output. */
  readonly clock?: Clock;
  readonly oidcClient?: OidcClient;
}

export async function createApp(options: CreateAppOptions): Promise<BuiltApp> {
  const { config } = options;

  const app = Fastify({
    logger: {
      level: config.logLevel,
      ...(config.logPretty
        ? { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss.l' } } }
        : {}),
      // Financial payloads must not end up in logs verbatim; the audit trail is the record.
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.headers["idempotency-key"]',
          'req.headers["x-api-key"]',
          'req.body.password',
          'req.body.privateKey',
          'req.body.secret',
          'req.body.apiKey',
          'req.body.token',
          'req.body.wallet',
          'req.body.code',
          'req.body.challengeToken',
          'req.body.clientSecret',
          'req.body.totpCode',
          'req.body.recoveryCodes',
          '*.password',
          '*.privateKey',
          '*.secret',
          '*.AUTH_SECRET',
          '*.authSecret',
          '*.DATABASE_URL',
          '*.databaseUrl',
          '*.apiKey',
          '*.token',
          '*.wallet',
        ],
        remove: true,
      },
    },
    genReqId: () => `req_${randomUUID().replaceAll('-', '')}`,
    bodyLimit: MAX_BODY_BYTES,
  });

  const container = createContainer({
    config,
    logger: new PinoLoggerAdapter(app.log),
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    ...(options.oidcClient === undefined ? {} : { oidcClient: options.oidcClient }),
  });

  await app.register(cors, {
    origin: config.corsOrigins.length > 0 ? [...config.corsOrigins] : false,
    methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Idempotency-Key',
      'X-Meridian-Actor',
      'Authorization',
      'X-Api-Key',
    ],
    exposedHeaders: ['X-Request-Id', 'Deprecation', 'Link'],
    maxAge: 600,
  });

  app.addHook('onRequest', (request, reply, done) => {
    reply.header('X-Request-Id', request.id);
    done();
  });

  registerJsonBodyParser(app);

  registerErrorHandling(app);
  const snapshotImplementedRoutes = registerImplementedRouteCollector(app);
  await registerRoutes(app, container);

  // Demo tenants are sandbox fixtures. Production-locked processes never seed them. Tests seed
  // only when SEED_DEMO_TENANTS=true (Playwright). Local development keeps the historical auto-seed.
  if (shouldProvisionDemoTenants(config)) {
    await provisionDemoTenants(
      {
        identity: container.persistence.identity,
        dashboard: container.persistence.dashboard,
        agentPayments: container.persistence.agentPayments,
        auditLog: container.persistence.auditLog,
      },
      {
        seedDashboard: container.persistence.kind === 'memory',
        nowIso: container.clock.nowIso(),
        productionLocked: config.productionLocked,
      },
    );
  }

  app.addHook('onClose', async () => {
    await container.close();
  });

  return { app, container, implementedRoutes: snapshotImplementedRoutes() };
}

/**
 * Accepts an empty body on a JSON request.
 *
 * `POST /v1/comparisons/:id/replay` and `POST /v1/executions` take no body, but virtually every
 * HTTP client sets `content-type: application/json` on a POST regardless. Fastify's default parser
 * rejects that combination outright, which made those endpoints unusable from a normal client for
 * no good reason. An absent body is simply treated as `{}`.
 */
function registerJsonBodyParser(app: FastifyInstance): void {
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (_request, body: string, done) => {
      if (body.trim() === '') {
        done(null, {});
        return;
      }
      try {
        done(null, JSON.parse(body));
      } catch {
        done(
          new ValidationError('Request body is not valid JSON.', {
            reason: 'malformed_json',
          }),
        );
      }
    },
  );
}
