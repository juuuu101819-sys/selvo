/**
 * Demo-mode seed data.
 *
 * Two rules shape this file.
 *
 * First, **no live secrets**. The demo user password is a documented sandbox credential, stored
 * only as a scrypt hash. Provider credentials are never seeded, committed or stored.
 *
 * Second, **no hardcoded prices**. The demo quotes are not invented figures typed into a fixture:
 * the seed runs the real routing engine over the real sandbox adapters and persists what comes back.
 * That keeps the seed honest as pricing evolves, and proves the schema can actually hold engine
 * output — which is the part of a data model that fixtures usually fail to test.
 *
 * The domain-to-row shaping lives here rather than in packages/persistence because Phase 3 owns the
 * production write path, and guessing at it now would be speculative.
 */
// The imports below resolve to the workspace packages' compiled output, so the seed needs
// `npm run build` to have run. `npm run db:seed` and `npm run db:reset` do that first; calling
// `prisma db seed` directly on an unbuilt clone will fail to resolve @meridian/* and the fix is to
// build.
import { randomUUID } from 'node:crypto';
import { createSandboxAdapters } from '@meridian/adapters';
import {
  CURRENCY_REGISTRY,
  DEFAULT_AGENT_SCOPES,
  DEMO_AGENT_CREDENTIAL_ID,
  DEMO_AGENT_ID,
  DEMO_AGENT_NAME,
  DEMO_AGENT_POLICY,
  DEMO_AGENT_SECRET,
  DEMO_MERCHANT_CODE,
  DEMO_MERCHANT_ID,
  DEMO_MERCHANT_NAME,
  DEMO_PAYMENT_POLICY_ID,
  DEMO_USER_PASSWORD,
  DEMO_WALLET_REFERENCE_ID,
  ProviderRegistry,
  RepositoryAuditLogger,
  RouteComparisonService,
  RouteCostEngine,
  defaultScoringWeights,
  demoAgentPaymentIntents,
  demoAgentPolicyViolations,
  demoMonetizationEvents,
  hashPassword,
  isCurrencyCode,
  noopLogger,
  serializeComparison,
  systemClock,
  uuidIdGenerator,
  type RouteDto,
} from '@meridian/core';
import { InMemoryPersistenceDriver, PrismaPlatformPricingResolver } from '@meridian/persistence';
import { Prisma, PrismaClient, type $Enums } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const DATABASE_URL = process.env['DATABASE_URL'];
if (DATABASE_URL === undefined || DATABASE_URL.trim() === '') {
  throw new Error('DATABASE_URL must be set to seed the database.');
}

if (process.env['NODE_ENV'] === 'production' || process.env['PLATFORM_MODE'] === 'production') {
  throw new Error(
    'Refusing to seed demo credentials when NODE_ENV=production or PLATFORM_MODE=production.',
  );
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL }) });

/** The currencies demo mode offers. Exponents are asserted against the code registry below. */
const FIAT_CURRENCIES = [
  { code: 'USD', numericCode: '840', name: 'US Dollar', symbol: '$' },
  { code: 'KRW', numericCode: '410', name: 'South Korean Won', symbol: '₩' },
  { code: 'EUR', numericCode: '978', name: 'Euro', symbol: '€' },
  { code: 'JPY', numericCode: '392', name: 'Japanese Yen', symbol: '¥' },
  { code: 'SGD', numericCode: '702', name: 'Singapore Dollar', symbol: 'S$' },
  { code: 'HKD', numericCode: '344', name: 'Hong Kong Dollar', symbol: 'HK$' },
  { code: 'GBP', numericCode: '826', name: 'Pound Sterling', symbol: '£' },
] as const;

/**
 * The intermediary asset a stablecoin route settles its middle leg in.
 *
 * Present so a quote's legs can name what the money passes through. Meridian never holds it, and it
 * is not offered as a corridor currency — `CURRENCY_REGISTRY` in packages/core, which governs what
 * the API will price, contains fiat only.
 */
const STABLECOIN_CURRENCIES = [
  { code: 'USC', name: 'Demo Stablecoin (USD-referenced)', exponent: 6, symbol: null },
] as const;

interface ProviderSeed {
  readonly slug: string;
  readonly name: string;
  readonly rail: $Enums.ProviderRail;
  readonly description: string;
  /** The sandbox adapter that prices this provider, linking the registry to the integration. */
  readonly adapterId: string;
  readonly reliabilityScore: string;
  readonly quoteTtlSeconds: number;
  readonly intermediaryAsset: string | null;
  readonly sourceCurrencies: readonly string[];
  readonly targetCurrencies: readonly string[];
  readonly minAmountUsd: string;
  readonly maxAmountUsd: string;
  /** Indicative spread in basis points, by target-currency group. */
  readonly spreadBps: { readonly major: string; readonly nearMajor: string };
  readonly slippageBps: string;
  readonly settlement: {
    readonly p50Seconds: number;
    readonly p95Seconds: number;
    readonly businessDaysOnly: boolean;
    readonly cutoffUtc: string | null;
  };
  readonly legTemplate: readonly $Enums.QuoteLegKind[];
  readonly metadata: Prisma.InputJsonValue;
}

const ALL = ['USD', 'KRW', 'EUR', 'JPY', 'SGD', 'HKD', 'GBP'] as const;
/** KRW is the near-major in this demo set; the rest price as majors. */
const NEAR_MAJORS = new Set(['KRW']);

