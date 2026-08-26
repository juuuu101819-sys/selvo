import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { readInitialMigration } from '../migrations.js';
import { toAuditEvent, toStoredComparison, type ComparisonRow } from './prisma-driver.js';

/**
 * The Prisma driver's row mapping is unit-tested here because it is where precision and type bugs
 * would hide: `Decimal(38, 0)` arrives as a Prisma Decimal, and `Timestamptz` as a Date. A driver
 * test against a live database belongs in Phase 2, when PostgreSQL becomes the default and CI can
 * provision one.
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
      payload: {},
    });
  });
});

describe('initial migration', () => {
  const migration = readInitialMigration();

  it('creates the comparison and audit tables', () => {
    expect(migration).toContain('CREATE TABLE "comparisons"');
    expect(migration).toContain('CREATE TABLE "audit_events"');
  });

  it('creates the tables the authentication architecture is prepared around', () => {
    expect(migration).toContain('CREATE TABLE "organisations"');
    expect(migration).toContain('CREATE TABLE "users"');
    expect(migration).toContain('CREATE TABLE "api_keys"');
  });

  it('stores monetary amounts as an exact integer type, never a float', () => {
    expect(migration).toContain('"amount_minor_units" DECIMAL(38,0)');
    expect(migration).not.toMatch(/\b(REAL|DOUBLE PRECISION|FLOAT|MONEY)\b/);
  });

  /**
   * These statements are hand-added to a file that `prisma migrate diff` generates, because Prisma
   * cannot express a CHECK constraint or a trigger. That makes them exactly the kind of edit a
   * future regeneration could silently drop, so they are asserted.
   */
  it('constrains a comparison to a genuine cross-currency corridor for a positive amount', () => {
    expect(migration).toContain('CHECK ("source_currency" <> "target_currency")');
    expect(migration).toContain('CHECK ("amount_minor_units" > 0)');
    expect(migration).toContain(`CHECK ("mode" IN ('sandbox', 'production'))`);
  });

  it('enforces the append-only audit trail in the database', () => {
    expect(migration).toContain('BEFORE UPDATE OR DELETE ON "audit_events"');
    expect(migration).toContain('append-only');
  });

  it('stores only a hash of an API key secret', () => {
    expect(migration).toContain('"secret_hash"');
    expect(migration).not.toContain('"secret" TEXT');
  });
});
