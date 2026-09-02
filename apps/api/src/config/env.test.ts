import { ConfigurationError, DEFAULT_SCORING_WEIGHTS } from '@meridian/core';
import { describe, expect, it } from 'vitest';
import { disclaimerFor, loadConfig, shouldProvisionDemoTenants } from './env.js';

describe('loadConfig', () => {
  it('defaults to sandbox mode with the in-memory store', () => {
    const config = loadConfig({});

    expect(config.mode).toBe('sandbox');
    expect(config.database.driver).toBe('memory');
    expect(config.port).toBe(47_311);
    expect(config.executionEnabled).toBe(false);
    expect(config.billingLiveEnabled).toBe(false);
    expect(config.partnerLiveEnabled).toBe(false);
  });

  it('disables rate limiting in tests unless RATE_LIMIT_MAX is set', () => {
    expect(loadConfig({}).rateLimit.enabled).toBe(true);
    expect(loadConfig({ NODE_ENV: 'test' }).rateLimit.enabled).toBe(false);
    expect(loadConfig({ NODE_ENV: 'test', RATE_LIMIT_MAX: '2' }).rateLimit).toEqual({
      enabled: true,
      windowMs: 60_000,
      max: 2,
    });
  });

  it('reads all six scoring weights from the environment', () => {
    const config = loadConfig({
      ROUTE_WEIGHT_COST: '0.5',
      ROUTE_WEIGHT_SPEED: '0.2',
      ROUTE_WEIGHT_RELIABILITY: '0.1',
      ROUTE_WEIGHT_SLIPPAGE: '0.1',
      ROUTE_WEIGHT_LIQUIDITY: '0.05',
      ROUTE_WEIGHT_RISK: '0.05',
    });

    expect(config.weights).toEqual({
      cost: '0.5',
      speed: '0.2',
      reliability: '0.1',
      slippage: '0.1',
      liquidity: '0.05',
      risk: '0.05',
    });
  });

  it('defaults every weight to the engine default, so the two cannot drift', () => {
    expect(loadConfig({}).weights).toEqual(DEFAULT_SCORING_WEIGHTS);
  });

  /**
   * Overriding some weights and not others changes the sum, which would silently rescale every
   * score. Failing at startup is the only safe response.
   */
  it('rejects a partial override that no longer sums to one', () => {
    expect(() => loadConfig({ ROUTE_WEIGHT_COST: '0.5', ROUTE_WEIGHT_SPEED: '0.4' })).toThrow(
      /sum to exactly 1/,
    );
  });

  it('fails at startup on weights that do not sum to one', () => {
    expect(() =>
      loadConfig({
        ROUTE_WEIGHT_COST: '0.9',
        ROUTE_WEIGHT_SPEED: '0.9',
        ROUTE_WEIGHT_RELIABILITY: '0.9',
      }),
    ).toThrow(/sum to exactly 1/);
  });

  it('requires a database URL when the postgres driver is selected', () => {
    expect(() => loadConfig({ DATABASE_DRIVER: 'postgres' })).toThrow(ConfigurationError);
  });

  it('accepts the postgres driver when a URL is provided', () => {
    const config = loadConfig({
      DATABASE_DRIVER: 'postgres',
      DATABASE_URL: 'postgres://user:pass@localhost:5432/meridian',
    });

    expect(config.database.driver).toBe('postgres');
    expect(config.database.url).toContain('postgres://');
  });

  it('rejects an unknown platform mode', () => {
    expect(() => loadConfig({ PLATFORM_MODE: 'wild-west' })).toThrow(ConfigurationError);
  });

  it('rejects a port outside the valid range', () => {
    expect(() => loadConfig({ API_PORT: '99999' })).toThrow(ConfigurationError);
  });

  it('parses a comma-separated CORS allow list', () => {
    const config = loadConfig({ CORS_ORIGINS: 'http://a.test , http://b.test' });
    expect(config.corsOrigins).toEqual(['http://a.test', 'http://b.test']);
  });

  it('reports which variable was invalid', () => {
    try {
      loadConfig({ PROVIDER_TIMEOUT_MS: 'soon' });
      expect.unreachable('expected a configuration error');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError);
      expect(JSON.stringify((error as ConfigurationError).details)).toContain(
        'PROVIDER_TIMEOUT_MS',
      );
    }
  });
});

