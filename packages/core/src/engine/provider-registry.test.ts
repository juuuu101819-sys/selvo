import { describe, expect, it } from 'vitest';
import { ConfigurationError } from '../errors/index.js';
import { StubRouteProvider, buildProviderQuote, buildQuoteRequest } from '../testing/index.js';
import { ProviderRegistry } from './provider-registry.js';

function stub(
  id: string,
  overrides: Partial<Parameters<typeof StubRouteProvider>[0]> = {},
  eligible = true,
): StubRouteProvider {
  return new StubRouteProvider(
    { id, ...overrides },
    { kind: 'quote', quote: buildProviderQuote({ providerId: id }) },
    eligible,
  );
}

describe('ProviderRegistry', () => {
  it('registers sandbox providers in sandbox mode', () => {
    const registry = ProviderRegistry.create('sandbox', [stub('a'), stub('b')]);
    expect(registry.descriptors().map((descriptor) => descriptor.id)).toEqual(['a', 'b']);
    expect(registry.exclusions).toEqual([]);
  });

  it('keeps providers in a stable id order regardless of registration order', () => {
    const registry = ProviderRegistry.create('sandbox', [stub('z'), stub('a'), stub('m')]);
    expect(registry.all().map((provider) => provider.descriptor.id)).toEqual(['a', 'm', 'z']);
  });

  it('rejects a duplicate provider id', () => {
    expect(() => ProviderRegistry.create('sandbox', [stub('a'), stub('a')])).toThrow(
      ConfigurationError,
    );
  });

  it('excludes a provider that is not enabled for the running mode', () => {
    const registry = ProviderRegistry.create('sandbox', [
      stub('sandbox-only'),
      stub('production-only', { modes: ['production'] }),
    ]);

    expect(registry.descriptors().map((descriptor) => descriptor.id)).toEqual(['sandbox-only']);
    expect(registry.exclusions).toEqual([
      { providerId: 'production-only', reason: 'not enabled for sandbox mode' },
    ]);
  });

  it('never serves sandbox pricing in production mode', () => {
    const registry = ProviderRegistry.create('production', [
      stub('licensed', { modes: ['sandbox', 'production'], licensing: 'licensed_partner' }),
      stub('sandbox', { modes: ['sandbox', 'production'], licensing: 'unlicensed_sandbox' }),
    ]);

    expect(registry.descriptors().map((descriptor) => descriptor.id)).toEqual(['licensed']);
    expect(registry.exclusions[0]?.reason).toContain('never served in production');
  });

  it('refuses to start production mode without a licensed partner', () => {
    expect(() =>
      ProviderRegistry.create('production', [
        stub('model', { modes: ['production'], licensing: 'internal_model' }),
      ]),
    ).toThrow(ConfigurationError);
  });

  it('refuses to start with no usable providers at all', () => {
    expect(() =>
      ProviderRegistry.create('production', [stub('sandbox-only', { modes: ['sandbox'] })]),
    ).toThrow(ConfigurationError);
  });

  it('allows an empty production registry only when allowEmpty is set', () => {
    const registry = ProviderRegistry.create('production', [], { allowEmpty: true });
    expect(registry.all()).toEqual([]);
    expect(registry.descriptors()).toEqual([]);
  });

  it('still refuses modelled-only production adapters even when allowEmpty is set', () => {
    expect(() =>
      ProviderRegistry.create(
        'production',
        [stub('model', { modes: ['production'], licensing: 'internal_model' })],
        { allowEmpty: true },
      ),
    ).toThrow(ConfigurationError);
  });

  describe('eligibility', () => {
    const request = buildQuoteRequest();

    it('excludes a provider that does not support the corridor', () => {
      const registry = ProviderRegistry.create('sandbox', [
        stub('covers'),
        stub('declines', {}, false),
      ]);
      expect(registry.eligible(request).map((provider) => provider.descriptor.id)).toEqual([
        'covers',
      ]);
    });

    it('honours a rail filter', () => {
      const registry = ProviderRegistry.create('sandbox', [
        stub('bank', { rail: 'bank_fx' }),
        stub('coin', { rail: 'stablecoin_settlement' }),
      ]);
      const filtered = registry.eligible(buildQuoteRequest({ rails: ['stablecoin_settlement'] }));
      expect(filtered.map((provider) => provider.descriptor.id)).toEqual(['coin']);
    });

    it('returns every provider when no rail filter is given', () => {
      const registry = ProviderRegistry.create('sandbox', [
        stub('bank', { rail: 'bank_fx' }),
        stub('coin', { rail: 'stablecoin_settlement' }),
      ]);
      expect(registry.eligible(request)).toHaveLength(2);
    });
  });

  it('looks a provider up by id', () => {
    const registry = ProviderRegistry.create('sandbox', [stub('a')]);
    expect(registry.get('a')?.descriptor.id).toBe('a');
    expect(registry.get('missing')).toBeNull();
  });
});
