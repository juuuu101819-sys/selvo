import { createFinancialCatalog, createSandboxAdapters, type SandboxAdapterSet } from '@meridian/adapters';
import {
  ENGINE_VERSION,
  FinancialProviderRegistry,
  MultiRailCostEngine,
  MultiRailRouter,
  ProviderRegistry,
  ROUTING_ENGINE_VERSION,
  RepositoryAuditLogger,
  RouteComparisonService,
  RouteCostEngine,
  defaultRoutingWeights,
  noPlatformPricingResolver,
  parseRoutingWeights,
  parseScoringWeights,
  systemClock,
  uuidIdGenerator,
  type AuditLogger,
  type Authenticator,
  type Clock,
  type Logger,
  type PersistenceDriver,
  type PlatformPricingResolver,
  type ProviderDescriptor,
  type RouteProvider,
} from '@meridian/core';
import { createPersistenceDriver } from '@meridian/persistence';
import { IdentityAuthenticator } from './auth/identity-authenticator.js';
import { disclaimerFor, type AppConfig } from './config/env.js';

export interface AppContainer {
  readonly config: AppConfig;
  readonly clock: Clock;
  readonly persistence: PersistenceDriver;
  readonly registry: ProviderRegistry;
  readonly financialProviders: FinancialProviderRegistry;
  readonly comparisons: RouteComparisonService;
  readonly routing: MultiRailRouter;
  readonly auditLogger: AuditLogger;
  readonly authenticator: Authenticator;
  readonly disclaimer: string;
  readonly pricing: {
    readonly datasetVersion: string;
    readonly referenceRatesVersion: string;
    readonly referenceRatesAsOf: string;
    readonly dataDir: string;
  } | null;
  readonly providers: readonly ProviderDescriptor[];
  readonly engineVersion: string;
  readonly routingEngineVersion: string;
  /** Where negotiated commercial terms come from, or `"none"` when none are configured. */
  readonly pricingResolverKind: string;
  close(): Promise<void>;
}

export interface ContainerOptions {
  readonly config: AppConfig;
  readonly logger: Logger;
  readonly clock?: Clock;
}

/**
 * Composition root.
 *
 * Every dependency is constructed here and injected downward, so nothing below this file reaches
 * for a global, a clock or an environment variable. That is what lets the domain be tested without
 * a server and the API be tested without a database.
 */
export function createContainer(options: ContainerOptions): AppContainer {
  const { config, logger } = options;
  const clock = options.clock ?? systemClock;

  const persistence = createPersistenceDriver({
    driver: config.database.driver,
    connectionString: config.database.url,
    maxConnections: config.database.maxConnections,
    ssl: config.database.ssl,
  });

  const { providers, sandbox } = buildProviders(config, logger);
  const registry = ProviderRegistry.create(config.mode, providers);
  const financialProviders = FinancialProviderRegistry.create(
    config.mode,
    createFinancialCatalog(providers),
  );

  if (registry.exclusions.length > 0) {
    logger.warn('Some provider adapters were excluded from the registry', {
      mode: config.mode,
      exclusions: registry.exclusions.map((exclusion) => exclusion.providerId),
    });
  }

  const auditLogger = new RepositoryAuditLogger({
    repository: persistence.auditLog,
    clock,
    ids: uuidIdGenerator,
    logger,
  });

  // Negotiated terms come from the store when one can supply them. With the in-memory driver there
  // are no customers and therefore no terms, so the platform charges nothing rather than inventing a
  // default fee — quoting a markup nobody agreed to would be worse than quoting none.
  const pricingResolver: PlatformPricingResolver =
    'pricing' in persistence && persistence.pricing !== undefined
      ? (persistence.pricing as PlatformPricingResolver)
      : noPlatformPricingResolver;

  const comparisons = new RouteComparisonService({
    mode: config.mode,
    registry,
    costEngine: new RouteCostEngine(),
    defaultWeights: parseScoringWeights(config.weights),
    clock,
    ids: uuidIdGenerator,
    auditLogger,
    comparisons: persistence.comparisons,
    logger,
    providerTimeoutMs: config.providerTimeoutMs,
    pricingResolver,
  });

  const routing = new MultiRailRouter({
    mode: config.mode,
    registry: financialProviders,
    costEngine: new MultiRailCostEngine(),
    defaultWeights:
      config.routingWeights === undefined
        ? defaultRoutingWeights()
        : parseRoutingWeights(config.routingWeights),
    clock,
    ids: uuidIdGenerator,
    auditLogger,
    logger,
    providerTimeoutMs: config.providerTimeoutMs,
    pricingResolver,
  });

  const authenticator: Authenticator = new IdentityAuthenticator(persistence.identity, clock);

  logger.info('Meridian container initialised', {
    mode: config.mode,
    engineVersion: ENGINE_VERSION,
    routingEngineVersion: ROUTING_ENGINE_VERSION,
    persistenceDriver: persistence.kind,
    providerCount: registry.all().length,
    financialProviderCount: financialProviders.all().length,
    pricingDataset: sandbox?.pricingVersion ?? null,
    authenticationScheme: authenticator.scheme,
  });

  return {
    config,
    clock,
    persistence,
    registry,
    financialProviders,
    comparisons,
    routing,
    auditLogger,
    authenticator,
    disclaimer: disclaimerFor(config.mode),
    pricing:
      sandbox === null
        ? null
        : {
            datasetVersion: sandbox.pricingVersion,
            referenceRatesVersion: sandbox.rates.version,
            referenceRatesAsOf: sandbox.rates.asOf,
            dataDir: sandbox.dataDir,
          },
    providers: registry.descriptors(),
    engineVersion: ENGINE_VERSION,
    routingEngineVersion: ROUTING_ENGINE_VERSION,
    pricingResolverKind: pricingResolver === noPlatformPricingResolver ? 'none' : persistence.kind,
    close: () => persistence.close(),
  };
}

/**
 * Selects the adapters for the running mode.
 *
 * Sandbox rails are loaded from the pricing dataset. Production mode has no adapters in Phase 1,
 * so `ProviderRegistry.create` refuses to start — a loud failure is the correct outcome, because
 * the alternative is a production deployment quietly serving synthetic prices.
 */
function buildProviders(
  config: AppConfig,
  logger: Logger,
): { providers: readonly RouteProvider[]; sandbox: SandboxAdapterSet | null } {
  if (config.mode !== 'sandbox') {
    // Phase 3 registers licensed partner adapters here, resolving credentials through the
    // SecretResolver rather than reading the environment directly.
    logger.warn('Production mode requested with no licensed partner adapters configured', {
      mode: config.mode,
    });
    return { providers: [], sandbox: null };
  }

  const sandbox = createSandboxAdapters(
    config.pricingDataDir === undefined ? {} : { dataDir: config.pricingDataDir },
  );
  logger.info('Loaded sandbox pricing dataset', {
    datasetVersion: sandbox.pricingVersion,
    referenceRatesVersion: sandbox.referenceRatesVersion,
    dataDir: sandbox.dataDir,
    providerCount: sandbox.providers.length,
  });
  return { providers: sandbox.providers, sandbox };
}
