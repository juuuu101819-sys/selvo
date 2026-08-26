import { ConfigurationError } from '@meridian/core';
import { describe, expect, it } from 'vitest';
import { EnvSecretResolver } from './env-secret-resolver.js';

describe('EnvSecretResolver', () => {
  it('resolves a configured secret', () => {
    const resolver = new EnvSecretResolver({ PROVIDER_ACME_FX_API_KEY: 'abc123' });
    expect(resolver.get('PROVIDER_ACME_FX_API_KEY')).toBe('abc123');
  });

  it('treats a blank value as absent', () => {
    const resolver = new EnvSecretResolver({ PROVIDER_ACME_FX_API_KEY: '   ' });
    expect(resolver.get('PROVIDER_ACME_FX_API_KEY')).toBeNull();
  });

  it('returns null for an unset secret rather than throwing', () => {
    expect(new EnvSecretResolver({}).get('MISSING')).toBeNull();
  });

  it('names the missing variable without ever revealing a value', () => {
    const resolver = new EnvSecretResolver({});
    try {
      resolver.require('PROVIDER_ACME_FX_API_KEY');
      expect.unreachable('expected a configuration error');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError);
      expect((error as ConfigurationError).message).toContain('PROVIDER_ACME_FX_API_KEY');
    }
  });

  it('namespaces credentials per provider', () => {
    expect(EnvSecretResolver.variableNameFor('sandbox-northgate-bank', 'api_key')).toBe(
      'PROVIDER_SANDBOX_NORTHGATE_BANK_API_KEY',
    );
    expect(EnvSecretResolver.variableNameFor('acme.fx', 'base_url')).toBe(
      'PROVIDER_ACME_FX_BASE_URL',
    );
  });
});