const PROVIDERS: readonly ProviderSeed[] = [
  {
    slug: 'demo-bank-fx',
    name: 'Demo Bank FX',
    rail: 'bank_fx',
    description:
      'Correspondent bank acting as FX principal and settling over SWIFT. Demo data only.',
    adapterId: 'sandbox-northgate-bank',
    reliabilityScore: '0.9950',
    quoteTtlSeconds: 900,
    intermediaryAsset: null,
    sourceCurrencies: ALL,
    targetCurrencies: ALL,
    minAmountUsd: '1000.00',
    maxAmountUsd: '50000000.00',
    spreadBps: { major: '52', nearMajor: '69' },
    slippageBps: '0',
    settlement: {
      p50Seconds: 86_400,
      p95Seconds: 259_200,
      businessDaysOnly: true,
      cutoffUtc: '16:00',
    },
    legTemplate: ['correspondent_transfer', 'fx_conversion'],
    metadata: {
      docsUrl: 'https://example.invalid/demo-bank-fx/docs',
      supportContact: 'demo-support@example.invalid',
      settlementNetwork: 'SWIFT',
      demoOnly: true,
    },
  },
  {
    slug: 'demo-fx-provider',
    name: 'Demo FX Provider',
    rail: 'payment_institution',
    description:
      'Licensed payment institution settling over local rails with an in-house FX desk. Demo data only.',
    adapterId: 'sandbox-veridian-payments',
    reliabilityScore: '0.9910',
    quoteTtlSeconds: 600,
    intermediaryAsset: null,
    sourceCurrencies: ALL,
    targetCurrencies: ALL,
    minAmountUsd: '100.00',
    maxAmountUsd: '5000000.00',
    spreadBps: { major: '22', nearMajor: '35' },
    slippageBps: '0',
    settlement: {
      p50Seconds: 7_200,
      p95Seconds: 28_800,
      businessDaysOnly: false,
      cutoffUtc: '21:00',
    },
    legTemplate: ['fx_conversion', 'local_payout'],
    metadata: {
      docsUrl: 'https://example.invalid/demo-fx-provider/docs',
      supportContact: 'demo-support@example.invalid',
      settlementNetwork: 'local-rails',
      demoOnly: true,
    },
  },
  {
    slug: 'demo-stablecoin-provider',
    name: 'Demo Stablecoin Provider',
    rail: 'stablecoin_settlement',
    description:
      'Licensed on-ramp and off-ramp partners settling the middle leg in a regulated stablecoin. ' +
      'Meridian never holds the asset. Demo data only.',
    adapterId: 'sandbox-solstice-settlement',
    reliabilityScore: '0.9850',
    quoteTtlSeconds: 60,
    intermediaryAsset: 'USC',
    sourceCurrencies: ['USD', 'EUR', 'GBP', 'SGD', 'HKD', 'JPY'],
    targetCurrencies: ALL,
    minAmountUsd: '1000.00',
    maxAmountUsd: '10000000.00',
    spreadBps: { major: '6', nearMajor: '10' },
    slippageBps: '4',
    settlement: { p50Seconds: 300, p95Seconds: 1_800, businessDaysOnly: false, cutoffUtc: null },
    legTemplate: ['fiat_onramp', 'stablecoin_transfer', 'fiat_offramp'],
    metadata: {
      docsUrl: 'https://example.invalid/demo-stablecoin-provider/docs',
      supportContact: 'demo-support@example.invalid',
      intermediaryAsset: 'USC',
      custodyByPlatform: false,
      demoOnly: true,
    },
  },
  {
    slug: 'demo-liquidity-provider',
    name: 'Demo Liquidity Provider',
    rail: 'liquidity_provider',
    description:
      'Wholesale non-bank liquidity provider quoting a principal price, keener at size. Demo data only.',
    adapterId: 'sandbox-meridian-liquidity',
    reliabilityScore: '0.9780',
    quoteTtlSeconds: 30,
    intermediaryAsset: null,
    sourceCurrencies: ['USD', 'EUR', 'GBP', 'JPY', 'SGD', 'HKD'],
    targetCurrencies: ALL,
    minAmountUsd: '25000.00',
    maxAmountUsd: '100000000.00',
    spreadBps: { major: '19', nearMajor: '36' },
    slippageBps: '2',
    settlement: {
      p50Seconds: 1_800,
      p95Seconds: 14_400,
      businessDaysOnly: true,
      cutoffUtc: '20:00',
    },
    legTemplate: ['fx_conversion'],
    metadata: {
      docsUrl: 'https://example.invalid/demo-liquidity-provider/docs',
      supportContact: 'demo-support@example.invalid',
      pricingModel: 'principal',
      demoOnly: true,
    },
  },
];

const DEMO_ORGANIZATION_ID = 'org_demo_meridian';
const DEMO_USER_ID = 'usr_demo_treasury';

async function main(): Promise<void> {
  assertCurrencyExponentsMatchCode();

  await seedCurrencies();
  const providerIdBySlug = await seedProviders();
  await seedRoutes(providerIdBySlug);
  await seedOrganization();
  await seedDemoAgent();
  await seedAgentDashboard();
  await seedCustomerPricing(providerIdBySlug);
  await seedDemoComparison(providerIdBySlug);
  await seedMonetization();

  await report();
}

/**
 * The database governs which currencies are *offered*; `CURRENCY_REGISTRY` in packages/core governs
 * what the money model *calculates with*, because an exponent must be available synchronously and
 * offline on the money path. Two sources of truth for the same fact is a real risk, so the seed
 * refuses to write a fiat exponent that disagrees with the code.
 */
