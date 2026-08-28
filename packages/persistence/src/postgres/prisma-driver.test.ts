import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { readMigrations } from '../migrations.js';
import { toAuditEvent, toStoredComparison, type ComparisonRow } from './prisma-driver.js';

/**
 * Mapping and migration checks that need no database.
 *
 * These run everywhere, including in CI without PostgreSQL. The behaviour that genuinely requires a
 * server — whether the constraints and the trigger actually fire — is covered in
 * prisma-driver.integration.test.ts, gated on TEST_DATABASE_URL.
 */
function buildRow(overrides: Partial<ComparisonRow> = {}): ComparisonRow {
  return {
    comparisonId: 'cmp_1',
    createdAt: new Date('2026-03-01T09:00:00.000Z'),
    mode: 'sandbox',
    engineVersion: '1.0.0',
    fingerprint: 'f'.repeat(64),
    sourceCurrency: 'USD',
    targetCurrency: 'KRW',
    amountMinorUnits: new Prisma.Decimal('10000000'),
    idempotencyKey: null,
    snapshot: { quotes: [] },
    result: { routes: [] },
    ...overrides,
  };
}

describe('row mapping', () => {
  it('keeps a large minor-unit amount exact', () => {
    // IDR 90,071,992,547,409.93 in minor units — beyond Number.MAX_SAFE_INTEGER and an entirely
    // realistic notional for a frontier corridor.
    const exact = '9007199254740993000';
    const mapped = toStoredComparison(buildRow({ amountMinorUnits: new Prisma.Decimal(exact) }));

    expect(mapped.amountMinorUnits).toBe(exact);
    expect(typeof mapped.amountMinorUnits).toBe('string');
  });

  it('does not lose the low digits that toNumber() would drop', () => {
    // 2^53 + 1 is the smallest integer a double cannot represent, so it is the clearest
    // demonstration of what mapping through a number would cost.
    const exact = '9007199254740993';
    const mapped = toStoredComparison(buildRow({ amountMinorUnits: new Prisma.Decimal(exact) }));

    expect(mapped.amountMinorUnits).toBe(exact);
    expect(String(new Prisma.Decimal(exact).toNumber())).toBe('9007199254740992');
  });

  it('emits minor units with no decimal point, whatever the Decimal scale', () => {
    const mapped = toStoredComparison(
      buildRow({ amountMinorUnits: new Prisma.Decimal('10000000.00') }),
    );
    expect(mapped.amountMinorUnits).toBe('10000000');
  });

  it('normalises timestamps to ISO-8601 UTC', () => {
    expect(toStoredComparison(buildRow()).createdAt).toBe('2026-03-01T09:00:00.000Z');
  });

  it('carries the currency codes through without padding, since the column is VARCHAR(3)', () => {
    const mapped = toStoredComparison(buildRow());
    expect(mapped.sourceCurrency).toBe('USD');
    expect(mapped.targetCurrency).toBe('KRW');
  });

  it('passes the snapshot and result through opaquely', () => {
    const mapped = toStoredComparison(buildRow({ snapshot: { quotes: ['a'] } }));
    expect(mapped.snapshot).toEqual({ quotes: ['a'] });
  });

  it('maps an audit row, defaulting a null payload to an empty object', () => {
    expect(
      toAuditEvent({
        eventId: 'evt_1',
        type: 'comparison.completed',
        occurredAt: new Date('2026-03-01T09:00:01.000Z'),
        actor: 'tester',
        requestId: null,
        comparisonId: 'cmp_1',
        providerId: null,
        payload: null,
      }),
    ).toEqual({
      eventId: 'evt_1',
      type: 'comparison.completed',
      occurredAt: '2026-03-01T09:00:01.000Z',
      actor: 'tester',
      requestId: null,
      comparisonId: 'cmp_1',
      providerId: null,
      organizationId: null,
      payload: {},
    });
  });
});