const PRODUCTION_AUTH_SECRET = 'unit-test-production-auth-secret-ok';

function productionSource(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'production',
    PLATFORM_MODE: 'production',
    DATABASE_DRIVER: 'postgres',
    DATABASE_URL: 'postgres://meridian:meridian@127.0.0.1:5432/meridian',
    AUTH_SECRET: PRODUCTION_AUTH_SECRET,
    ...overrides,
  };
}

function issuesOf(source: NodeJS.ProcessEnv): string {
  try {
    loadConfig(source);
    return '';
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigurationError);
    return JSON.stringify((error as ConfigurationError).details);
  }
}

describe('PA-C03 database production gate', () => {
  it('fails closed when NODE_ENV=production and DATABASE_DRIVER=memory', () => {
    const issues = issuesOf(
      productionSource({ NODE_ENV: 'production', PLATFORM_MODE: 'sandbox', DATABASE_DRIVER: 'memory' }),
    );
    expect(issues).toMatch(/DATABASE_DRIVER/);
    expect(issues).toMatch(/memory is forbidden/);
  });

  it('fails closed when PLATFORM_MODE=production and DATABASE_DRIVER=memory', () => {
    const issues = issuesOf(
      productionSource({ NODE_ENV: 'test', PLATFORM_MODE: 'production', DATABASE_DRIVER: 'memory' }),
    );
    expect(issues).toMatch(/DATABASE_DRIVER/);
    expect(issues).toMatch(/memory is forbidden/);
  });

  it('passes configuration validation for production + postgres when secrets are set', () => {
    const config = loadConfig(productionSource());
    expect(config.database.driver).toBe('postgres');
    expect(config.productionLocked).toBe(true);
    expect(config.productionGates).toEqual({
      routingAvailable: false,
      executionAvailable: false,
    });
    expect(config.sessionTokenPepper).not.toBe(PRODUCTION_AUTH_SECRET);
    expect(config.sessionTokenPepper).toHaveLength(64);
    expect(config.dataEncryptionKey).not.toBe(PRODUCTION_AUTH_SECRET);
    expect(config.dataEncryptionKey).toHaveLength(64);
    expect(config.dataEncryptionKey).not.toBe(config.sessionTokenPepper);
    expect(config.deployment).toEqual({ environment: 'production', imageTag: null });
  });

  it('allows development + memory', () => {
    const config = loadConfig({ NODE_ENV: 'development', DATABASE_DRIVER: 'memory' });
    expect(config.database.driver).toBe('memory');
    expect(config.productionLocked).toBe(false);
  });

  it('allows test + memory', () => {
    const config = loadConfig({ NODE_ENV: 'test', DATABASE_DRIVER: 'memory' });
    expect(config.database.driver).toBe('memory');
    expect(config.productionLocked).toBe(false);
  });
});