function assertCurrencyExponentsMatchCode(): void {
  for (const currency of FIAT_CURRENCIES) {
    // Widened deliberately: TypeScript can prove today's literals are all registry codes, so
    // narrowing them would make the guard unreachable and useless the moment someone adds a
    // currency the code registry has never heard of.
    const code: string = currency.code;
    if (!isCurrencyCode(code)) {
      throw new Error(`Seed currency ${code} is not in CURRENCY_REGISTRY.`);
    }
    const expected = CURRENCY_REGISTRY[code].exponent;
    const actual = exponentOf(code);
    if (expected !== actual) {
      throw new Error(
        `Exponent mismatch for ${currency.code}: code registry says ${expected}, seed says ${actual}.`,
      );
    }
  }
}

function exponentOf(code: string): number {
  if (isCurrencyCode(code)) {
    return CURRENCY_REGISTRY[code].exponent;
  }
  const stablecoin = STABLECOIN_CURRENCIES.find((candidate) => candidate.code === code);
  if (stablecoin === undefined) {
    throw new Error(`No exponent known for ${code}.`);
  }
  return stablecoin.exponent;
}

async function seedCurrencies(): Promise<void> {
  for (const currency of FIAT_CURRENCIES) {
    const data = {
      name: currency.name,
      numericCode: currency.numericCode,
      exponent: exponentOf(currency.code),
      kind: 'fiat' as const,
      symbol: currency.symbol,
      isActive: true,
    };
    await prisma.currency.upsert({
      where: { code: currency.code },
      create: { code: currency.code, ...data },
      update: data,
    });
  }

  for (const currency of STABLECOIN_CURRENCIES) {
    const data = {
      name: currency.name,
      exponent: currency.exponent,
      kind: 'stablecoin' as const,
      symbol: currency.symbol,
      isActive: true,
    };
    await prisma.currency.upsert({
      where: { code: currency.code },
      create: { code: currency.code, ...data },
      update: data,
    });
  }
}

async function seedProviders(): Promise<Map<string, string>> {
  const idBySlug = new Map<string, string>();

  for (const seed of PROVIDERS) {
    const provider = await prisma.provider.upsert({
      where: { slug: seed.slug },
      create: {
        id: `prv_${seed.slug.replaceAll('-', '_')}`,
        slug: seed.slug,
        name: seed.name,
        rail: seed.rail,
        // Demo providers are unlicensed sandbox pricing and may never be served in production.
        licensing: 'unlicensed_sandbox',
        modes: ['sandbox'],
        jurisdictions: ['*'],
        description: seed.description,
        adapterId: seed.adapterId,
        pricingVersion: 'demo-seed-2026.02',
        reliabilityScore: new Prisma.Decimal(seed.reliabilityScore),
        quoteTtlSeconds: seed.quoteTtlSeconds,
        metadata: seed.metadata,
      },
      update: {
        name: seed.name,
        rail: seed.rail,
        description: seed.description,
        adapterId: seed.adapterId,
        reliabilityScore: new Prisma.Decimal(seed.reliabilityScore),
        quoteTtlSeconds: seed.quoteTtlSeconds,
        metadata: seed.metadata,
      },
    });
    idBySlug.set(seed.slug, provider.id);

    await seedCapabilities(provider.id, seed);
  }

  return idBySlug;
}

async function seedCapabilities(providerId: string, seed: ProviderSeed): Promise<void> {
  for (const source of seed.sourceCurrencies) {
    for (const target of seed.targetCurrencies) {
      if (source === target) {
        continue;
      }

      const spreadBps = NEAR_MAJORS.has(target) ? seed.spreadBps.nearMajor : seed.spreadBps.major;
      const data = {
        minAmountMinorUnits: usdToMinorUnits(seed.minAmountUsd, source),
        maxAmountMinorUnits: usdToMinorUnits(seed.maxAmountUsd, source),
        spreadBps: new Prisma.Decimal(spreadBps),
        slippageBps: new Prisma.Decimal(seed.slippageBps),
        settlementP50Seconds: seed.settlement.p50Seconds,
        settlementP95Seconds: seed.settlement.p95Seconds,
        businessDaysOnly: seed.settlement.businessDaysOnly,
        cutoffUtc: seed.settlement.cutoffUtc,
        intermediaryAsset: seed.intermediaryAsset,
        isActive: true,
      };

      await prisma.providerCapability.upsert({
        where: {
          providerId_sourceCurrency_targetCurrency: {
            providerId,
            sourceCurrency: source,
            targetCurrency: target,
          },
        },
        create: {
          id: `cap_${randomUUID().replaceAll('-', '')}`,
          providerId,
          sourceCurrency: source,
          targetCurrency: target,
          ...data,
        },
        update: data,
      });
    }
  }
}

/**
 * Notional limits are negotiated in USD but stored in the corridor's source currency, so they are
 * comparable against a request without a conversion at query time. The reference rates that make
 * that conversion possible come from the same dataset the adapters price from.
 */
const rates = createSandboxAdapters();

function usdToMinorUnits(amountUsd: string, currency: string): Prisma.Decimal {
  if (!isCurrencyCode(currency)) {
    throw new Error(`Cannot convert a limit into ${currency}.`);
  }
  const money = rates.rates.convertFromUsd(amountUsd, currency);
  if (money === null) {
    throw new Error(`No reference rate for USD/${currency}.`);
  }
  return new Prisma.Decimal(money.minorUnits.toString());
}

