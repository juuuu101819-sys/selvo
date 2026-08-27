import { ConfigurationError } from '../errors/index.js';
import type { PlatformMode, ProviderId } from '../domain/provider.js';
import type { ProviderCategory } from '../domain/provider-catalog.js';
import type { FinancialProvider, NormalizedQuoteRequest } from '../ports/financial-provider.js';

export interface FinancialRegistryExclusion {
  readonly providerId: ProviderId;
  readonly reason: string;
}

/**
 * Catalog of multi-rail {@link FinancialProvider}s for the running mode.
 *
 * Separate from {@link ProviderRegistry}: that one feeds the comparison engine and must not be
 * empty in production. This one can be. A DEX in this catalog is not a `RouteProvider` and does
 * not appear in `POST /comparisons`.
 */
export class FinancialProviderRegistry {
  private readonly byId: ReadonlyMap<ProviderId, FinancialProvider>;
  readonly mode: PlatformMode;
  readonly exclusions: readonly FinancialRegistryExclusion[];

  private constructor(
    mode: PlatformMode,
    providers: readonly FinancialProvider[],
    exclusions: readonly FinancialRegistryExclusion[],
  ) {
    this.mode = mode;
    this.exclusions = exclusions;
    this.byId = new Map(providers.map((provider) => [provider.descriptor.id, provider]));
  }

  static create(
    mode: PlatformMode,
    providers: readonly FinancialProvider[],
  ): FinancialProviderRegistry {
    const seen = new Set<ProviderId>();
    const admitted: FinancialProvider[] = [];
    const exclusions: FinancialRegistryExclusion[] = [];

    for (const provider of providers) {
      const { id, modes, licensing } = provider.descriptor;
      if (seen.has(id)) {
        throw new ConfigurationError(`Duplicate financial provider id "${id}".`, {
          providerId: id,
        });
      }
      seen.add(id);

      if (!modes.includes(mode)) {
        exclusions.push({ providerId: id, reason: `not enabled for ${mode} mode` });
        continue;
      }
      if (mode === 'production' && licensing === 'unlicensed_sandbox') {
        exclusions.push({
          providerId: id,
          reason: 'sandbox pricing is never served in production mode',
        });
        continue;
      }
      admitted.push(provider);
    }

    return new FinancialProviderRegistry(mode, admitted, exclusions);
  }

  all(): readonly FinancialProvider[] {
    return [...this.byId.values()].sort((left, right) =>
      left.descriptor.id.localeCompare(right.descriptor.id, 'en'),
    );
  }

  get(providerId: ProviderId): FinancialProvider | null {
    return this.byId.get(providerId) ?? null;
  }

  byCategory(category: ProviderCategory): readonly FinancialProvider[] {
    return this.all().filter((provider) => provider.getCapabilities().category === category);
  }

  eligible(request: NormalizedQuoteRequest): readonly FinancialProvider[] {
    return this.all().filter((provider) => provider.supportsNormalized(request));
  }
}