describe('PA-C02 production secret gate', () => {
  it('rejects a missing production AUTH_SECRET', () => {
    const issues = issuesOf(productionSource({ AUTH_SECRET: undefined }));
    expect(issues).toMatch(/AUTH_SECRET/);
    expect(issues).toMatch(/required/);
    expect(issues).not.toMatch(PRODUCTION_AUTH_SECRET);
  });

  it('rejects a too-short production AUTH_SECRET that is not a known demo value', () => {
    const issues = issuesOf(productionSource({ AUTH_SECRET: 'short-but-unique-value' }));
    expect(issues).toMatch(/AUTH_SECRET/);
    expect(issues).toMatch(/at least 32/);
    expect(issues).not.toContain('short-but-unique-value');
  });

  it('rejects the documented demo password as AUTH_SECRET', () => {
    const issues = issuesOf(productionSource({ AUTH_SECRET: 'MeridianDemo!2026' }));
    expect(issues).toMatch(/AUTH_SECRET/);
    expect(issues).toMatch(/demo password|demo secret|default credential/i);
    expect(issues).not.toContain('MeridianDemo!2026');
  });

  it('rejects the documented demo agent secret as AUTH_SECRET', () => {
    const issues = issuesOf(
      productionSource({ AUTH_SECRET: 'mag_demo_agent01_sandbox_only_not_production' }),
    );
    expect(issues).toMatch(/AUTH_SECRET/);
    expect(issues).not.toContain('mag_demo_agent01_sandbox_only_not_production');
  });

  it('rejects a default credential fallback as AUTH_SECRET', () => {
    const issues = issuesOf(
      productionSource({ AUTH_SECRET: 'changemechangemechangemechangeme' }),
    );
    expect(issues).toMatch(/AUTH_SECRET/);
    expect(issues).not.toContain('changemechangemechangemechangeme');
  });

  it('rejects SEED_DEMO_TENANTS in production', () => {
    const issues = issuesOf(productionSource({ SEED_DEMO_TENANTS: 'true' }));
    expect(issues).toMatch(/SEED_DEMO_TENANTS/);
  });

  it('never copies AUTH_SECRET onto the loaded config object', () => {
    const config = loadConfig(productionSource());
    expect(config.authSecretConfigured).toBe(true);
    expect(JSON.stringify(config)).not.toContain(PRODUCTION_AUTH_SECRET);
    expect(config).not.toHaveProperty('authSecret');
    expect(config).not.toHaveProperty('AUTH_SECRET');
  });
});

describe('PA-C01 production routing and execution flags', () => {
  it('keeps PRODUCTION_EXECUTION_AVAILABLE independently false and rejects true', () => {
    const issues = issuesOf(productionSource({ PRODUCTION_EXECUTION_AVAILABLE: 'true' }));
    expect(issues).toMatch(/PRODUCTION_EXECUTION_AVAILABLE/);
    expect(issues).toMatch(/cannot be true/);

    const config = loadConfig(productionSource({ PRODUCTION_EXECUTION_AVAILABLE: 'false' }));
    expect(config.productionGates.executionAvailable).toBe(false);
    expect(config.productionGates.routingAvailable).toBe(false);
  });

  it('accepts PRODUCTION_ROUTING_AVAILABLE=true at config time (adapters are checked later)', () => {
    const config = loadConfig(productionSource({ PRODUCTION_ROUTING_AVAILABLE: 'true' }));
    expect(config.productionGates.routingAvailable).toBe(true);
    expect(config.productionGates.executionAvailable).toBe(false);
  });

  it('rejects EXECUTION_ENABLED=true in a production-locked process', () => {
    const issues = issuesOf(productionSource({ EXECUTION_ENABLED: 'true' }));
    expect(issues).toMatch(/EXECUTION_ENABLED/);
    expect(issues).toMatch(/cannot be true/);
  });

  it('accepts EXECUTION_ENABLED=true only in sandbox', () => {
    const config = loadConfig({ NODE_ENV: 'development', PLATFORM_MODE: 'sandbox', EXECUTION_ENABLED: 'true' });
    expect(config.executionEnabled).toBe(true);
    expect(config.productionLocked).toBe(false);
  });

  it('defaults BILLING_LIVE_ENABLED to false and does not collect by flag alone', () => {
    const config = loadConfig({ NODE_ENV: 'development', PLATFORM_MODE: 'sandbox' });
    expect(config.billingLiveEnabled).toBe(false);
    const enabled = loadConfig({
      NODE_ENV: 'development',
      PLATFORM_MODE: 'sandbox',
      BILLING_LIVE_ENABLED: 'true',
    });
    expect(enabled.billingLiveEnabled).toBe(true);
  });

  it('rejects PRODUCTION_ROUTING_AVAILABLE outside production mode', () => {
    const issues = issuesOf({
      NODE_ENV: 'development',
      PLATFORM_MODE: 'sandbox',
      PRODUCTION_ROUTING_AVAILABLE: 'true',
    });
    expect(issues).toMatch(/PRODUCTION_ROUTING_AVAILABLE/);
  });
});