async function seedRoutes(providerIdBySlug: Map<string, string>): Promise<void> {
  for (const seed of PROVIDERS) {
    const providerId = providerIdBySlug.get(seed.slug);
    if (providerId === undefined) {
      continue;
    }

    for (const source of seed.sourceCurrencies) {
      for (const target of seed.targetCurrencies) {
        if (source === target) {
          continue;
        }
        const key = `${seed.slug}:${seed.rail}:${source}-${target}`;
        const data = { legTemplate: [...seed.legTemplate], status: 'active' as const };

        await prisma.route.upsert({
          where: { key },
          create: {
            id: `rte_${randomUUID().replaceAll('-', '')}`,
            key,
            providerId,
            rail: seed.rail,
            sourceCurrency: source,
            targetCurrency: target,
            ...data,
          },
          update: data,
        });
      }
    }
  }
}

async function seedOrganization(): Promise<void> {
  const passwordHash = await hashPassword(DEMO_USER_PASSWORD);

  await prisma.organization.upsert({
    where: { id: DEMO_ORGANIZATION_ID },
    create: {
      id: DEMO_ORGANIZATION_ID,
      name: 'Meridian Demo Trading Co',
      slug: 'demo-trading-co',
      countryCode: 'SG',
      status: 'active',
      metadata: { demoOnly: true, industry: 'electronics-distribution' },
    },
    update: { name: 'Meridian Demo Trading Co' },
  });

  await prisma.user.upsert({
    where: { id: DEMO_USER_ID },
    create: {
      id: DEMO_USER_ID,
      email: 'treasury@demo-trading.example.invalid',
      displayName: 'Demo Treasury Operator',
      status: 'active',
      locale: 'en',
      timezone: 'Asia/Singapore',
      passwordHash,
      passwordSetAt: new Date(),
    },
    update: {
      displayName: 'Demo Treasury Operator',
      passwordHash,
      passwordSetAt: new Date(),
    },
  });

  await prisma.organizationMember.upsert({
    where: {
      organizationId_userId: { organizationId: DEMO_ORGANIZATION_ID, userId: DEMO_USER_ID },
    },
    create: {
      id: 'mbr_demo_owner',
      organizationId: DEMO_ORGANIZATION_ID,
      userId: DEMO_USER_ID,
      role: 'owner',
      status: 'active',
      joinedAt: new Date('2026-01-15T09:00:00.000Z'),
    },
    update: { role: 'owner', status: 'active' },
  });
}

async function seedDemoAgent(): Promise<void> {
  const createdAt = new Date('2026-03-01T09:00:00.000Z');
  await prisma.agent.upsert({
    where: { id: DEMO_AGENT_ID },
    create: {
      id: DEMO_AGENT_ID,
      organizationId: DEMO_ORGANIZATION_ID,
      name: DEMO_AGENT_NAME,
      status: 'active',
      createdAt,
      updatedAt: createdAt,
    },
    update: { name: DEMO_AGENT_NAME, status: 'active' },
  });
  await prisma.agentCredential.upsert({
    where: { id: DEMO_AGENT_CREDENTIAL_ID },
    create: {
      id: DEMO_AGENT_CREDENTIAL_ID,
      agentId: DEMO_AGENT_ID,
      organizationId: DEMO_ORGANIZATION_ID,
      keyPrefix: DEMO_AGENT_SECRET.slice(0, 16),
      secretHash: await hashPassword(DEMO_AGENT_SECRET),
      scopes: [...DEFAULT_AGENT_SCOPES],
      createdAt,
    },
    update: { secretHash: await hashPassword(DEMO_AGENT_SECRET), scopes: [...DEFAULT_AGENT_SCOPES] },
  });
  await prisma.agentWalletReference.upsert({
    where: { id: DEMO_WALLET_REFERENCE_ID },
    create: {
      id: DEMO_WALLET_REFERENCE_ID,
      organizationId: DEMO_ORGANIZATION_ID,
      agentId: DEMO_AGENT_ID,
      kind: 'external_account',
      label: 'Demo treasury operating account',
      externalRef: 'ext_acct_demo_treasury',
      controlledByPlatform: false,
      createdAt,
    },
    update: { controlledByPlatform: false },
  });
  await prisma.merchant.upsert({
    where: { id: DEMO_MERCHANT_ID },
    create: {
      id: DEMO_MERCHANT_ID,
      organizationId: DEMO_ORGANIZATION_ID,
      name: DEMO_MERCHANT_NAME,
      recipientCode: DEMO_MERCHANT_CODE,
      settlementAsset: 'KRW',
      status: 'active',
      createdAt,
    },
    update: { name: DEMO_MERCHANT_NAME, recipientCode: DEMO_MERCHANT_CODE },
  });
  await prisma.paymentPolicy.upsert({
    where: { id: DEMO_PAYMENT_POLICY_ID },
    create: {
      id: DEMO_PAYMENT_POLICY_ID,
      organizationId: DEMO_ORGANIZATION_ID,
      agentId: DEMO_AGENT_ID,
      maxTransactionAmountMinorUnits: new Prisma.Decimal(DEMO_AGENT_POLICY.maxTransactionAmountMinorUnits),
      allowedAssets: [...DEMO_AGENT_POLICY.allowedAssets],
      allowedRecipientCodes: [...DEMO_AGENT_POLICY.allowedRecipientCodes],
      allowedProviderIds: [...DEMO_AGENT_POLICY.allowedProviderIds],
      allowedChainIds: [...DEMO_AGENT_POLICY.allowedChainIds],
      allowedCountryCodes: [...DEMO_AGENT_POLICY.allowedCountryCodes],
      maxFeeBps: new Prisma.Decimal(DEMO_AGENT_POLICY.maxFeeBps),
      maxSlippageBps: new Prisma.Decimal(DEMO_AGENT_POLICY.maxSlippageBps),
      minRouteScore: new Prisma.Decimal(DEMO_AGENT_POLICY.minRouteScore),
      minLiquidityHeadroom: new Prisma.Decimal(DEMO_AGENT_POLICY.minLiquidityHeadroom),
      dailySpendingLimitMinorUnits: new Prisma.Decimal(DEMO_AGENT_POLICY.dailySpendingLimitMinorUnits),
      dailySpendingAsset: DEMO_AGENT_POLICY.dailySpendingAsset,
      preferredRoutePreference: DEMO_AGENT_POLICY.preferredRoutePreference,
      createdAt,
      updatedAt: createdAt,
    },
    update: {
      maxTransactionAmountMinorUnits: new Prisma.Decimal(DEMO_AGENT_POLICY.maxTransactionAmountMinorUnits),
      allowedAssets: [...DEMO_AGENT_POLICY.allowedAssets],
      allowedRecipientCodes: [...DEMO_AGENT_POLICY.allowedRecipientCodes],
      allowedProviderIds: [...DEMO_AGENT_POLICY.allowedProviderIds],
      allowedChainIds: [...DEMO_AGENT_POLICY.allowedChainIds],
      allowedCountryCodes: [...DEMO_AGENT_POLICY.allowedCountryCodes],
      maxFeeBps: new Prisma.Decimal(DEMO_AGENT_POLICY.maxFeeBps),
      maxSlippageBps: new Prisma.Decimal(DEMO_AGENT_POLICY.maxSlippageBps),
      minRouteScore: new Prisma.Decimal(DEMO_AGENT_POLICY.minRouteScore),
      minLiquidityHeadroom: new Prisma.Decimal(DEMO_AGENT_POLICY.minLiquidityHeadroom),
      dailySpendingLimitMinorUnits: new Prisma.Decimal(DEMO_AGENT_POLICY.dailySpendingLimitMinorUnits),
      dailySpendingAsset: DEMO_AGENT_POLICY.dailySpendingAsset,
      preferredRoutePreference: DEMO_AGENT_POLICY.preferredRoutePreference,
    },
  });
}

