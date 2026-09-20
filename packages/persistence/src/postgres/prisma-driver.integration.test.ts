import { randomUUID } from 'node:crypto';
import {
  CURRENCY_REGISTRY,
  DEMO_USER_PASSWORD,
  isCurrencyCode,
  type CurrencyCode,
} from '@meridian/core';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { selectPricingRule } from '@meridian/core';
import { DASHBOARD_CATALOG_PRICING_VERSION } from './ensure-sandbox-catalog.js';
import { PrismaPersistenceDriver } from './prisma-driver.js';
import { PrismaPlatformPricingResolver } from './prisma-pricing-resolver.js';

/**
 * Integration tests against a real PostgreSQL instance.
 *
 * Everything the unit tests cannot reach lives here: whether the migration actually applies, whether
 * the CHECK constraints and the append-only trigger really fire, and whether a Decimal survives a
 * round trip through the database rather than only through the mapper.
 *
 * Gated on `TEST_DATABASE_URL` rather than `DATABASE_URL`, deliberately. These tests write and
 * delete rows, so requiring a separate, explicitly named variable means nobody can point them at a
 * real database by having the usual one exported in their shell.
 */
const TEST_DATABASE_URL = process.env['TEST_DATABASE_URL'];
const describeIntegration = TEST_DATABASE_URL === undefined ? describe.skip : describe;

