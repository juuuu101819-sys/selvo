import { IdempotencyConflictError, type AuditEvent, type StoredComparison } from '@meridian/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { createPersistenceDriver } from '../index.js';
import { InMemoryPersistenceDriver } from './memory-driver.js';

function buildComparison(overrides: Partial<StoredComparison> = {}): StoredComparison {
  return {
    comparisonId: 'cmp_1',
    createdAt: '2026-03-01T09:00:00.000Z',
    mode: 'sandbox',
    engineVersion: '1.0.0',
    fingerprint: 'a'.repeat(64),
    sourceCurrency: 'USD',
    targetCurrency: 'KRW',
    amountMinorUnits: '10000000',
    idempotencyKey: null,
    snapshot: { quotes: [] },
    result: { routes: [] },
    ...overrides,
  };
}

function buildEvent(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    eventId: 'evt_1',
    type: 'comparison.requested',
    occurredAt: '2026-03-01T09:00:00.000Z',
    actor: 'tester',
    requestId: 'req_1',
    comparisonId: 'cmp_1',
    providerId: null,
    payload: {},
    ...overrides,
  };
}

describe('InMemoryPersistenceDriver', () => {
  let driver: InMemoryPersistenceDriver;

  beforeEach(() => {
    driver = new InMemoryPersistenceDriver();
  });

  describe('comparisons', () => {
    it('round-trips a stored comparison', async () => {
      await driver.comparisons.save(buildComparison());
      const found = await driver.comparisons.findById('cmp_1');

      expect(found).toMatchObject({ comparisonId: 'cmp_1', amountMinorUnits: '10000000' });
    });

    it('returns null for an unknown id', async () => {
      await expect(driver.comparisons.findById('cmp_missing')).resolves.toBeNull();
    });

    it('looks a comparison up by idempotency key', async () => {
      await driver.comparisons.save(buildComparison({ idempotencyKey: 'key-1' }));
      const found = await driver.comparisons.findByIdempotencyKey('key-1');

      expect(found?.comparisonId).toBe('cmp_1');
    });

    it('rejects reusing an idempotency key for a different comparison', async () => {
      await driver.comparisons.save(buildComparison({ idempotencyKey: 'key-1' }));

      await expect(
        driver.comparisons.save(
          buildComparison({ comparisonId: 'cmp_2', idempotencyKey: 'key-1' }),
        ),
      ).rejects.toThrow(IdempotencyConflictError);
    });

    it('allows re-saving the same comparison under its own key', async () => {
      await driver.comparisons.save(buildComparison({ idempotencyKey: 'key-1' }));
      await expect(
        driver.comparisons.save(buildComparison({ idempotencyKey: 'key-1' })),
      ).resolves.toBeUndefined();
    });

    it('lists comparisons newest first', async () => {
      await driver.comparisons.save(
        buildComparison({ comparisonId: 'cmp_1', createdAt: '2026-03-01T09:00:00.000Z' }),
      );
      await driver.comparisons.save(
        buildComparison({ comparisonId: 'cmp_2', createdAt: '2026-03-02T09:00:00.000Z' }),
      );

      const listed = await driver.comparisons.list();
      expect(listed.map((item) => item.comparisonId)).toEqual(['cmp_2', 'cmp_1']);
    });

    it('honours a list limit', async () => {
      for (let index = 0; index < 5; index += 1) {
        await driver.comparisons.save(buildComparison({ comparisonId: `cmp_${index}` }));
      }
      await expect(driver.comparisons.list({ limit: 2 })).resolves.toHaveLength(2);
    });

    it('isolates stored state from later mutation of the caller\u2019s object', async () => {
      const comparison = buildComparison({ snapshot: { quotes: ['original'] } });
      await driver.comparisons.save(comparison);

      const mutable = comparison.snapshot as { quotes: string[] };
      mutable.quotes.push('injected');

      const found = await driver.comparisons.findById('cmp_1');
      expect((found?.snapshot as { quotes: string[] }).quotes).toEqual(['original']);
    });

    it('isolates stored state from mutation of a returned object', async () => {
      await driver.comparisons.save(buildComparison({ snapshot: { quotes: ['original'] } }));

      const first = await driver.comparisons.findById('cmp_1');
      (first?.snapshot as { quotes: string[] }).quotes.push('injected');

      const second = await driver.comparisons.findById('cmp_1');
      expect((second?.snapshot as { quotes: string[] }).quotes).toEqual(['original']);
    });
  });

  describe('audit log', () => {
    it('appends and reads back events for a comparison in order', async () => {
      await driver.auditLog.append(buildEvent({ eventId: 'evt_1' }));
      await driver.auditLog.append(buildEvent({ eventId: 'evt_2', type: 'comparison.completed' }));
      await driver.auditLog.append(buildEvent({ eventId: 'evt_3', comparisonId: 'cmp_other' }));

      const events = await driver.auditLog.listByComparison('cmp_1');
      expect(events.map((event) => event.eventId)).toEqual(['evt_1', 'evt_2']);
    });

    it('lists the most recent events first', async () => {
      await driver.auditLog.append(buildEvent({ eventId: 'evt_1' }));
      await driver.auditLog.append(buildEvent({ eventId: 'evt_2' }));

      const events = await driver.auditLog.list();
      expect(events.map((event) => event.eventId)).toEqual(['evt_2', 'evt_1']);
    });

    it('exposes no way to alter an event once written', () => {
      // The port is the enforcement: there is no update or delete to call.
      expect('update' in driver.auditLog).toBe(false);
      expect('delete' in driver.auditLog).toBe(false);
    });
  });

  it('reports healthy and closes cleanly', async () => {
    await expect(driver.healthCheck()).resolves.toBeUndefined();
    await expect(driver.close()).resolves.toBeUndefined();
  });

  it('records an execution intent as a non-executable choice', async () => {
    const stored = await driver.executionIntents.create({
      id: 'eit_1',
      organizationId: 'org_1',
      requestId: 'req_1',
      routeId: 'rte_1',
      sourceAsset: 'USD',
      destinationAsset: 'KRW',
      amountMinorUnits: '10000000',
      status: 'recorded',
      executable: false,
      submitted: false,
      quoteExpiresAt: null,
      actor: 'tester',
      createdAt: '2026-03-01T09:00:00.000Z',
    });
    expect(stored.executable).toBe(false);
    expect(stored.submitted).toBe(false);
    const listed = await driver.executionIntents.listByOrganization('org_1');
    expect(listed).toHaveLength(1);
    await expect(driver.executionIntents.findById('eit_1', 'org_other')).resolves.toBeNull();
  });
});

describe('createPersistenceDriver', () => {
  it('builds the in-memory driver', () => {
    expect(createPersistenceDriver({ driver: 'memory' }).kind).toBe('memory');
  });

  it('refuses to build the postgres driver without a connection string', () => {
    expect(() => createPersistenceDriver({ driver: 'postgres' })).toThrow(
      /DATABASE_URL must be set/,
    );
  });
});