async function seedAgentDashboard(): Promise<void> {
  const nowIso = new Date().toISOString();
  for (const intent of demoAgentPaymentIntents(nowIso)) {
    if (intent.organizationId !== DEMO_ORGANIZATION_ID) {
      continue;
    }
    await prisma.paymentIntent.upsert({
      where: { id: intent.id },
      create: {
        id: intent.id,
        organizationId: intent.organizationId,
        agentId: intent.agentId,
        sourceAsset: intent.sourceAsset,
        destinationAsset: intent.destinationAsset,
        amountMinorUnits: new Prisma.Decimal(intent.amountMinorUnits),
        recipient: intent.recipient,
        purpose: intent.purpose,
        routePreference: intent.routePreference,
        maxFeeBps: intent.maxFeeBps === null ? null : new Prisma.Decimal(intent.maxFeeBps),
        expiresAt: new Date(intent.expiresAt),
        status: intent.status,
        idempotencyKey: intent.idempotencyKey,
        payloadFingerprint: intent.payloadFingerprint,
        quotedRoutes: intent.quotedRoutes as unknown as Prisma.InputJsonValue,
        quoteExpiresAt: intent.quoteExpiresAt === null ? null : new Date(intent.quoteExpiresAt),
        selectedRouteId: intent.selectedRouteId,
        authorizedAt: intent.authorizedAt === null ? null : new Date(intent.authorizedAt),
        simulatedAt: intent.simulatedAt === null ? null : new Date(intent.simulatedAt),
        simulation:
          intent.simulation === null
            ? Prisma.JsonNull
            : (intent.simulation as unknown as Prisma.InputJsonValue),
        failureReason: intent.failureReason,
        fundsMoved: false,
        custody: false,
        realExecution: false,
        actor: intent.actor,
        createdAt: new Date(intent.createdAt),
        updatedAt: new Date(intent.updatedAt),
      },
      update: {},
    });
  }

  for (const violation of demoAgentPolicyViolations(nowIso)) {
    if (violation.organizationId !== DEMO_ORGANIZATION_ID) {
      continue;
    }
    const existing = await prisma.auditLog.findUnique({ where: { eventId: violation.eventId } });
    if (existing !== null) {
      continue;
    }
    await prisma.auditLog.create({
      data: {
        eventId: violation.eventId,
        type: 'payment.policy.denied',
        occurredAt: new Date(violation.occurredAt),
        actor: 'provision',
        requestId: null,
        comparisonId: null,
        providerId: null,
        organizationId: violation.organizationId,
        payload: {
          rule: violation.rule,
          message: violation.message,
          failClosed: true,
          organizationId: violation.organizationId,
          agentId: violation.agentId,
          ...(violation.paymentIntentId === null
            ? {}
            : { paymentIntentId: violation.paymentIntentId }),
        },
      },
    });
  }
}

