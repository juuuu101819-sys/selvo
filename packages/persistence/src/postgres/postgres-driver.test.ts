import { describe, expect, it } from 'vitest';
import { readInitialMigration, toAuditEvent, toStoredComparison } from './postgres-driver.js';

/**
 * The PostgreSQL driver's row mapping is unit-tested here because it is where precision and type
 * bugs hide: NUMERIC arrives as a string, CHAR(3) arrives blank-padded, and TIMESTAMPTZ arrives as
 * a Date. A driver test against a live database belongs in Phase 2, when PostgreSQL becomes the
 * default and CI can provision one.
 */
describe('row mapping', () => {
  it('keeps a large minor-unit amount as an exact string', () => {
    const mapped = toStoredComparison({
      comparison_id: 'cmp_1',
      created_at: new Date('2026-03-01T09:00:00.000Z'),
      mode: 'sandbox',
      engine_version: '1.0.0',
      fingerprint: 'f'.repeat(64),
      source_currency: 'USD',
      target_currency: 'KRW',
      // Beyond Number.MAX_SAFE_INTEGER: a numeric-to-number conversion would corrupt this.
      amount_minor_units: '9007199254740993000',
      idempotency_key: null,
      snapshot: { quotes: [] },
      result: { routes: [] },
    });

    expect(mapped.amountMinorUnits).toBe('9007199254740993000');
    expect(typeof mapped.amountMinorUnits).toBe('string');
  });

  it('trims the blank padding PostgreSQL adds to CHAR(3) currency codes', () => {
    const mapped = toStoredComparison({
      comparison_id: 'cmp_1',
      created_at: new Date('2026-03-01T09:00:00.000Z'),
      mode: 'sandbox',
      engine_version: '1.0.0',
      fingerprint: 'f'.repeat(64),
      source_currency: 'USD',
      target_currency: 'KRW  ',
      amount_minor_units: '100',
      idempotency_key: 'key-1',
      snapshot: {},
      result: {},
    });

    expect(mapped.targetCurrency).toBe('KRW');
  });

  it('normalises timestamps to ISO-8601 UTC', () => {
    const mapped = toStoredComparison({
      comparison_id: 'cmp_1',
      created_at: new Date('2026-03-01T09:00:00.000Z'),
      mode: 'sandbox',
      engine_version: '1.0.0',
      fingerprint: 'f'.repeat(64),
      source_currency: 'USD',
      target_currency: 'KRW',
      amount_minor_units: '100',
      idempotency_key: null,
      snapshot: {},
      result: {},
    });

    expect(mapped.createdAt).toBe('2026-03-01T09:00:00.000Z');
  });

  it('maps an audit row, defaulting a null payload to an empty object', () => {
    const mapped = toAuditEvent({
      event_id: 'evt_1',
      type: 'comparison.completed',
      occurred_at: new Date('2026-03-01T09:00:01.000Z'),
      actor: 'tester',
      request_id: null,
      comparison_id: 'cmp_1',
      provider_id: null,
      payload: null,
    });

    expect(mapped).toEqual({
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

describe('migration', () => {
  const migration = readInitialMigration();

  it('creates both tables', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS comparisons');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS audit_events');
  });

  it('stores monetary amounts as an exact integer type, never a float', () => {
    expect(migration).toContain('amount_minor_units NUMERIC(38, 0)');
    expect(migration).not.toMatch(/\b(REAL|DOUBLE PRECISION|FLOAT|MONEY)\b/);
  });

  it('enforces the append-only audit trail in the database', () => {
    expect(migration).toContain('BEFORE UPDATE OR DELETE ON audit_events');
    expect(migration).toContain('append-only');
  });

  it('constrains a comparison to a genuine cross-currency corridor', () => {
    expect(migration).toContain('CHECK (source_currency <> target_currency)');
  });
});