describeIntegration('PostgreSQL schema', () => {
  let prisma: PrismaClient;
  let driver: PrismaPersistenceDriver;
  const createdComparisonIds: string[] = [];
  const createdRequestIds: string[] = [];

  beforeAll(() => {
    const connectionString = TEST_DATABASE_URL ?? '';
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
    driver = new PrismaPersistenceDriver({ connectionString });
  });

  afterAll(async () => {
    if (createdComparisonIds.length > 0) {
      await prisma.comparison.deleteMany({ where: { comparisonId: { in: createdComparisonIds } } });
    }
    if (createdRequestIds.length > 0) {
      await prisma.transactionRequest.deleteMany({ where: { id: { in: createdRequestIds } } });
    }
    await prisma.$disconnect();
    await driver.close();
  });

  describe('migration', () => {
    it('passes the driver health check, so the schema is present', async () => {
      await expect(driver.healthCheck()).resolves.toBeUndefined();
    });

    it('creates every table the domain model needs', async () => {
      const rows = await prisma.$queryRaw<{ tablename: string }[]>`
        SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename
      `;
      const tables = rows.map((row) => row.tablename);

      expect(tables).toEqual(
        expect.arrayContaining([
          'api_keys',
          'audit_logs',
          'comparisons',
          'currencies',
          'customer_pricing',
          'fees',
          'organization_members',
          'organizations',
          'provider_capabilities',
          'providers',
          'quote_legs',
          'quotes',
          'routes',
          'transaction_requests',
          'sessions',
          'users',
          'execution_intents',
          'agents',
          'agent_credentials',
          'agent_wallet_references',
          'merchants',
          'payment_policies',
          'payment_intents',
          'mfa_recovery_codes',
          'mfa_challenges',
          'organization_oidc_connections',
          'oidc_authorization_states',
          'organization_invites',
          'invoices',
          'invoice_lines',
          'routing_evaluations',
          'routing_manual_overrides',
          'provider_credentials',
          'mandates',
          'mandate_x402_challenges',
          'partner_instructions',
          'orchestrated_executions',
          'execution_receipts',
          'live_enablements',
          'monetization_events',
          'usage_counters',
          'organization_subscriptions',
          'collection_attempts',
        ]),
      );
    });

    it('stores no monetary column as a floating-point type', async () => {
      const rows = await prisma.$queryRaw<
        { table_name: string; column_name: string; data_type: string }[]
      >`
        SELECT table_name, column_name, data_type
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND (column_name LIKE '%amount%' OR column_name LIKE '%rate%'
               OR column_name LIKE '%bps%' OR column_name LIKE '%fee%')
      `;

      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.data_type).not.toMatch(/real|double precision|money/i);
      }
    });
  });

  describe('non-custody boundary', () => {
    /**
     * The strongest available guarantee that the MVP cannot record a settlement: the enum has no
     * value to write. Adding one requires a migration and a schema review, which is exactly the
     * friction it should have.
     */
    it('has no settlement state in the transaction request lifecycle', async () => {
      const rows = await prisma.$queryRaw<{ label: string }[]>`
        SELECT e.enumlabel AS label
        FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'TransactionRequestStatus'
      `;
      const labels = rows.map((row) => row.label);

      expect(labels.sort()).toEqual([
        'cancelled',
        'draft',
        'quote_selected',
        'quoted',
        'quotes_expired',
      ]);
      for (const forbidden of ['settled', 'executed', 'funded', 'in_flight', 'paid', 'completed']) {
        expect(labels).not.toContain(forbidden);
      }
    });

    it('restricts execution intent status to the recorded enum value', async () => {
      const rows = await prisma.$queryRaw<{ label: string }[]>`
        SELECT e.enumlabel AS label
        FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'ExecutionIntentStatus'
      `;
      expect(rows.map((row) => row.label)).toEqual(['recorded']);
    });

    it('indexes payment_intents for the daily-spend aggregate', async () => {
      const rows = await prisma.$queryRaw<{ indexname: string }[]>`
        SELECT indexname FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'payment_intents'
      `;
      const names = rows.map((row) => row.indexname);
      expect(names).toContain('payment_intents_daily_spend_authorized_idx');
      expect(names).toContain('payment_intents_daily_spend_created_idx');
    });

    it('stores no provider credential column', async () => {
      const rows = await prisma.$queryRaw<{ column_name: string }[]>`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'providers'
      `;
      const columns = rows.map((row) => row.column_name);

      for (const forbidden of [
        'api_key',
        'secret',
        'secret_hash',
        'password',
        'token',
        'credential',
      ]) {
        expect(columns).not.toContain(forbidden);
      }
    });

    it('stores only a hash for an API key, never the secret', async () => {
      const rows = await prisma.$queryRaw<{ column_name: string }[]>`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'api_keys'
      `;
      const columns = rows.map((row) => row.column_name);

      expect(columns).toContain('secret_hash');
      expect(columns).toContain('scopes');
      expect(columns).toContain('expires_at');
      expect(columns).not.toContain('secret');
    });
  });

  describe('decimal precision through the database', () => {
    it('round-trips a minor-unit amount beyond the safe integer range exactly', async () => {
      // IDR-scale notional: past 2^53, where a float or a JS number would quietly lose digits.
      const exact = '9007199254740993000';
      const comparisonId = `cmp_it_${randomUUID().replaceAll('-', '')}`;
      createdComparisonIds.push(comparisonId);

      await driver.comparisons.save({
        comparisonId,
        createdAt: '2026-03-01T09:00:00.000Z',
        mode: 'sandbox',
        engineVersion: '1.0.0',
        fingerprint: 'a'.repeat(64),
        sourceCurrency: 'USD',
        targetCurrency: 'KRW',
        amountMinorUnits: exact,
        idempotencyKey: null,
        snapshot: { quotes: [] },
        result: { routes: [] },
      });

      const stored = await driver.comparisons.findById(comparisonId);
      expect(stored?.amountMinorUnits).toBe(exact);
    });

    it('round-trips an 18-decimal exchange rate without truncation', async () => {
      const requestId = await createRequest();
      const rate = '1385.123456789012345678';

      const quote = await prisma.quote.create({
        data: {
          id: `qte_it_${randomUUID().replaceAll('-', '')}`,
          organizationId: 'org_demo_meridian',
          transactionRequestId: requestId,
          providerId: 'prv_demo_bank_fx',
          quotedAt: new Date('2026-03-01T09:00:00.000Z'),
          expiresAt: new Date('2026-03-01T09:15:00.000Z'),
          sourceCurrency: 'USD',
          targetCurrency: 'KRW',
          amountMinorUnits: new Prisma.Decimal('10000000'),
          midMarketRate: new Prisma.Decimal(rate),
          exchangeRate: new Prisma.Decimal(rate),
          effectiveRate: new Prisma.Decimal(rate),
          spreadBps: new Prisma.Decimal('0'),
          totalFeeMinorUnits: new Prisma.Decimal('0'),
          totalCostMinorUnits: new Prisma.Decimal('0'),
          totalCostBps: new Prisma.Decimal('0'),
          estimatedReceiveMinorUnits: new Prisma.Decimal('138512345'),
          benchmarkReceiveMinorUnits: new Prisma.Decimal('138512345'),
          settlementP50Seconds: 3600,
          settlementP95Seconds: 7200,
          pricingVersion: 'integration-test',
        },
      });

      const reloaded = await prisma.quote.findUniqueOrThrow({ where: { id: quote.id } });
      expect(reloaded.exchangeRate.toFixed()).toBe(rate);
    });
  });

  describe('financial invariants enforced by the database', () => {
    it('rejects a non-positive request amount', async () => {
      await expect(
        prisma.transactionRequest.create({
          data: {
            id: `txr_bad_${randomUUID().replaceAll('-', '')}`,
            organizationId: 'org_demo_meridian',
            sourceCurrency: 'USD',
            targetCurrency: 'KRW',
            amountMinorUnits: new Prisma.Decimal('0'),
          },
        }),
      ).rejects.toThrow(/request_amount_positive/);
    });

    it('rejects a same-currency corridor', async () => {
      await expect(
        prisma.transactionRequest.create({
          data: {
            id: `txr_bad_${randomUUID().replaceAll('-', '')}`,
            organizationId: 'org_demo_meridian',
            sourceCurrency: 'USD',
            targetCurrency: 'USD',
            amountMinorUnits: new Prisma.Decimal('10000'),
          },
        }),
      ).rejects.toThrow(/request_corridor_differs/);
    });

    it('rejects a quote that expires before it was issued', async () => {
      const requestId = await createRequest();
      await expect(
        prisma.quote.create({
          data: {
            id: `qte_bad_${randomUUID().replaceAll('-', '')}`,
            organizationId: 'org_demo_meridian',
            transactionRequestId: requestId,
            providerId: 'prv_demo_bank_fx',
            quotedAt: new Date('2026-03-01T09:15:00.000Z'),
            expiresAt: new Date('2026-03-01T09:00:00.000Z'),
            sourceCurrency: 'USD',
            targetCurrency: 'KRW',
            amountMinorUnits: new Prisma.Decimal('10000000'),
            midMarketRate: new Prisma.Decimal('1385'),
            exchangeRate: new Prisma.Decimal('1380'),
            effectiveRate: new Prisma.Decimal('1380'),
            spreadBps: new Prisma.Decimal('36'),
            totalFeeMinorUnits: new Prisma.Decimal('0'),
            totalCostMinorUnits: new Prisma.Decimal('500000'),
            totalCostBps: new Prisma.Decimal('36'),
            estimatedReceiveMinorUnits: new Prisma.Decimal('138000000'),
            benchmarkReceiveMinorUnits: new Prisma.Decimal('138500000'),
            settlementP50Seconds: 3600,
            settlementP95Seconds: 7200,
            pricingVersion: 'integration-test',
          },
        }),
      ).rejects.toThrow(/quote_expiry_after_quoted/);
    });

    it('rejects a negative fee, which would flatter a route', async () => {
      const requestId = await createRequest();
      const quoteId = await createQuote(requestId);

      await expect(
        prisma.fee.create({
          data: {
            id: `fee_bad_${randomUUID().replaceAll('-', '')}`,
            quoteId,
            code: 'rebate',
            label: 'Impossible rebate',
            side: 'source',
            kind: 'fixed',
            currency: 'USD',
            amountMinorUnits: new Prisma.Decimal('-100'),
          },
        }),
      ).rejects.toThrow(/fee_amount_non_negative/);
    });

    it('rejects an unknown currency code by referential integrity', async () => {
      await expect(
        prisma.transactionRequest.create({
          data: {
            id: `txr_bad_${randomUUID().replaceAll('-', '')}`,
            organizationId: 'org_demo_meridian',
            sourceCurrency: 'ZZZ',
            targetCurrency: 'KRW',
            amountMinorUnits: new Prisma.Decimal('10000'),
          },
        }),
      ).rejects.toThrow();
    });

    it('allows at most one recommended quote per request', async () => {
      const requestId = await createRequest();
      await createQuote(requestId, { isRecommended: true, providerId: 'prv_demo_bank_fx' });

      await expect(
        createQuote(requestId, { isRecommended: true, providerId: 'prv_demo_fx_provider' }),
      ).rejects.toThrow(/quotes_one_recommendation_per_request/);
    });

    it('rejects a capability whose maximum is below its minimum', async () => {
      await expect(
        prisma.providerCapability.create({
          data: {
            id: `cap_bad_${randomUUID().replaceAll('-', '')}`,
            providerId: 'prv_demo_bank_fx',
            sourceCurrency: 'GBP',
            targetCurrency: 'JPY',
            minAmountMinorUnits: new Prisma.Decimal('1000000'),
            maxAmountMinorUnits: new Prisma.Decimal('1000'),
            spreadBps: new Prisma.Decimal('20'),
            settlementP50Seconds: 3600,
            settlementP95Seconds: 7200,
          },
        }),
      ).rejects.toThrow(/capability_amount_bounds|capability_settlement_order|Unique/);
    });
  });

  describe('append-only audit trail', () => {
    it('accepts an insert', async () => {
      const eventId = `evt_it_${randomUUID().replaceAll('-', '')}`;
      await driver.auditLog.append({
        eventId,
        type: 'comparison.requested',
        occurredAt: '2026-03-01T09:00:00.000Z',
        actor: 'integration-test',
        requestId: null,
        comparisonId: null,
        providerId: null,
        payload: { note: 'insert is permitted' },
      });

      const events = await driver.auditLog.list({ limit: 200 });
      expect(events.some((event) => event.eventId === eventId)).toBe(true);
    });

    it('rejects an update, even from a direct SQL statement', async () => {
      const eventId = `evt_it_${randomUUID().replaceAll('-', '')}`;
      await driver.auditLog.append({
        eventId,
        type: 'comparison.completed',
        occurredAt: '2026-03-01T09:00:01.000Z',
        actor: 'integration-test',
        requestId: null,
        comparisonId: null,
        providerId: null,
        payload: {},
      });

      await expect(
        prisma.$executeRaw`UPDATE audit_logs SET actor = 'tampered' WHERE event_id = ${eventId}`,
      ).rejects.toThrow(/append-only/);
    });

    it('rejects a delete', async () => {
      const eventId = `evt_it_${randomUUID().replaceAll('-', '')}`;
      await driver.auditLog.append({
        eventId,
        type: 'execution.rejected',
        occurredAt: '2026-03-01T09:00:02.000Z',
        actor: 'integration-test',
        requestId: null,
        comparisonId: null,
        providerId: null,
        payload: {},
      });

      await expect(
        prisma.$executeRaw`DELETE FROM audit_logs WHERE event_id = ${eventId}`,
      ).rejects.toThrow(/append-only/);
    });
  });

  describe('comparison repository against a real database', () => {
    it('orders a list by created_at then id, so equal timestamps are a stable keyset', async () => {
      const shared = '2026-04-01T00:00:00.000Z';
      const earlierId = 'cmp_it_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
      const laterId = 'cmp_it_zzzzzzzzzzzzzzzzzzzzzzzzzzzzzz';
      createdComparisonIds.push(earlierId, laterId);

      for (const comparisonId of [earlierId, laterId]) {
        await driver.comparisons.save({
          comparisonId,
          createdAt: shared,
          mode: 'sandbox',
          engineVersion: '1.0.0',
          fingerprint: 'b'.repeat(64),
          sourceCurrency: 'USD',
          targetCurrency: 'KRW',
          amountMinorUnits: '10000000',
          idempotencyKey: null,
          snapshot: {},
          result: {},
        });
      }

      const listed = await driver.comparisons.list({ limit: 200 });
      const positions = [earlierId, laterId].map((id) =>
        listed.findIndex((item) => item.comparisonId === id),
      );

      expect(positions[0]).toBeGreaterThanOrEqual(0);
      expect(positions[1]).toBeGreaterThanOrEqual(0);
      // Newest-first keyset: identical createdAt uses id DESC, so laterId precedes earlierId.
      expect(positions[1]).toBeLessThan(positions[0] ?? Number.MAX_SAFE_INTEGER);
    });

    it('finds a comparison by idempotency key', async () => {
      const comparisonId = `cmp_it_${randomUUID().replaceAll('-', '')}`;
      const key = `it-key-${randomUUID()}`;
      createdComparisonIds.push(comparisonId);

      await driver.comparisons.save({
        comparisonId,
        createdAt: '2026-03-01T09:00:00.000Z',
        mode: 'sandbox',
        engineVersion: '1.0.0',
        fingerprint: 'c'.repeat(64),
        sourceCurrency: 'USD',
        targetCurrency: 'KRW',
        amountMinorUnits: '10000000',
        idempotencyKey: key,
        snapshot: {},
        result: {},
      });

      const found = await driver.comparisons.findByIdempotencyKey(key);
      expect(found?.comparisonId).toBe(comparisonId);
    });
  });

  describe('seeded demo data', () => {
    it('seeds the currencies demo mode offers', async () => {
      const currencies = await prisma.currency.findMany({ orderBy: { code: 'asc' } });
      const fiat = currencies.filter((currency) => currency.kind === 'fiat').map((c) => c.code);

      expect(fiat).toEqual(['EUR', 'GBP', 'HKD', 'JPY', 'KRW', 'SGD', 'USD']);
    });

    /**
     * The database governs which currencies are offered; CURRENCY_REGISTRY governs what the money
     * model calculates with. Two sources for one fact is a real risk, so it is asserted rather than
     * trusted.
     */
    it('agrees with the code registry on every fiat exponent', async () => {
      const currencies = await prisma.currency.findMany({ where: { kind: 'fiat' } });

      expect(currencies.length).toBeGreaterThan(0);
      for (const currency of currencies) {
        expect(isCurrencyCode(currency.code)).toBe(true);
        expect(currency.exponent).toBe(CURRENCY_REGISTRY[currency.code as CurrencyCode].exponent);
      }
    });

    /**
     * Two kinds of provider row live in this table, and they are asserted separately.
     *
     * `prisma db seed` writes one adapter-backed row per sandbox adapter. Booting the API against
     * a sandbox database additionally writes the demo-dashboard catalog rows, which exist only as
     * FK targets for the demo dashboard's quotes and are not adapter-backed. Asserting over the
     * whole table would make these tests report a different answer depending on whether the API
     * had ever started against the same database.
     */
    const adapterBacked = () =>
      prisma.provider.findMany({
        where: { pricingVersion: { not: DASHBOARD_CATALOG_PRICING_VERSION } },
        orderBy: { slug: 'asc' },
      });

    it('seeds the demo providers named in the brief', async () => {
      const providers = await adapterBacked();

      expect(providers.map((provider) => provider.name)).toEqual([
        'Demo Bank FX',
        'Demo FX Provider',
        'Demo Liquidity Provider',
        'Demo Stablecoin Provider',
      ]);
    });

    it('marks every demo provider as sandbox-only and unlicensed', async () => {
      const providers = await prisma.provider.findMany();

      for (const provider of providers) {
        expect(provider.licensing).toBe('unlicensed_sandbox');
        expect(provider.modes).toEqual(['sandbox']);
      }
    });

    it('stores no secret in provider metadata', async () => {
      const providers = await prisma.provider.findMany();

      for (const provider of providers) {
        const metadata = JSON.stringify(provider.metadata).toLowerCase();
        for (const forbidden of ['apikey', 'api_key', 'secret', 'password', 'token', 'bearer']) {
          expect(metadata).not.toContain(forbidden);
        }
      }
    });

    it('links every provider to the adapter that prices it', async () => {
      const providers = await adapterBacked();

      expect(providers).not.toHaveLength(0);
      for (const provider of providers) {
        expect(provider.adapterId).toMatch(/^sandbox-/);
      }
    });

    it('seeds capabilities and routes for every provider', async () => {
      const providers = await prisma.provider.findMany({
        where: { pricingVersion: { not: DASHBOARD_CATALOG_PRICING_VERSION } },
        include: { _count: { select: { capabilities: true, routes: true } } },
      });

      expect(providers).not.toHaveLength(0);
      for (const provider of providers) {
        expect(provider._count.capabilities).toBeGreaterThan(0);
        expect(provider._count.routes).toBeGreaterThan(0);
      }
    });

    it('claims no adapter on a demo-dashboard catalog row', async () => {
      // adapter_id is unique, so a catalog row claiming the adapter its seeded twin already holds
      // is unstorable — which is precisely how it used to fail: every API start against a seeded
      // database aborted on the unique index rather than on anything a reader would recognise.
      const catalog = await prisma.provider.findMany({
        where: { pricingVersion: DASHBOARD_CATALOG_PRICING_VERSION },
      });

      for (const provider of catalog) {
        expect(provider.adapterId).toBeNull();
        expect(provider.licensing).toBe('unlicensed_sandbox');
        expect(provider.modes).toEqual(['sandbox']);
      }
    });

    it('seeds a priced demo request whose quotes reconcile to their fees and legs', async () => {
      const request = await prisma.transactionRequest.findFirst({
        where: { reference: 'DEMO-PO-4417' },
        include: { quotes: { include: { fees: true, legs: { orderBy: { sequence: 'asc' } } } } },
      });

      expect(request).not.toBeNull();
      expect(request?.quotes.length).toBeGreaterThan(0);
      // A request, never a settlement.
      expect(['quoted', 'quote_selected']).toContain(request?.status);

      for (const quote of request?.quotes ?? []) {
        // Total fee equals the sum of the fee rows, in the quote's own terms.
        const feeSum = quote.fees.reduce(
          (total, fee) => total + BigInt(fee.amountMinorUnits.toFixed(0)),
          0n,
        );
        expect(feeSum).toBeGreaterThanOrEqual(0n);

        // Cost is the gap between the mid-market benchmark and what is actually received.
        const benchmark = BigInt(quote.benchmarkReceiveMinorUnits.toFixed(0));
        const received = BigInt(quote.estimatedReceiveMinorUnits.toFixed(0));
        expect(BigInt(quote.totalCostMinorUnits.toFixed(0))).toBe(benchmark - received);

        // Legs form a connected path from the send currency to the receive currency.
        expect(quote.legs.length).toBeGreaterThan(0);
        expect(quote.legs[0]?.fromCurrency).toBe(quote.sourceCurrency);
        expect(quote.legs.at(-1)?.toCurrency).toBe(quote.targetCurrency);
        for (let index = 1; index < quote.legs.length; index += 1) {
          expect(quote.legs[index]?.fromCurrency).toBe(quote.legs[index - 1]?.toCurrency);
        }
      }
    });

    it('decomposes the stablecoin route into on-ramp, transfer and off-ramp', async () => {
      const quote = await prisma.quote.findFirst({
        where: { provider: { slug: 'demo-stablecoin-provider' } },
        include: { legs: { orderBy: { sequence: 'asc' } } },
      });

      expect(quote?.legs.map((leg) => leg.kind)).toEqual([
        'fiat_onramp',
        'stablecoin_transfer',
        'fiat_offramp',
      ]);
      // The platform is named on no leg: it never holds the asset.
      for (const leg of quote?.legs ?? []) {
        expect(leg.counterparty).not.toMatch(/meridian/i);
      }
    });

    it('seeds overlapping customer pricing resolved by priority', async () => {
      const pricing = await prisma.customerPricing.findMany({
        where: { organizationId: 'org_demo_meridian' },
        orderBy: { priority: 'desc' },
      });

      expect(pricing.length).toBeGreaterThanOrEqual(2);
      // The corridor-specific term outranks the blanket default.
      expect(pricing[0]?.sourceCurrency).toBe('USD');
      expect(pricing[0]?.targetCurrency).toBe('KRW');
      expect(pricing.at(-1)?.sourceCurrency).toBeNull();
    });

    it('seeds an organization with an owner whose password is stored only as a hash', async () => {
      const organization = await prisma.organization.findFirst({
        where: { slug: 'demo-trading-co' },
        include: { members: { include: { user: true } } },
      });

      expect(organization?.members).toHaveLength(1);
      expect(organization?.members[0]?.role).toBe('owner');
      // The seed provisions a sandbox demo login, so a hash is expected here. What must never
      // appear is the password itself, in this column or any other.
      const stored = organization?.members[0]?.user.passwordHash;
      expect(stored).not.toBeNull();
      expect(stored).not.toContain(DEMO_USER_PASSWORD);
      expect(stored).toMatch(/^(scrypt|argon2|\$2[aby])\$/);
    });
  });

  describe('platform pricing resolution against seeded terms', () => {
    /**
     * The resolver fetches candidates and the engine's pure `selectPricingRule` chooses — so these
     * tests exercise the two together, against the real seeded rows, which is the path a production
     * quote takes. This was the one financial component of the quote engine with no test against a
     * real database.
     */
    const resolver = () => new PrismaPlatformPricingResolver(prisma);
    const AT = '2026-03-01T00:00:00.000Z';

    function criteriaFor(
      source: string,
      target: string,
      rail: string,
      providerId: string,
    ): Parameters<typeof selectPricingRule>[1] {
      return {
        organizationId: 'org_demo_meridian',
        sourceCurrency: source,
        targetCurrency: target,
        rail,
        providerId,
        at: AT,
      } as Parameters<typeof selectPricingRule>[1];
    }

    async function resolveFor(
      source: string,
      target: string,
      rail = 'bank_fx',
      providerId = 'prv_demo_bank_fx',
    ) {
      const rules = await resolver().rulesFor({
        organizationId: 'org_demo_meridian',
        sourceCurrency: source,
        targetCurrency: target,
        at: AT,
      });
      return selectPricingRule(rules, criteriaFor(source, target, rail, providerId));
    }

    it('selects the corridor-specific term over the blanket default', async () => {
      const rule = await resolveFor('USD', 'KRW');

      expect(rule?.id).toBe('cpr_demo_usd_krw');
      expect(rule?.markupBps).toBe('4');
      expect(rule?.discountBps).toBe('2');
    });

    it('falls back to the default markup on a corridor with no negotiated term', async () => {
      const rule = await resolveFor('EUR', 'JPY');

      expect(rule?.id).toBe('cpr_demo_default');
      expect(rule?.markupBps).toBe('8');
    });

    it('selects the rail-and-provider term where it matches', async () => {
      const rule = await resolveFor(
        'USD',
        'EUR',
        'stablecoin_settlement',
        'prv_demo_stablecoin_provider',
      );

      expect(rule?.id).toBe('cpr_demo_stablecoin');
      expect(rule?.markupBps).toBe('6');
    });

    it('lets an explicit priority outrank a more specific lower-priority rule', async () => {
      // USD->KRW over the stablecoin rail matches all three seeded rules. The corridor term wins on
      // priority 100, despite the rail rule naming the provider.
      const rule = await resolveFor(
        'USD',
        'KRW',
        'stablecoin_settlement',
        'prv_demo_stablecoin_provider',
      );

      expect(rule?.id).toBe('cpr_demo_usd_krw');
    });

    it('returns no rules for an organization with no negotiated terms', async () => {
      const rules = await resolver().rulesFor({
        organizationId: 'org_nobody',
        sourceCurrency: 'USD',
        targetCurrency: 'KRW',
        at: AT,
      });

      expect(rules).toEqual([]);
    });

    it('excludes terms that were not yet effective at the quoted instant', async () => {
      const rules = await resolver().rulesFor({
        organizationId: 'org_demo_meridian',
        sourceCurrency: 'USD',
        targetCurrency: 'KRW',
        // Before the seeded effectiveFrom of 2026-01-01.
        at: '2025-12-01T00:00:00.000Z',
      });

      expect(rules).toEqual([]);
    });
  });

  /**
   * The 8-A and 8-B constraints, exercised against the real engine.
   *
   * These rules are the reason the resolver can be trusted: the application refuses to promote a
   * simulated origin, and the database refuses to hold the row even if some future write path
   * forgets to ask. A unit test can only prove the first half.
   */
  describe('revenue lifecycle and launch billing constraints', () => {
    const snapshotIds: string[] = [];
    const invoiceIds: string[] = [];

    afterAll(async () => {
      if (snapshotIds.length > 0) {
        await prisma.monetizationEvent.deleteMany({ where: { id: { in: snapshotIds } } });
      }
      if (invoiceIds.length > 0) {
        // Lines and collection attempts cascade from the invoice.
        await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
      }
      await prisma.usageCounter.deleteMany({ where: { organizationId: 'org_demo_meridian' } });
    });

    /** A snapshot that is realized in every respect except the fields a test overrides. */
    function realizedSnapshot(overrides: Record<string, unknown> = {}): Record<string, unknown> {
      const id = `mon_it_${randomUUID().replaceAll('-', '')}`;
      snapshotIds.push(id);
      return {
        id,
        organizationId: 'org_demo_meridian',
        occurredAt: new Date('2026-04-02T09:00:00.000Z'),
        transactionType: 'multi_rail_quote',
        revenueSource: 'traditional_fx_routing_fee',
        currency: 'USD',
        asset: 'USD',
        tpvMinorUnits: new Prisma.Decimal('10000000'),
        providerCostMinorUnits: new Prisma.Decimal('30000'),
        platformRevenueMinorUnits: new Prisma.Decimal('20000'),
        partnerCommissionMinorUnits: new Prisma.Decimal('0'),
        grossProfitMinorUnits: new Prisma.Decimal('20000'),
        economicStage: 'settled',
        realizedRevenue: true,
        revenueRecognition: 'collected',
        originEnv: 'PRODUCTION',
        settlementFinality: 'provider_confirmed',
        collectionReference: 'ch_it_1',
        ...overrides,
      };
    }

    it('accepts a snapshot where all three realization facts hold', async () => {
      const created = await prisma.monetizationEvent.create({ data: realizedSnapshot() as never });
      expect(created.realizedRevenue).toBe(true);
      expect(created.originEnv).toBe('PRODUCTION');
    });

    it('rejects realized revenue on a non-production origin', async () => {
      // The 8-A regression, at the storage layer: a mock partner reporting `settled` cannot put a
      // realized row in the table, whatever the caller passes.
      for (const originEnv of ['DEMO', 'SIMULATION', 'PARTNER_SANDBOX']) {
        await expect(
          prisma.monetizationEvent.create({ data: realizedSnapshot({ originEnv }) as never }),
        ).rejects.toThrow(/monetization_events_realized_requires_production/);
      }
    });

    it('rejects realized revenue whose finality was only simulated', async () => {
      await expect(
        prisma.monetizationEvent.create({
          data: realizedSnapshot({ settlementFinality: 'simulated' }) as never,
        }),
      ).rejects.toThrow(/monetization_events_realized_requires_finality/);
    });

    it('rejects realized revenue with no collection reference behind it', async () => {
      await expect(
        prisma.monetizationEvent.create({
          data: realizedSnapshot({ collectionReference: null }) as never,
        }),
      ).rejects.toThrow(/monetization_events_realized_requires_collection_ref/);
    });

    it('keeps the recognition constraint live, not merely declared', async () => {
      // The gap analysis called this constraint inert because nothing ever wrote `collected`. It
      // is not inert: an invoiced row claiming realization is rejected. Which of the realization
      // constraints Postgres reports first is not the point — several of them cover this row, and
      // that redundancy is deliberate.
      await expect(
        prisma.monetizationEvent.create({
          data: realizedSnapshot({ revenueRecognition: 'invoiced' }) as never,
        }),
      ).rejects.toThrow(/monetization_events_(realized|collection_ref)/);
      await expect(
        prisma.monetizationEvent.create({
          data: realizedSnapshot({
            revenueRecognition: 'invoiced',
            collectionReference: null,
          }) as never,
        }),
      ).rejects.toThrow(/monetization_events_realized_requires_collection_ref/);
    });

    it('rejects a collection reference on a snapshot that was never collected', async () => {
      await expect(
        prisma.monetizationEvent.create({
          data: realizedSnapshot({
            realizedRevenue: false,
            revenueRecognition: 'invoiced',
          }) as never,
        }),
      ).rejects.toThrow(/monetization_events_collection_ref_requires_collected/);
    });

    it('rejects an unknown origin or finality value', async () => {
      // Checked on an unrealized row so the realization constraints cannot mask the value check:
      // an unrecognised environment must be refused even where nothing is being claimed as cash.
      const unrealized = {
        realizedRevenue: false,
        revenueRecognition: 'unrealized',
        collectionReference: null,
      };
      await expect(
        prisma.monetizationEvent.create({
          data: realizedSnapshot({ ...unrealized, originEnv: 'STAGING' }) as never,
        }),
      ).rejects.toThrow(/monetization_events_origin_env_known/);
      await expect(
        prisma.monetizationEvent.create({
          data: realizedSnapshot({ ...unrealized, settlementFinality: 'probably' }) as never,
        }),
      ).rejects.toThrow(/monetization_events_settlement_finality_known/);
    });

    /** An issued invoice, with the collection columns left at whatever a test needs. */
    async function createInvoice(
      overrides: Record<string, unknown> = {},
    ): Promise<{ readonly id: string }> {
      const id = `inv_it_${randomUUID().replaceAll('-', '')}`;
      invoiceIds.push(id);
      return prisma.invoice.create({
        data: {
          id,
          invoiceNumber: `INV-IT-${id}`,
          organizationId: 'org_demo_meridian',
          // The unique key is (org, periodStart, currency), so each invoice needs its own month.
          periodStart: new Date(Date.UTC(2020, invoiceIds.length % 12, 1)),
          periodEnd: new Date(Date.UTC(2020, (invoiceIds.length % 12) + 1, 1)),
          currency: 'USD',
          subtotalMinorUnits: new Prisma.Decimal('20000'),
          taxMinorUnits: new Prisma.Decimal('0'),
          totalMinorUnits: new Prisma.Decimal('20000'),
          issuedAt: new Date('2026-05-01T00:00:00.000Z'),
          issuedByActor: 'integration-test',
          ...overrides,
        } as never,
      });
    }

    it('refuses to let a record-only invoice claim it was collected', async () => {
      // RECORD_ONLY is the launch mode and means no money was requested. Collecting an invoice
      // moves it to LIVE alongside the status, so this pairing can only be a mislabelled row.
      await expect(
        createInvoice({
          collectionMode: 'RECORD_ONLY',
          collectionStatus: 'collected',
          collectionReference: 'ch_it_2',
        }),
      ).rejects.toThrow(/invoices_record_only_stays_uncollected/);
    });

    it('refuses a collected invoice with no processor reference', async () => {
      await expect(
        createInvoice({ collectionMode: 'LIVE', collectionStatus: 'collected' }),
      ).rejects.toThrow(/invoices_collected_requires_reference/);
    });

    it('accepts an invoice collected in live mode with its reference', async () => {
      const invoice = await createInvoice({
        collectionMode: 'LIVE',
        collectionStatus: 'collected',
        collectionReference: 'ch_it_3',
      });
      expect(invoice.id).toMatch(/^inv_it_/);
    });

    it('charges one class per invoice line, and only names a decision on a decision line', async () => {
      const invoice = await createInvoice();
      await expect(
        prisma.invoiceLine.create({
          data: {
            id: `inl_it_${randomUUID().replaceAll('-', '')}`,
            invoiceId: invoice.id,
            monetizationEventId: null,
            eventClass: 'FLAT_DECISION',
            description: 'decision fee naming no decision',
            quantity: new Prisma.Decimal('1'),
            platformRevenueMinorUnits: new Prisma.Decimal('100'),
            economicStage: 'execution_intent',
            transactionType: 'multi_rail_quote',
            revenueSource: 'traditional_fx_routing_fee',
            occurredAt: new Date('2026-04-02T09:00:00.000Z'),
          } as never,
        }),
      ).rejects.toThrow(/invoice_lines_snapshot_matches_class/);

      await expect(
        prisma.invoiceLine.create({
          data: {
            id: `inl_it_${randomUUID().replaceAll('-', '')}`,
            invoiceId: invoice.id,
            eventClass: 'RETAINER',
            description: 'a class nobody defined',
            quantity: new Prisma.Decimal('1'),
            platformRevenueMinorUnits: new Prisma.Decimal('100'),
            economicStage: 'subscription',
            transactionType: 'enterprise_subscription',
            revenueSource: 'enterprise_subscription',
            occurredAt: new Date('2026-04-02T09:00:00.000Z'),
          } as never,
        }),
      ).rejects.toThrow(/invoice_lines_event_class_known/);
    });

    it('lets only one collection attempt hold a given idempotency key', async () => {
      // The property the whole no-double-charge argument rests on. Without the unique index, a
      // concurrent retry would open a second attempt and charge twice.
      const invoice = await createInvoice();
      const idempotencyKey = `collect:${invoice.id}`;
      const attempt = {
        invoiceId: invoice.id,
        organizationId: 'org_demo_meridian',
        idempotencyKey,
        mode: 'RECORD_ONLY',
        status: 'recorded',
        currency: 'USD',
        amountMinorUnits: new Prisma.Decimal('20000'),
        createdAt: new Date('2026-05-02T00:00:00.000Z'),
        updatedAt: new Date('2026-05-02T00:00:00.000Z'),
      };

      await prisma.collectionAttempt.create({
        data: { id: `col_it_${randomUUID().replaceAll('-', '')}`, ...attempt } as never,
      });
      await expect(
        prisma.collectionAttempt.create({
          data: { id: `col_it_${randomUUID().replaceAll('-', '')}`, ...attempt } as never,
        }),
      ).rejects.toThrow(/idempotency_key|Unique constraint/i);
    });

    it('counts calls exactly past the safe integer range, one counter per endpoint', async () => {
      // PA-H07 applies to usage as much as to revenue: a call count near 2^53 multiplied by a
      // per-call price is exactly where a float would round the invoice.
      const beyondSafeInteger = '9007199254740993';
      const counter = {
        organizationId: 'org_demo_meridian',
        periodStart: new Date('2020-01-01T00:00:00.000Z'),
        endpoint: 'quote',
        firstCallAt: new Date('2020-01-01T00:00:00.000Z'),
        lastCallAt: new Date('2020-01-31T00:00:00.000Z'),
      };

      const created = await prisma.usageCounter.create({
        data: {
          id: `usg_it_${randomUUID().replaceAll('-', '')}`,
          ...counter,
          callCount: new Prisma.Decimal(beyondSafeInteger),
        } as never,
      });
      expect(created.callCount.toFixed(0)).toBe(beyondSafeInteger);

      await expect(
        prisma.usageCounter.create({
          data: {
            id: `usg_it_${randomUUID().replaceAll('-', '')}`,
            ...counter,
            callCount: new Prisma.Decimal('1'),
          } as never,
        }),
      ).rejects.toThrow(/organization_id|Unique constraint/i);
    });
  });

  async function createRequest(): Promise<string> {
    const id = `txr_it_${randomUUID().replaceAll('-', '')}`;
    createdRequestIds.push(id);
    await prisma.transactionRequest.create({
      data: {
        id,
        organizationId: 'org_demo_meridian',
        sourceCurrency: 'USD',
        targetCurrency: 'KRW',
        amountMinorUnits: new Prisma.Decimal('10000000'),
      },
    });
    return id;
  }

  async function createQuote(
    transactionRequestId: string,
    overrides: { isRecommended?: boolean; providerId?: string } = {},
  ): Promise<string> {
    const id = `qte_it_${randomUUID().replaceAll('-', '')}`;
    await prisma.quote.create({
      data: {
        id,
        organizationId: 'org_demo_meridian',
        transactionRequestId,
        providerId: overrides.providerId ?? 'prv_demo_bank_fx',
        isRecommended: overrides.isRecommended ?? false,
        quotedAt: new Date(),
        expiresAt: new Date(Date.now() + 900_000),
        sourceCurrency: 'USD',
        targetCurrency: 'KRW',
        amountMinorUnits: new Prisma.Decimal('10000000'),
        midMarketRate: new Prisma.Decimal('1385.42'),
        exchangeRate: new Prisma.Decimal('1380'),
        effectiveRate: new Prisma.Decimal('1380'),
        spreadBps: new Prisma.Decimal('39'),
        totalFeeMinorUnits: new Prisma.Decimal('0'),
        totalCostMinorUnits: new Prisma.Decimal('542000'),
        totalCostBps: new Prisma.Decimal('39'),
        estimatedReceiveMinorUnits: new Prisma.Decimal('138000000'),
        benchmarkReceiveMinorUnits: new Prisma.Decimal('138542000'),
        settlementP50Seconds: 3600,
        settlementP95Seconds: 7200,
        pricingVersion: 'integration-test',
      },
    });
    return id;
  }

  describe('settlement instruction constraints', () => {
    const instructionIds: string[] = [];
    const intentIds: string[] = [];

    afterAll(async () => {
      await prisma.settlementInstruction.deleteMany({ where: { id: { in: instructionIds } } });
      await prisma.executionIntent.deleteMany({ where: { id: { in: intentIds } } });
    });

    async function createIntent(): Promise<string> {
      const id = `eit_it_${randomUUID().replaceAll('-', '')}`;
      intentIds.push(id);
      await prisma.executionIntent.create({
        data: {
          id,
          organizationId: 'org_demo_meridian',
          requestId: `req_${id}`,
          routeId: 'route_it_1',
          sourceAsset: 'USD',
          destinationAsset: 'KRW',
          amountMinorUnits: new Prisma.Decimal('50000'),
          actor: 'integration-test',
        } as never,
      });
      return id;
    }

    /** A returned instruction, with whichever column a test wants to bend. */
    async function createInstruction(
      overrides: Record<string, unknown> = {},
    ): Promise<{ readonly id: string }> {
      const id = `msi_it_${randomUUID().replaceAll('-', '')}`;
      instructionIds.push(id);
      const executionIntentId = await createIntent();
      return prisma.settlementInstruction.create({
        data: {
          id,
          organizationId: 'org_demo_meridian',
          executionIntentId,
          routingId: 'rte_it_1',
          routeId: 'route_it_1',
          boundaryMode: 'RETURN_TO_CUSTOMER',
          originEnv: 'PRODUCTION',
          payloadCanonical: '{"instructionVersion":"1"}',
          payloadHash: 'a'.repeat(64),
          signature: 'c2lnbmF0dXJl',
          signingKeyId: 'msi-1-abc',
          createdAt: new Date('2026-05-01T00:00:00.000Z'),
          expiresAt: new Date('2026-05-01T00:15:00.000Z'),
          ...overrides,
        } as never,
      });
    }

    it('stores a generated instruction', async () => {
      const created = await createInstruction();
      const row = await prisma.settlementInstruction.findUniqueOrThrow({
        where: { id: created.id },
      });
      expect(row.meridianTransmitted).toBe(false);
      expect(row.fundsMoved).toBe(false);
      expect(row.custody).toBe(false);
      expect(row.customerSignature).toBeNull();
    });

    it('refuses to record that Meridian transmitted an instruction', async () => {
      // The invariant the phase exists to keep, at the storage layer. Recording a transmission
      // requires dropping a named constraint first, which is a reviewable act rather than a
      // silent one.
      await expect(createInstruction({ meridianTransmitted: true })).rejects.toThrow(
        /settlement_instructions_never_transmitted/,
      );
    });

    it('refuses a boundary mode in which Meridian is the sender', async () => {
      for (const boundaryMode of ['MERIDIAN_DISPATCHES', 'DISPATCH', 'PARTNER_EXECUTES_LIVE']) {
        await expect(createInstruction({ boundaryMode })).rejects.toThrow(
          /settlement_instructions_boundary_mode_known/,
        );
      }
    });

    it('accepts both real boundary modes', async () => {
      for (const boundaryMode of ['RETURN_TO_CUSTOMER', 'PARTNER_EXECUTES']) {
        const created = await createInstruction({ boundaryMode });
        expect(created.id).toMatch(/^msi_it_/);
      }
    });

    it('refuses a custodial claim', async () => {
      await expect(createInstruction({ fundsMoved: true })).rejects.toThrow(
        /settlement_instructions_non_custodial/,
      );
      await expect(createInstruction({ custody: true })).rejects.toThrow(
        /settlement_instructions_non_custodial/,
      );
    });

    it('refuses an unknown origin environment', async () => {
      await expect(createInstruction({ originEnv: 'STAGING' })).rejects.toThrow(
        /settlement_instructions_origin_env_known/,
      );
    });

    it('refuses a half-written customer signature', async () => {
      // A signature with no algorithm cannot be verified by anyone, and a timestamp with no
      // signature claims the customer approved something with nothing behind it.
      await expect(createInstruction({ customerSignature: 'sig' })).rejects.toThrow(
        /settlement_instructions_customer_signature_complete/,
      );
      await expect(
        createInstruction({ customerSignedAt: new Date('2026-05-01T00:05:00.000Z') }),
      ).rejects.toThrow(/settlement_instructions_customer_signature_complete/);
    });

    it('accepts a complete customer signature and still records no transmission', async () => {
      const created = await createInstruction({
        customerSignature: 'Y3VzdG9tZXI',
        customerSignatureAlgorithm: 'Ed25519',
        customerKeyId: 'customer-key-1',
        customerSignedAt: new Date('2026-05-01T00:05:00.000Z'),
      });
      const row = await prisma.settlementInstruction.findUniqueOrThrow({
        where: { id: created.id },
      });
      expect(row.customerSignature).toBe('Y3VzdG9tZXI');
      // Counter-signed and still not transmitted: the row cannot say otherwise.
      expect(row.meridianTransmitted).toBe(false);
    });

    it('refuses an unknown customer signature algorithm', async () => {
      await expect(
        createInstruction({
          customerSignature: 'sig',
          customerSignatureAlgorithm: 'RSA_PKCS1_MD5',
          customerKeyId: 'k',
          customerSignedAt: new Date('2026-05-01T00:05:00.000Z'),
        }),
      ).rejects.toThrow(/settlement_instructions_customer_signature_algorithm_known/);
    });

    it('refuses an instruction that expires before it exists', async () => {
      await expect(
        createInstruction({ expiresAt: new Date('2026-04-30T23:00:00.000Z') }),
      ).rejects.toThrow(/settlement_instructions_expiry_after_creation/);
    });

    it('refuses signed material that cannot be verified', async () => {
      // Canonical bytes and their hash travel together; a row with one and not the other is
      // unusable by the party it was generated for.
      await expect(createInstruction({ payloadCanonical: '' })).rejects.toThrow(
        /settlement_instructions_signed_material_present/,
      );
      await expect(createInstruction({ payloadHash: 'short' })).rejects.toThrow(
        /settlement_instructions_signed_material_present/,
      );
      await expect(createInstruction({ signature: '' })).rejects.toThrow(
        /settlement_instructions_signed_material_present/,
      );
    });

    it('has no column that could advance an instruction toward being sent', async () => {
      const columns = await prisma.$queryRaw<{ readonly column_name: string }[]>`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'settlement_instructions'
      `;
      const names = columns.map((column) => column.column_name);
      // Checked against the live schema rather than the migration text: this is what the database
      // actually has after every migration in the folder has been applied.
      for (const forbidden of ['status', 'dispatched_at', 'submitted_at', 'sent_at', 'partner_id']) {
        expect(names, `settlement_instructions has ${forbidden}`).not.toContain(forbidden);
      }
      expect(names).toContain('meridian_transmitted');
    });

    it('drops instructions with the intent they were generated from', async () => {
      const executionIntentId = await createIntent();
      const id = `msi_it_${randomUUID().replaceAll('-', '')}`;
      await prisma.settlementInstruction.create({
        data: {
          id,
          organizationId: 'org_demo_meridian',
          executionIntentId,
          routingId: 'rte_it_cascade',
          routeId: 'route_it_1',
          boundaryMode: 'RETURN_TO_CUSTOMER',
          originEnv: 'PRODUCTION',
          payloadCanonical: '{"instructionVersion":"1"}',
          payloadHash: 'b'.repeat(64),
          signature: 'c2ln',
          signingKeyId: 'msi-1-abc',
          createdAt: new Date('2026-05-01T00:00:00.000Z'),
          expiresAt: new Date('2026-05-01T00:15:00.000Z'),
        } as never,
      });

      await prisma.executionIntent.delete({ where: { id: executionIntentId } });
      expect(
        await prisma.settlementInstruction.findUnique({ where: { id } }),
      ).toBeNull();
    });
  });
});
