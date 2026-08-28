import type {
  PlatformMode,
  ProviderDescriptor,
  ProviderId,
  QuoteRequest,
} from '../domain/index.js';
import { ConfigurationError } from '../errors/index.js';
import type { RouteProvider } from '../ports/index.js';

export interface RegistryExclusion {
  readonly providerId: ProviderId;
  readonly reason: string;
}

export interface ProviderRegistryOptions {
  /**
   * When true, an empty admitted set is allowed. Production uses this only when financial routing
   * has been explicitly declared unavailable (`PRODUCTION_ROUTING_AVAILABLE=false`).
   *
   * Default false preserves the historical fail-closed boot: production still requires at least
   * one `licensed_partner` adapter before routing may be offered.
   */
  readonly allowEmpty?: boolean;
}

/**
 * The set of liquidity sources available in the running platform mode.
 *
 * The registry is the compliance choke point: a sandbox adapter cannot reach a production caller
 * because it is filtered out here, before the engine ever sees it. Claiming production routing
 * with no licensed provider is a startup failure rather than an empty result at request time.
 */
export class ProviderRegistry {
  private readonly byId: ReadonlyMap<ProviderId, RouteProvider>;
  readonly mode: PlatformMode;
  readonly exclusions: readonly RegistryExclusion[];

  private constructor(
    mode: PlatformMode,
    providers: readonly RouteProvider[],
    exclusions: readonly RegistryExclusion[],
  ) {
    this.mode = mode;
    this.exclusions = exclusions;
    this.byId = new Map(providers.map((provider) => [provider.descriptor.id, provider]));
  }

  static create(
    mode: PlatformMode,
    providers: readonly RouteProvider[],
    options: ProviderRegistryOptions = {},
  ): ProviderRegistry {
    const seen = new Set<ProviderId>();
    const admitted: RouteProvider[] = [];
    const exclusions: RegistryExclusion[] = [];

    for (const provider of providers) {
      const { id, modes, licensing } = provider.descriptor;

      if (seen.has(id)) {
        throw new ConfigurationError(`Duplicate provider id "${id}" in the registry.`, {
          providerId: id,
        });
      }
      seen.add(id);

      if (!modes.includes(mode)) {
        exclusions.push({
          providerId: id,
          reason: `not enabled for ${mode} mode`,
        });
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

    const allowEmpty = options.allowEmpty === true;

    if (admitted.length === 0) {
      if (!allowEmpty) {
        throw new ConfigurationError(
          `No provider adapters are available in ${mode} mode. ` +
            (mode === 'production'
              ? 'Production mode requires at least one licensed partner adapter to be configured.'
              : 'Check the sandbox adapter registration.'),
          { mode, exclusions },
        );
      }
    } else if (
      mode === 'production' &&
      !admitted.some((p) => p.descriptor.licensing === 'licensed_partner')
    ) {
      throw new ConfigurationError(
        'Production mode requires at least one licensed partner adapter. Refusing to start with ' +
          'modelled pricing only.',
        { mode, registered: admitted.map((p) => p.descriptor.id) },
      );
    }

    return new ProviderRegistry(mode, admitted, exclusions);
  }

  all(): readonly RouteProvider[] {
    return [...this.byId.values()].sort((left, right) =>
      left.descriptor.id.localeCompare(right.descriptor.id, 'en'),
    );
  }

  descriptors(): readonly ProviderDescriptor[] {
    return this.all().map((provider) => provider.descriptor);
  }

  get(providerId: ProviderId): RouteProvider | null {
    return this.byId.get(providerId) ?? null;
  }

  /** Providers that can price this specific request, honouring any rail filter. */
  eligible(request: QuoteRequest): readonly RouteProvider[] {
    return this.all().filter((provider) => {
      if (request.rails !== null && !request.rails.includes(provider.descriptor.rail)) {
        return false;
      }
      return provider.supports(request);
    });
  }
}