async function seedCustomerPricing(providerIdBySlug: Map<string, string>): Promise<void> {
  const effectiveFrom = new Date('2026-01-01T00:00:00.000Z');

  // A default platform markup across every corridor.
  await prisma.customerPricing.upsert({
    where: { id: 'cpr_demo_default' },
    create: {
      id: 'cpr_demo_default',
      organizationId: DEMO_ORGANIZATION_ID,
      markupBps: new Prisma.Decimal('8'),
      priority: 0,
      status: 'active',
      effectiveFrom,
      notes: 'Default demo markup applied where no corridor-specific term matches.',
    },
    update: { markupBps: new Prisma.Decimal('8') },
  });

  // A negotiated term on the customer's highest-volume corridor, which outranks the default.
  await prisma.customerPricing.upsert({
    where: { id: 'cpr_demo_usd_krw' },
    create: {
      id: 'cpr_demo_usd_krw',
      organizationId: DEMO_ORGANIZATION_ID,
      sourceCurrency: 'USD',
      targetCurrency: 'KRW',
      markupBps: new Prisma.Decimal('4'),
      discountBps: new Prisma.Decimal('2'),
      platformFeeMinorUnits: new Prisma.Decimal('0'),
      feeCurrency: 'USD',
      priority: 100,
      status: 'active',
      effectiveFrom,
      notes: 'Negotiated USD/KRW term for the demo organization. Outranks the default markup.',
    },
    update: { markupBps: new Prisma.Decimal('4'), discountBps: new Prisma.Decimal('2') },
  });

  // A rail-specific term, showing that pricing can be narrowed by provider as well as corridor.
  const stablecoinProviderId = providerIdBySlug.get('demo-stablecoin-provider');
  if (stablecoinProviderId !== undefined) {
    await prisma.customerPricing.upsert({
      where: { id: 'cpr_demo_stablecoin' },
      create: {
        id: 'cpr_demo_stablecoin',
        organizationId: DEMO_ORGANIZATION_ID,
        rail: 'stablecoin_settlement',
        providerId: stablecoinProviderId,
        markupBps: new Prisma.Decimal('6'),
        priority: 50,
        status: 'active',
        effectiveFrom,
        notes: 'Rail-specific demo term for stablecoin settlement.',
      },
      update: { markupBps: new Prisma.Decimal('6') },
    });
  }
}

/**
 * Builds a demo transaction request and persists real engine output against it.
 *
 * Running the engine rather than typing figures into a fixture is what keeps this seed truthful:
 * if the pricing dataset or the cost model changes, the demo data changes with it, and any schema
 * that could not represent a real quote would fail here rather than in production.
 */
async function seedDemoComparison(providerIdBySlug: Map<string, string>): Promise<void> {
  const sandbox = createSandboxAdapters();
  const memory = new InMemoryPersistenceDriver();

  const service = new RouteComparisonService({
    mode: 'sandbox',
    registry: ProviderRegistry.create('sandbox', sandbox.providers),
    costEngine: new RouteCostEngine(),
    defaultWeights: defaultScoringWeights(),
    clock: systemClock,
    ids: uuidIdGenerator,
    auditLogger: new RepositoryAuditLogger({
      repository: memory.auditLog,
      clock: systemClock,
      ids: uuidIdGenerator,
      logger: noopLogger,
    }),
    comparisons: memory.comparisons,
    logger: noopLogger,
    providerTimeoutMs: 5_000,
    // The real resolver against the terms seeded above, so the demo quotes carry the platform fee
    // the demo organization actually negotiated rather than none.
    pricingResolver: new PrismaPlatformPricingResolver(prisma),
  });

  const comparison = await service.compare({
    organizationId: DEMO_ORGANIZATION_ID,
    sourceCurrency: 'USD',
    targetCurrency: 'KRW',
    amountMinorUnits: '10000000', // USD 100,000.00
    rails: null,
    weights: null,
    idempotencyKey: null,
    actor: 'seed',
    requestId: 'seed',
  });

  const requestId = 'txr_demo_usd_krw';
  await prisma.transactionRequest.deleteMany({ where: { id: requestId } });

  await prisma.transactionRequest.create({
    data: {
      id: requestId,
      organizationId: DEMO_ORGANIZATION_ID,
      requestedByUserId: DEMO_USER_ID,
      reference: 'DEMO-PO-4417',
      sourceCurrency: 'USD',
      targetCurrency: 'KRW',
      amountMinorUnits: new Prisma.Decimal('10000000'),
      // Priced, with live quotes. Never a settlement state: Meridian does not move money.
      status: 'quoted',
      notes: 'Seeded demo request. Indicative quotes only; no funds move.',
    },
  });

  const dto = serializeComparison(comparison);
  const adapterToProviderId = new Map(
    PROVIDERS.flatMap((seed) => {
      const id = providerIdBySlug.get(seed.slug);
      return id === undefined ? [] : [[seed.adapterId, id] as const];
    }),
  );

  for (const route of dto.routes) {
    const providerId = adapterToProviderId.get(route.provider.id);
    if (providerId === undefined) {
      throw new Error(
        `Adapter "${route.provider.id}" has no seeded Provider row. The registry and the ` +
          'integrations have diverged.',
      );
    }

    const quoteId = `qte_${randomUUID().replaceAll('-', '')}`;
    const routeRow = await prisma.route.findUnique({
      where: {
        providerId_sourceCurrency_targetCurrency_rail: {
          providerId,
          sourceCurrency: 'USD',
          targetCurrency: 'KRW',
          rail: route.provider.rail,
        },
      },
    });

    await prisma.quote.create({
      data: {
        id: quoteId,
        organizationId: DEMO_ORGANIZATION_ID,
        transactionRequestId: requestId,
        providerId,
        routeId: routeRow?.id ?? null,
        status: 'active',
        providerQuoteReference: route.quote.quoteReference,
        quotedAt: new Date(route.quote.quotedAt),
        expiresAt: new Date(route.quote.expiresAt ?? Date.now() + 60_000),
        sourceCurrency: 'USD',
        targetCurrency: 'KRW',
        amountMinorUnits: new Prisma.Decimal(route.sendAmount.minorUnits),
        midMarketRate: new Prisma.Decimal(route.midMarketRate.value),
        exchangeRate: new Prisma.Decimal(route.offeredRate.value),
        effectiveRate: new Prisma.Decimal(route.effectiveRate.value),
        spreadBps: spreadBpsOf(route),
        slippageBps: new Prisma.Decimal(route.slippageBps),
        totalFeeMinorUnits: totalFeeMinorUnits(route),
        totalCostMinorUnits: new Prisma.Decimal(route.totalCost.minorUnits),
        totalCostBps: new Prisma.Decimal(route.totalCostBps),
        estimatedReceiveMinorUnits: new Prisma.Decimal(route.deliveredAmount.minorUnits),
        benchmarkReceiveMinorUnits: new Prisma.Decimal(route.benchmarkAmount.minorUnits),
        settlementP50Seconds: route.settlement.p50Seconds,
        settlementP95Seconds: route.settlement.p95Seconds,
        businessDaysOnly: route.settlement.businessDaysOnly,
        score: new Prisma.Decimal(route.score),
        rank: route.rank,
        isRecommended: route.recommended,
        pricingVersion: route.quote.pricingVersion,
        // Whichever term the resolver actually selected, not an assumption about which one it was.
        customerPricingId: route.platformPricing.ruleId,
        providerMetadata: {
          adapterId: route.provider.id,
          railLabel: route.provider.railLabel,
          licensing: route.provider.licensing,
          intermediaryAsset: route.quote.intermediaryAsset,
        },
        fees: { create: feeRows(route) },
        legs: { create: legRows(route) },
      },
    });
  }

  // The selected quote records an intention, not an instruction. No funds move.
  const recommended = await prisma.quote.findFirst({
    where: { transactionRequestId: requestId, isRecommended: true },
  });
  if (recommended !== null) {
    await prisma.transactionRequest.update({
      where: { id: requestId },
      data: {
        status: 'quote_selected',
        selectedQuoteId: recommended.id,
        selectedAt: new Date(),
      },
    });
  }
}

