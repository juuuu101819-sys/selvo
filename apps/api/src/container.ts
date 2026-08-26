import { createSandboxAdapters, type SandboxAdapterSet } from '@meridian/adapters';
import {
  ENGINE_VERSION,
  ProviderRegistry,
  RepositoryAuditLogger,
  RouteComparisonService,
  RouteCostEngine,
  parseScoringWeights,
  systemClock,
  uuidIdGenerator,
  type AuditLogger,
  type Clock,
  type Logger,
  type PersistenceDriver,
  type ProviderDescriptor,
  type RouteProvider,
} from '@meridian/core';
import { createPersistenceDriver } from '@meridian/persistence';
import { disclaimerFor, type AppConfig } from './config/env.js';

export interface AppContainer {
  readonly config: AppConfig;
  readonly clock: Clock;
  readonly persistence: PersistenceDriver;
  readonly registry: ProviderRegistry;
  readonly comparisons: RouteComparisonService;
  readonly auditLogger: AuditLogger;
  readonly disclaimer: string;
  readonly pricing: {
    readonly datasetVersion: string;
    readonly referenceRatesVersion: string;
    readonly referenceRatesAsOf: string;
    readonly dataDir: string;
  } | null;
  readonly providers: readonly ProviderDescriptor[];
  readonly engineVersion: string;
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
  });

  logger.info('Meridian container initialised', {
    mode: config.mode,
    engineVersion: ENGINE_VERSION,
    persistenceDriver: persistence.kind,
    providerCount: registry.all().length,
    pricingDataset: sandbox?.pricingVersion ?? null,
  });

  return {
    config,
    clock,
    persistence,
    registry,
    comparisons,
    auditLogger,
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
