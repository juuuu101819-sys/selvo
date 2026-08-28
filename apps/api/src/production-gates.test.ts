import {
  ConfigurationError,
  DEMO_AGENT_SECRET,
  FixedClock,
  noopLogger,
} from '@meridian/core';
import { InMemoryPersistenceDriver } from '@meridian/persistence';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { IdentityAuthenticator } from './auth/identity-authenticator.js';
import { provisionDemoTenants } from './auth/provision-demo.js';
import { loadConfig } from './config/env.js';
import { createContainer } from './container.js';
import { API_V1_PREFIX } from './routes/index.js';

const PRODUCTION_AUTH_SECRET = 'unit-test-production-auth-secret-ok';

function productionConfig(overrides: Record<string, string> = {}) {
  return loadConfig({
    NODE_ENV: 'test',
    PLATFORM_MODE: 'production',
    DATABASE_DRIVER: 'postgres',
    DATABASE_URL: 'postgres://meridian:meridian@127.0.0.1:5432/meridian_gate_test',
    AUTH_SECRET: PRODUCTION_AUTH_SECRET,
    LOG_LEVEL: 'silent',
    ...overrides,
  });
}

describe('PA-C01 production provider gate', () => {
  it('starts production read-only when no licensed adapters are configured', async () => {
    const container = createContainer({ config: productionConfig(), logger: noopLogger });
    try {
      expect(container.registry.all()).toEqual([]);
      expect(container.financialProviders.all()).toEqual([]);
      expect(container.providers).toEqual([]);
      expect(container.routeGraph.getGraph().nodes).toEqual([]);
      expect(container.routeGraph.getGraph().edges).toEqual([]);
      expect(container.config.productionGates).toEqual({
        routingAvailable: false,
        executionAvailable: false,
      });
      expect(container.disclaimer).toMatch(/does not\s+\n?execute|does not execute/i);
    } finally {
      await container.close();
    }
  });

  it('fails closed when PRODUCTION_ROUTING_AVAILABLE is true without licensed adapters', () => {
    expect(() =>
      createContainer({
        config: productionConfig({ PRODUCTION_ROUTING_AVAILABLE: 'true' }),
        logger: noopLogger,
      }),
    ).toThrow(/licensed partner adapter/i);
    expect(() =>
      createContainer({
        config: productionConfig({ PRODUCTION_ROUTING_AVAILABLE: 'true' }),
        logger: noopLogger,
      }),
    ).toThrow(ConfigurationError);
  });

  it('exposes that routing and execution are unavailable on /meta', async () => {
    const { app } = await createApp({ config: productionConfig() });
    try {
      await app.ready();
      const health = await app.inject({ method: 'GET', url: '/health' });
      expect(health.statusCode).toBe(200);
      expect(health.json()).toMatchObject({ status: 'ok', mode: 'production' });

      const meta = await app.inject({ method: 'GET', url: `${API_V1_PREFIX}/meta` });
      expect(meta.statusCode).toBe(200);
      const data = meta.json<{
        data: {
          productionGates: { routingAvailable: boolean; executionAvailable: boolean };
          execution: { implemented: boolean; statusCode: number };
          deployment: { environment: string };
          providers: unknown[];
          providerCatalog: { providers: unknown[] };
        };
      }>().data;
      expect(data.productionGates).toEqual({
        routingAvailable: false,
        executionAvailable: false,
      });
      expect(data.execution).toMatchObject({ implemented: false, statusCode: 501 });
      expect(data.deployment.environment).toBe('production');
      expect(data.providers).toEqual([]);
      expect(data.providerCatalog.providers).toEqual([]);
      expect(JSON.stringify(meta.json())).not.toContain(PRODUCTION_AUTH_SECRET);
    } finally {
      await app.close();
    }
  });

  it('returns 422 rather than sandbox quotes when the licensed registry is empty', async () => {
    const { app } = await createApp({ config: productionConfig() });
    try {
      await app.ready();
      const compared = await app.inject({
        method: 'POST',
        url: `${API_V1_PREFIX}/comparisons`,
        payload: { sourceCurrency: 'USD', targetCurrency: 'KRW', amount: '1000.00' },
      });
      expect(compared.statusCode).toBe(422);
      expect(compared.json<{ error: { code: string } }>().error.code).toMatch(
        /UNSUPPORTED_CORRIDOR|NO_ROUTES_AVAILABLE/,
      );

      const executed = await app.inject({ method: 'POST', url: `${API_V1_PREFIX}/executions` });
      expect(executed.statusCode).toBe(501);
    } finally {
      await app.close();
    }
  });
});

describe('PA-C02 demo credential rejection', () => {
  it('refuses to provision demo tenants when productionLocked is set', async () => {
    const persistence = new InMemoryPersistenceDriver();
    await expect(
      provisionDemoTenants(
        {
          identity: persistence.identity,
          dashboard: persistence.dashboard,
          agentPayments: persistence.agentPayments,
        },
        { productionLocked: true },
      ),
    ).rejects.toThrow(ConfigurationError);
  });

  it('rejects the documented demo agent secret when rejectDemoSecrets is set', async () => {
    const persistence = new InMemoryPersistenceDriver();
    const clock = new FixedClock('2026-03-01T09:00:00.000Z');
    await provisionDemoTenants({
      identity: persistence.identity,
      dashboard: persistence.dashboard,
      agentPayments: persistence.agentPayments,
    });

    const rejecting = new IdentityAuthenticator(
      persistence.identity,
      clock,
      persistence.agentPayments,
      { rejectDemoSecrets: true, sessionTokenPepper: 'test-session-pepper' },
    );
    const rejected = await rejecting.authenticate({
      authorization: `Bearer ${DEMO_AGENT_SECRET}`,
      apiKey: null,
      declaredActor: null,
    });
    expect(rejected).toBeNull();

    const sandbox = new IdentityAuthenticator(
      persistence.identity,
      clock,
      persistence.agentPayments,
      { sessionTokenPepper: 'test-session-pepper' },
    );
    const accepted = await sandbox.authenticate({
      authorization: `Bearer ${DEMO_AGENT_SECRET}`,
      apiKey: null,
      declaredActor: null,
    });
    expect(accepted?.kind).toBe('agent');
  });
});

describe('createContainer productionLocked memory defense', () => {
  it('does not start a production-locked container on the memory driver', () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      PLATFORM_MODE: 'sandbox',
      DATABASE_DRIVER: 'memory',
    });
    expect(() =>
      createContainer({
        config: { ...config, productionLocked: true, mode: 'production' },
        logger: noopLogger,
      }),
    ).toThrow(/memory is forbidden/);
  });
});
