import {
  createFinancialCatalog,
  createSandboxAdapters,
  createSandboxExecutionPartners,
  CircuitBreakerRegistry,
  ManualOverrideRegistry,
  QuoteCache,
  wrapFinancialProvidersWithQuoteResilience,
  type SandboxAdapterSet,
} from '@meridian/adapters';
import {
  AgentPaymentService,
  MandateService,
  ConfigurationError,
  ComparisonRoutingService,
  DEFI_ROUTING_ENGINE_VERSION,
  DefiRouter,
  ENGINE_VERSION,
  ExecutionPartnerRegistry,
  ExecutionOrchestrationService,
  ExecutionReceiptService,
  ReconciliationEngine,
  FinancialProviderRegistry,
  GRAPH_ENGINE_VERSION,
  MemoryRailHealthMonitor,
  MultiRailCostEngine,
  MultiRailRouter,
  NlRoutingService,
  PartnerInstructionService,
  ProviderRegistry,
  ROUTING_ENGINE_VERSION,
  RepositoryAuditLogger,
  RouteGraphService,
  RoutingEvaluationService,
  STABLECOIN_ROUTING_ENGINE_VERSION,
  StablecoinRouter,
  buildFinancialRouteGraph,
  defaultRoutingWeights,
  noPlatformPricingResolver,
  parseRoutingWeights,
  systemClock,
  uuidIdGenerator,
  ProviderCredentialVault,
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
import { FakeOidcClient, FetchOidcClient, type OidcClient } from './auth/oidc-client.js';
import { disclaimerFor, type AppConfig } from './config/env.js';

export interface AppContainer {
  readonly config: AppConfig;
  readonly clock: Clock;
  readonly persistence: PersistenceDriver;
  readonly registry: ProviderRegistry;
  readonly financialProviders: FinancialProviderRegistry;
  readonly comparisons: ComparisonRoutingService;
  readonly routingEvaluations: RoutingEvaluationService;
  readonly routing: MultiRailRouter;
  readonly railHealth: MemoryRailHealthMonitor;
  readonly stablecoinRouting: StablecoinRouter;
  readonly defiRouting: DefiRouter;
  readonly routeGraph: RouteGraphService;
  readonly auditLogger: AuditLogger;
  readonly authenticator: Authenticator;
  readonly oidcClient: OidcClient;
  readonly agentPayments: AgentPaymentService;
  readonly mandates: MandateService;
  readonly partnerInstructions: PartnerInstructionService;
  readonly executionPartners: ExecutionPartnerRegistry;
  readonly executions: ExecutionOrchestrationService;
  readonly receipts: ExecutionReceiptService;
  readonly reconciliation: ReconciliationEngine;
  readonly nlRouting: NlRoutingService;
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
  readonly graphEngineVersion: string;
  readonly stablecoinRoutingEngineVersion: string;
  readonly defiRoutingEngineVersion: string;
  /** Where negotiated commercial terms come from, or `"none"` when none are configured. */
  readonly pricingResolverKind: string;
  readonly circuitBreakers: CircuitBreakerRegistry;
  readonly manualOverrides: ManualOverrideRegistry;
  readonly providerCredentialVault: ProviderCredentialVault;
  close(): Promise<void>;
}

export interface ContainerOptions {
  readonly config: AppConfig;
  readonly logger: Logger;
  readonly clock?: Clock;
  readonly oidcClient?: OidcClient;
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

  if (config.productionLocked && config.database.driver === 'memory') {
    throw new ConfigurationError(
      'DATABASE_DRIVER=memory is forbidden when NODE_ENV=production or PLATFORM_MODE=production.',
      { driver: config.database.driver, mode: config.mode, nodeEnv: config.nodeEnv },
    );
  }

  const persistence = createPersistenceDriver({
    driver: config.database.driver,
    connectionString: config.database.url,
    maxConnections: config.database.maxConnections,
    ssl: config.database.ssl,
  });

  const { providers, sandbox } = buildProviders(config, logger);
  const registry = ProviderRegistry.create(
    config.mode,
    providers,
    config.mode === 'production' && !config.productionGates.routingAvailable
      ? { allowEmpty: true }
      : {},
  );
  const catalog = createFinancialCatalog(providers, {
    includeDemoAdapters: config.mode === 'sandbox',
  });
  const circuitBreakers = new CircuitBreakerRegistry({ clock, logger });
  const quoteCache = new QuoteCache({ clock });
  const manualOverrides = new ManualOverrideRegistry();
  const providerCredentialVault = new ProviderCredentialVault(
    persistence.providerCredentials,
    config.dataEncryptionKey,
  );
  const financialProviders = FinancialProviderRegistry.create(
    config.mode,
    wrapFinancialProvidersWithQuoteResilience(catalog, {
      cache: quoteCache,
      breakers: circuitBreakers,
      manualOverrides,
    }),
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

  const costEngine = new MultiRailCostEngine();

  const executionPartners = ExecutionPartnerRegistry.create(
    config.mode === 'sandbox' ? createSandboxExecutionPartners() : [],
    { liveEnabled: config.partnerLiveEnabled },
  );

  const railHealth = new MemoryRailHealthMonitor();

  const routing = new MultiRailRouter({
    mode: config.mode,
    registry: financialProviders,
    costEngine,
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
    executionPartners,
    railHealth,
  });

  const comparisons = new ComparisonRoutingService({
    routing,
    registry: financialProviders,
    clock,
    ids: uuidIdGenerator,
    auditLogger,
    comparisons: persistence.comparisons,
    logger,
  });

  const routingEvaluations = new RoutingEvaluationService({
    routing,
    registry: financialProviders,
    evaluations: persistence.routingEvaluations,
    auditLogger,
    clock,
  });

  const stablecoinRouting = new StablecoinRouter({
    mode: config.mode,
    registry: financialProviders,
    costEngine,
    clock,
    ids: uuidIdGenerator,
    auditLogger,
    logger,
    providerTimeoutMs: config.providerTimeoutMs,
  });

  const defiRouting = new DefiRouter({
    mode: config.mode,
    registry: financialProviders,
    costEngine,
    clock,
    ids: uuidIdGenerator,
    auditLogger,
    logger,
    providerTimeoutMs: config.providerTimeoutMs,
  });

  const routeGraph = new RouteGraphService({
    mode: config.mode,
    graph: buildFinancialRouteGraph({
      includeDemoAdapters: config.mode === 'sandbox',
      licensedVenueMetadata: [],
    }),
    clock,
    ids: uuidIdGenerator,
    auditLogger,
    logger,
  });

  const authenticator: Authenticator = new IdentityAuthenticator(
    persistence.identity,
    clock,
    persistence.agentPayments,
    {
      rejectDemoSecrets: config.productionLocked,
      sessionTokenPepper: config.sessionTokenPepper,
    },
  );

  const oidcClient =
    options.oidcClient ??
    (config.nodeEnv === 'test' ? new FakeOidcClient() : new FetchOidcClient());

  const agentPayments = new AgentPaymentService({
    agentPayments: persistence.agentPayments,
    routing,
    clock,
    ids: uuidIdGenerator,
    auditLogger,
    mandates: persistence.mandates,
    mandatesEnabled: config.mandateIngestionEnabled,
  });

  const mandates = new MandateService({
    store: persistence.mandates,
    clock,
    ids: uuidIdGenerator,
    auditLogger,
    enabled: config.mandateIngestionEnabled,
  });

  const partnerInstructions = new PartnerInstructionService({
    registry: executionPartners,
    store: persistence.partnerInstructions,
    clock,
    ids: uuidIdGenerator,
    auditLogger,
    logger,
    liveEnabled: config.partnerLiveEnabled,
    sandboxMode: config.mode === 'sandbox',
  });

  const receipts = new ExecutionReceiptService({
    enabled: config.executionEnabled,
    sandboxMode: config.mode === 'sandbox',
    store: persistence.executionReceipts,
    vault: providerCredentialVault,
    clock,
    ids: uuidIdGenerator,
    auditLogger,
  });

  const reconciliation = new ReconciliationEngine({
    enabled: config.executionEnabled,
    sandboxMode: config.mode === 'sandbox',
    executions: persistence.orchestratedExecutions,
    partners: persistence.partnerInstructions,
    dashboard: persistence.dashboard,
    auditLogger,
  });

  const executions = new ExecutionOrchestrationService({
    enabled: config.executionEnabled,
    sandboxMode: config.mode === 'sandbox',
    store: persistence.orchestratedExecutions,
    mandates: persistence.mandates,
    evaluations: persistence.routingEvaluations,
    routing,
    partners: executionPartners,
    partnerInstructions,
    partnerInstructionStore: persistence.partnerInstructions,
    receipts,
    agentPayments: persistence.agentPayments,
    vault: providerCredentialVault,
    dashboard: persistence.dashboard,
    clock,
    ids: uuidIdGenerator,
    auditLogger,
    logger,
  });

  const nlRouting = new NlRoutingService({
    agentPayments,
    agentPaymentStore: persistence.agentPayments,
    executionIntents: persistence.executionIntents,
    clock,
    ids: uuidIdGenerator,
    auditLogger,
  });

  logger.info('Meridian container initialised', {
    mode: config.mode,
    productionLocked: config.productionLocked,
    routingAvailable: config.productionGates.routingAvailable,
    executionAvailable: config.productionGates.executionAvailable,
    authSecretConfigured: config.authSecretConfigured,
    engineVersion: ENGINE_VERSION,
    routingEngineVersion: ROUTING_ENGINE_VERSION,
    graphEngineVersion: GRAPH_ENGINE_VERSION,
    stablecoinRoutingEngineVersion: STABLECOIN_ROUTING_ENGINE_VERSION,
    defiRoutingEngineVersion: DEFI_ROUTING_ENGINE_VERSION,
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
    routingEvaluations,
    routing,
    railHealth,
    stablecoinRouting,
    defiRouting,
    routeGraph,
    auditLogger,
    authenticator,
    oidcClient,
    agentPayments,
    mandates,
    partnerInstructions,
    executionPartners,
    executions,
    receipts,
    reconciliation,
    nlRouting,
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
    graphEngineVersion: GRAPH_ENGINE_VERSION,
    stablecoinRoutingEngineVersion: STABLECOIN_ROUTING_ENGINE_VERSION,
    defiRoutingEngineVersion: DEFI_ROUTING_ENGINE_VERSION,
    pricingResolverKind: pricingResolver === noPlatformPricingResolver ? 'none' : persistence.kind,
    circuitBreakers,
    manualOverrides,
    providerCredentialVault,
    close: () => persistence.close(),
  };
}

/**
 * Selects the adapters for the running mode.
 *
 * Sandbox rails are loaded from the pricing dataset. Production never loads demo adapters.
 * Production financial routing is enabled only when PRODUCTION_ROUTING_AVAILABLE=true and at least
 * one licensed partner adapter is configured. No licensed adapters exist in this tree, so claiming
 * routing availability is a startup failure. With the flag false, the process may start read-only
 * with an empty registry. Execution is independently unavailable.
 */
function buildProviders(
  config: AppConfig,
  logger: Logger,
): { providers: readonly RouteProvider[]; sandbox: SandboxAdapterSet | null } {
  if (config.mode !== 'sandbox') {
    if (config.productionGates.routingAvailable) {
      throw new ConfigurationError(
        'PRODUCTION_ROUTING_AVAILABLE is true but no licensed partner adapters are configured. ' +
          'Do not enable production financial routing without a licensed adapter. ' +
          'Set PRODUCTION_ROUTING_AVAILABLE=false to start in a read-only production state.',
        { mode: config.mode, routingAvailable: true, executionAvailable: false },
      );
    }
    logger.warn('Production mode starting without licensed partner adapters; financial routing is unavailable', {
      mode: config.mode,
      routingAvailable: false,
      executionAvailable: false,
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