describe('migrations', () => {
  const sql = readMigrations();

  it('creates every table the domain model needs', () => {
    for (const table of [
      'currencies',
      'organizations',
      'users',
      'organization_members',
      'api_keys',
      'providers',
      'provider_capabilities',
      'routes',
      'customer_pricing',
      'transaction_requests',
      'quotes',
      'quote_legs',
      'fees',
      'comparisons',
      'audit_logs',
      'sessions',
          'execution_intents',
          'agents',
          'agent_credentials',
          'agent_wallet_references',
          'merchants',
          'payment_policies',
          'payment_intents',
          'monetization_events',
          'rate_limit_buckets',
          'mfa_recovery_codes',
          'mfa_challenges',
          'organization_oidc_connections',
          'oidc_authorization_states',
    ]) {
      expect(sql).toContain(`CREATE TABLE "${table}"`);
    }
  });

  it('stores monetary amounts as an exact integer type and rates as scaled decimals', () => {
    expect(sql).toContain('"amount_minor_units" DECIMAL(38,0)');
    expect(sql).toContain('"exchange_rate" DECIMAL(38,18)');
    expect(sql).toContain('"estimated_receive_minor_units" DECIMAL(38,0)');
    expect(sql).not.toMatch(/\b(REAL|DOUBLE PRECISION|FLOAT|MONEY)\b/);
  });

  /**
   * These statements are hand-added to files that `prisma migrate diff` generates, because Prisma
   * cannot express a CHECK constraint, a partial unique index or a trigger. That makes them exactly
   * the kind of edit a regeneration could silently drop, so they are asserted here as well as
   * exercised against a real database in the integration suite.
   */
  it('constrains requests and quotes to genuine cross-currency corridors', () => {
    expect(sql).toContain('CHECK ("source_currency" <> "target_currency")');
    expect(sql).toContain('"request_amount_positive"');
    expect(sql).toContain('"quote_amount_positive"');
  });

  it('rejects a quote that expires before it was issued', () => {
    expect(sql).toContain('CHECK ("expires_at" > "quoted_at")');
  });

  it('rejects a non-positive rate', () => {
    expect(sql).toContain('"quote_rates_positive"');
  });

  it('rejects a negative fee, which would flatter a route', () => {
    expect(sql).toContain('"fee_amount_non_negative"');
  });

  it('bounds a currency exponent by kind, since stablecoins carry more decimals than fiat', () => {
    expect(sql).toContain('"currencies_exponent_range"');
    expect(sql).toContain("'stablecoin'");
  });

  it('allows at most one recommended quote per request', () => {
    expect(sql).toContain('"quotes_one_recommendation_per_request"');
    expect(sql).toContain('WHERE "is_recommended"');
  });

  it('enforces the append-only audit trail in the database', () => {
    expect(sql).toContain('BEFORE UPDATE OR DELETE ON "audit_logs"');
    expect(sql).toContain('append-only');
  });

  it('stores only a hash of an API key secret', () => {
    expect(sql).toContain('"secret_hash"');
    expect(sql).not.toContain('"secret" TEXT');
  });

  it('stores API key scopes and expiry without a plaintext secret column', () => {
    expect(sql).toContain('"scopes" TEXT[]');
    expect(sql).toContain('"expires_at" TIMESTAMPTZ(3)');
    expect(sql).toContain('"api_keys_scopes_known"');
  });

  it('records execution intents as non-executable recorded choices', () => {
    expect(sql).toContain('CREATE TABLE "execution_intents"');
    expect(sql).toContain('"execution_intents_status_recorded"');
    expect(sql).toContain('"execution_intents_not_executable"');
    expect(sql).toContain('"execution_intents_not_submitted"');
    expect(sql).toContain('CHECK ("executable" = false)');
    expect(sql).toContain('CHECK ("submitted" = false)');
  });

  it('stores agent credentials as a hash and wallet references as non-custodial', () => {
    expect(sql).toContain('CREATE TABLE "agents"');
    expect(sql).toContain('CREATE TABLE "agent_credentials"');
    expect(sql).toContain('CREATE TABLE "agent_wallet_references"');
    expect(sql).toContain('CREATE TABLE "merchants"');
    expect(sql).toContain('CREATE TABLE "payment_policies"');
    expect(sql).toContain('"preferred_route_preference"');
    expect(sql).toContain('CREATE TABLE "payment_intents"');
    expect(sql).toContain('"agent_wallet_references_not_custodied"');
    expect(sql).toContain('CHECK ("controlled_by_platform" = false)');
    expect(sql).toContain('"payment_intents_not_funds_moved"');
    expect(sql).toContain('CHECK ("funds_moved" = false)');
    expect(sql).toContain('CHECK ("custody" = false)');
    expect(sql).toContain('CHECK ("real_execution" = false)');
    expect(sql).not.toContain('"private_key"');
    expect(sql).not.toContain('"seed"');
  });

  it('stores monetization events as quoted fees, never settlements', () => {
    expect(sql).toContain('CREATE TABLE "monetization_events"');
    expect(sql).toContain('"monetization_events_funds_moved_false"');
    expect(sql).toContain('"monetization_events_custody_false"');
    expect(sql).toContain('"monetization_events_real_execution_false"');
    expect(sql).toContain('"tpv_minor_units" DECIMAL(38, 0)');
    expect(sql).toContain('"platform_revenue_minor_units" DECIMAL(38, 0)');
  });

  /**
   * The non-custody boundary, expressed in the schema: there is no settlement state to write, so
   * recording one would require a migration and a schema review.
   */
  it('defines no settlement state in the transaction request lifecycle', () => {
    const enumLine = sql
      .split('\n')
      .find((line) => line.includes('CREATE TYPE "TransactionRequestStatus"'));

    expect(enumLine).toBeDefined();
    for (const forbidden of ['settled', 'executed', 'funded', 'in_flight', 'paid', 'completed']) {
      expect(enumLine).not.toContain(forbidden);
    }
  });

  it('renames settlement-like payment-intent statuses in a later CHECK', () => {
    expect(sql).toContain("'POLICY_APPROVED'");
    expect(sql).toContain("'SIMULATION_PENDING'");
    expect(sql).toContain("'SIMULATION_COMPLETED'");
    expect(sql).toContain('UPDATE "payment_intents" SET "status" = \'SIMULATION_COMPLETED\' WHERE "status" = \'COMPLETED\'');
  });
});