async function seedMonetization(): Promise<void> {
  for (const event of demoMonetizationEvents(Date.now())) {
    const amounts = {
      occurredAt: new Date(event.occurredAt),
      transactionType: event.transactionType,
      revenueSource: event.revenueSource,
      rail: event.rail,
      providerId: event.providerId,
      providerName: event.providerName,
      currency: event.currency,
      asset: event.asset,
      destinationAsset: event.destinationAsset,
      agentId: event.agentId,
      tpvMinorUnits: new Prisma.Decimal(event.tpvMinorUnits),
      providerCostMinorUnits: new Prisma.Decimal(event.providerCostMinorUnits),
      platformRevenueMinorUnits: new Prisma.Decimal(event.platformRevenueMinorUnits),
      partnerCommissionMinorUnits: new Prisma.Decimal(event.partnerCommissionMinorUnits),
      grossProfitMinorUnits: new Prisma.Decimal(event.grossProfitMinorUnits),
      takeRateBps: event.takeRateBps === null ? null : new Prisma.Decimal(event.takeRateBps),
      fundsMoved: false,
      custody: false,
      realExecution: false,
      routeId: event.routeId,
      quoteId: event.quoteId,
      economicStage: event.economicStage,
      realizedRevenue: false,
    };
    await prisma.monetizationEvent.upsert({
      where: { id: event.id },
      create: { id: event.id, organizationId: event.organizationId, ...amounts },
      update: amounts,
    });
  }
}

function spreadBpsOf(route: RouteDto): Prisma.Decimal {
  const mid = new Prisma.Decimal(route.midMarketRate.value);
  const offered = new Prisma.Decimal(route.offeredRate.value);
  if (mid.isZero()) {
    return new Prisma.Decimal(0);
  }
  const bps = mid.minus(offered).dividedBy(mid).times(10_000);
  // A provider quoting above mid would be a negative spread; the column forbids it, and the demo
  // dataset never produces one. Clamped rather than crashing the seed on a future dataset change.
  return bps.isNegative() ? new Prisma.Decimal(0) : bps.toDecimalPlaces(4);
}

function totalFeeMinorUnits(route: RouteDto): Prisma.Decimal {
  return new Prisma.Decimal(route.breakdown.sourceFeeCost.minorUnits)
    .plus(route.breakdown.platformFeeCost.minorUnits)
    .plus(route.breakdown.destinationFeeCost.minorUnits);
}

function feeRows(route: RouteDto): Prisma.FeeCreateWithoutQuoteInput[] {
  return route.breakdown.appliedFees.map((fee) => ({
    id: `fee_${randomUUID().replaceAll('-', '')}`,
    code: fee.code,
    label: fee.label,
    side: fee.side,
    kind: fee.kind,
    // Carried through from the engine rather than assumed: a platform markup must never be recorded
    // as a provider charge.
    chargedBy: fee.chargedBy,
    // Nested creates address the relation, not the foreign-key scalar, so an unknown currency code
    // fails here rather than at the database.
    currencyRef: { connect: { code: fee.amount.currency } },
    amountMinorUnits: new Prisma.Decimal(fee.amount.minorUnits),
    rateBps: fee.rateBps === null ? null : new Prisma.Decimal(fee.rateBps),
    wasCapped: fee.capped,
  }));
}