describe('DEPLOY_ENV staging parity', () => {
  it('defaults a production-locked process to deployment.environment=production', () => {
    expect(loadConfig(productionSource()).deployment.environment).toBe('production');
  });

  it('accepts DEPLOY_ENV=staging with the same fail-closed gates as production', () => {
    const config = loadConfig(productionSource({ DEPLOY_ENV: 'staging', MERIDIAN_IMAGE_TAG: 'abc123' }));
    expect(config.deployment).toEqual({ environment: 'staging', imageTag: 'abc123' });
    expect(config.productionLocked).toBe(true);
    expect(config.database.driver).toBe('postgres');
    expect(config.productionGates.executionAvailable).toBe(false);
    expect(shouldProvisionDemoTenants(config)).toBe(false);
  });

  it('fails closed when DEPLOY_ENV=staging uses the memory driver', () => {
    const issues = issuesOf(
      productionSource({ DEPLOY_ENV: 'staging', DATABASE_DRIVER: 'memory', DATABASE_URL: undefined }),
    );
    expect(issues).toMatch(/DATABASE_DRIVER/);
    expect(issues).toMatch(/memory is forbidden/);
  });

  it('fails closed when DEPLOY_ENV=staging tries to seed demo tenants', () => {
    const issues = issuesOf(productionSource({ DEPLOY_ENV: 'staging', SEED_DEMO_TENANTS: 'true' }));
    expect(issues).toMatch(/SEED_DEMO_TENANTS/);
  });

  it('fails closed when DEPLOY_ENV=staging is not production-locked', () => {
    const issues = issuesOf({
      NODE_ENV: 'development',
      PLATFORM_MODE: 'sandbox',
      DEPLOY_ENV: 'staging',
    });
    expect(issues).toMatch(/DEPLOY_ENV/);
    expect(issues).toMatch(/not a relaxed sandbox/);
  });

  it('rejects labelling a production-locked process as development', () => {
    const issues = issuesOf(productionSource({ DEPLOY_ENV: 'development' }));
    expect(issues).toMatch(/DEPLOY_ENV/);
  });

  it('rejects the same forbidden drivers and demo secrets in staging as in production', () => {
    const memoryProduction = issuesOf(
      productionSource({ DATABASE_DRIVER: 'memory', DATABASE_URL: undefined }),
    );
    const memoryStaging = issuesOf(
      productionSource({
        DEPLOY_ENV: 'staging',
        DATABASE_DRIVER: 'memory',
        DATABASE_URL: undefined,
      }),
    );
    expect(memoryProduction).toMatch(/memory is forbidden/);
    expect(memoryStaging).toMatch(/memory is forbidden/);

    const demoProduction = issuesOf(productionSource({ AUTH_SECRET: 'MeridianDemo!2026' }));
    const demoStaging = issuesOf(
      productionSource({ DEPLOY_ENV: 'staging', AUTH_SECRET: 'MeridianDemo!2026' }),
    );
    expect(demoProduction).toMatch(/AUTH_SECRET/);
    expect(demoStaging).toMatch(/AUTH_SECRET/);
    expect(demoStaging).not.toContain('MeridianDemo!2026');
  });
});

describe('shouldProvisionDemoTenants', () => {
  it('never provisions in a production-locked process', () => {
    const config = loadConfig(productionSource());
    expect(shouldProvisionDemoTenants(config)).toBe(false);
  });

  it('provisions in development sandbox', () => {
    expect(shouldProvisionDemoTenants(loadConfig({ NODE_ENV: 'development' }))).toBe(true);
  });

  it('provisions in test only when SEED_DEMO_TENANTS is true', () => {
    expect(shouldProvisionDemoTenants(loadConfig({ NODE_ENV: 'test' }))).toBe(false);
    expect(
      shouldProvisionDemoTenants(loadConfig({ NODE_ENV: 'test', SEED_DEMO_TENANTS: 'true' })),
    ).toBe(true);
  });
});

describe('disclaimers', () => {
  it('warns that sandbox pricing is not executable', () => {
    expect(disclaimerFor('sandbox')).toMatch(/not\s+\n?executable|not executable/);
    expect(disclaimerFor('sandbox')).toMatch(/synthetic reference data/);
  });

  it('states the non-custodial position in production too', () => {
    expect(disclaimerFor('production')).toMatch(/non-custodial/);
    expect(disclaimerFor('production')).toMatch(/does not\s+\n?execute|does not execute/);
  });
});
