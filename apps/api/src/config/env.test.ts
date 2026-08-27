import { ConfigurationError, DEFAULT_SCORING_WEIGHTS } from '@meridian/core';
import { describe, expect, it } from 'vitest';
import { disclaimerFor, loadConfig } from './env.js';

describe('loadConfig', () => {
  it('defaults to sandbox mode with the in-memory store', () => {
    const config = loadConfig({});

    expect(config.mode).toBe('sandbox');
    expect(config.database.driver).toBe('memory');
    expect(config.port).toBe(47_311);
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