/**
 * Shapes a route into its legs.
 *
 * A stablecoin route has three hops and the middle one is what a customer most wants to see; every
 * other rail here is a single conversion. The intermediary amount is derived from the engine's own
 * figures rather than recomputed, so the legs always reconcile to the quote.
 */
function legRows(route: RouteDto): Prisma.QuoteLegCreateWithoutQuoteInput[] {
  const sent = route.sendAmount;
  const received = route.deliveredAmount;

  if (route.provider.rail !== 'stablecoin_settlement' || sent.currency !== 'USD') {
    return [
      {
        id: `leg_${randomUUID().replaceAll('-', '')}`,
        sequence: 1,
        kind: 'fx_conversion' as const,
        from: { connect: { code: sent.currency } },
        to: { connect: { code: received.currency } },
        fromAmountMinorUnits: new Prisma.Decimal(sent.minorUnits),
        toAmountMinorUnits: new Prisma.Decimal(received.minorUnits),
        rate: new Prisma.Decimal(route.effectiveRate.value),
        counterparty: route.provider.name,
        estimatedSeconds: route.settlement.p50Seconds,
        metadata: { railLabel: route.provider.railLabel },
      },
    ];
  }

  // USD on-ramp is 1:1 into the USD-referenced demo stablecoin, less the source-side fees the
  // engine already accounted for. The stablecoin carries six decimals against the dollar's two.
  const sourceFees = BigInt(
    route.breakdown.appliedFees
      .filter((fee) => fee.side === 'source')
      .reduce((total, fee) => total + BigInt(fee.amount.minorUnits), 0n)
      .toString(),
  );
  const onRampUsdMinor = BigInt(sent.minorUnits) - sourceFees;
  const stablecoinMinor = onRampUsdMinor * 10_000n; // 2 decimals -> 6 decimals

  return [
    {
      id: `leg_${randomUUID().replaceAll('-', '')}`,
      sequence: 1,
      kind: 'fiat_onramp' as const,
      from: { connect: { code: 'USD' } },
      to: { connect: { code: 'USC' } },
      fromAmountMinorUnits: new Prisma.Decimal(sent.minorUnits),
      toAmountMinorUnits: new Prisma.Decimal(stablecoinMinor.toString()),
      rate: new Prisma.Decimal(1),
      counterparty: 'Demo regulated on-ramp partner',
      estimatedSeconds: 60,
      metadata: { custodyByPlatform: false },
    },
    {
      id: `leg_${randomUUID().replaceAll('-', '')}`,
      sequence: 2,
      kind: 'stablecoin_transfer' as const,
      from: { connect: { code: 'USC' } },
      to: { connect: { code: 'USC' } },
      fromAmountMinorUnits: new Prisma.Decimal(stablecoinMinor.toString()),
      toAmountMinorUnits: new Prisma.Decimal(stablecoinMinor.toString()),
      rate: new Prisma.Decimal(1),
      counterparty: 'Demo settlement network',
      estimatedSeconds: 30,
      metadata: { custodyByPlatform: false },
    },
    {
      id: `leg_${randomUUID().replaceAll('-', '')}`,
      sequence: 3,
      kind: 'fiat_offramp' as const,
      from: { connect: { code: 'USC' } },
      to: { connect: { code: received.currency } },
      fromAmountMinorUnits: new Prisma.Decimal(stablecoinMinor.toString()),
      toAmountMinorUnits: new Prisma.Decimal(received.minorUnits),
      rate: new Prisma.Decimal(route.slippageAdjustedRate.value),
      counterparty: 'Demo regulated off-ramp partner',
      estimatedSeconds: Math.max(route.settlement.p50Seconds - 90, 30),
      metadata: { custodyByPlatform: false },
    },
  ];
}

async function report(): Promise<void> {
  const [
    currencies,
    providers,
    capabilities,
    routes,
    requests,
    quotes,
    legs,
    fees,
    pricing,
    monetization,
  ] = await Promise.all([
    prisma.currency.count(),
    prisma.provider.count(),
    prisma.providerCapability.count(),
    prisma.route.count(),
    prisma.transactionRequest.count(),
    prisma.quote.count(),
    prisma.quoteLeg.count(),
    prisma.fee.count(),
    prisma.customerPricing.count(),
    prisma.monetizationEvent.count(),
  ]);

  process.stdout.write(
    [
      'Seeded demo data:',
      `  currencies            ${currencies}`,
      `  providers             ${providers}`,
      `  provider capabilities ${capabilities}`,
      `  routes                ${routes}`,
      `  transaction requests  ${requests}`,
      `  quotes                ${quotes}`,
      `  quote legs            ${legs}`,
      `  fees                  ${fees}`,
      `  customer pricing      ${pricing}`,
      `  monetization events   ${monetization}`,
      '',
      'Demo login (sandbox only):',
      '  email     treasury@demo-trading.example.invalid',
      '  password  MeridianDemo!2026',
      '',
    ].join('\n'),
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error: unknown) => {
    await prisma.$disconnect();
    process.stderr.write(`Seed failed: ${error instanceof Error ? error.stack : String(error)}\n`);
    process.exit(1);
  });
